"""
process_kaggle_spotify.py
─────────────────────────────────────────────────────────────
Processes the Kaggle "Spotify Data 1986-2023" CSV into:
  data/valence-by-year.csv  — yearly aggregated audio features

Usage:
  python data/process_kaggle_spotify.py <path-to-kaggle-csv>

If no path is given, looks for these filenames inside data/:
  spotify-data-1986-2023.csv  spotify_data.csv  data.csv  tracks.csv

Output columns:
  year, valence, energy, tempo, danceability, popularity, track_count

Next step after running:
  The resonance-timeline.js will automatically load valence-by-year.csv
  on next page refresh — no further code changes needed.
─────────────────────────────────────────────────────────────
"""

import sys
import os
import csv
from collections import defaultdict

DATA_DIR = os.path.dirname(os.path.abspath(__file__))

# Column name aliases — handles different Kaggle CSV naming conventions
COL_YEAR      = ['year', 'Year', 'release_year', 'track_year']
COL_DATE      = ['release_date', 'album_release_date', 'date']
COL_VALENCE   = ['valence', 'Valence', 'audio_valence']
COL_ENERGY    = ['energy', 'Energy', 'audio_energy']
COL_TEMPO     = ['tempo', 'Tempo', 'audio_tempo']
COL_DANCE     = ['danceability', 'Danceability', 'audio_danceability']
COL_POP       = ['popularity', 'Popularity', 'track_popularity']

FALLBACK_NAMES = [
    'spotify-data-1986-2023.csv',
    'spotify_data.csv',
    'data.csv',
    'tracks.csv',
]

YEAR_MIN = 1986
YEAR_MAX = 2025


def find_col(header, aliases):
    for alias in aliases:
        if alias in header:
            return alias
    return None


def parse_year(value):
    if not value:
        return None
    s = str(value).strip()
    if len(s) >= 4 and s[:4].isdigit():
        y = int(s[:4])
        return y if YEAR_MIN <= y <= YEAR_MAX else None
    return None


def safe_float(row, col, lo=0.0, hi=1.0):
    """Return float if in [lo, hi], else None. Pass hi=None to skip range check."""
    if not col or not row.get(col, '').strip():
        return None
    try:
        v = float(row[col])
        if hi is not None and not (lo <= v <= hi):
            return None
        return v
    except (ValueError, TypeError):
        return None


def mean(lst):
    return round(sum(lst) / len(lst), 4) if lst else None


def detect_columns(header):
    year_col    = find_col(header, COL_YEAR)
    date_col    = find_col(header, COL_DATE)
    valence_col = find_col(header, COL_VALENCE)
    energy_col  = find_col(header, COL_ENERGY)
    tempo_col   = find_col(header, COL_TEMPO)
    dance_col   = find_col(header, COL_DANCE)
    pop_col     = find_col(header, COL_POP)

    print("Column detection:")
    print(f"  year       → {year_col or '(derived from ' + str(date_col) + ')'}")
    print(f"  valence    → {valence_col}")
    print(f"  energy     → {energy_col}")
    print(f"  tempo      → {tempo_col}")
    print(f"  danceability → {dance_col}")
    print(f"  popularity → {pop_col}")

    if not valence_col:
        print("\nERROR: No valence column found. Available columns:")
        print(" ", ", ".join(header))
        sys.exit(1)

    return year_col, date_col, valence_col, energy_col, tempo_col, dance_col, pop_col


def process(input_path):
    print(f"Reading: {input_path}\n")

    by_year = defaultdict(lambda: {
        'valence': [], 'energy': [], 'tempo': [], 'danceability': [], 'popularity': []
    })
    rows_ok = 0
    rows_skip = 0

    with open(input_path, encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        header = list(reader.fieldnames or [])

        year_col, date_col, valence_col, energy_col, tempo_col, dance_col, pop_col = \
            detect_columns(header)

        print()
        for row in reader:
            # Resolve year
            year = None
            if year_col:
                year = parse_year(row.get(year_col, ''))
            if year is None and date_col:
                year = parse_year(row.get(date_col, ''))
            if year is None:
                rows_skip += 1
                continue

            val   = safe_float(row, valence_col, 0.0, 1.0)
            enrg  = safe_float(row, energy_col,  0.0, 1.0)
            dance = safe_float(row, dance_col,   0.0, 1.0)
            pop   = safe_float(row, pop_col,     0.0, 100.0) if pop_col else None
            # Tempo can range 0–300+, no upper bound check
            tmp = None
            if tempo_col and row.get(tempo_col, '').strip():
                try:
                    t = float(row[tempo_col])
                    tmp = t if t > 0 else None
                except (ValueError, TypeError):
                    pass

            if val is None:
                rows_skip += 1
                continue

            bucket = by_year[year]
            bucket['valence'].append(val)
            if enrg  is not None: bucket['energy'].append(enrg)
            if tmp   is not None: bucket['tempo'].append(tmp)
            if dance is not None: bucket['danceability'].append(dance)
            if pop   is not None: bucket['popularity'].append(pop)
            rows_ok += 1

    print(f"Rows processed: {rows_ok:,}  |  Skipped (no year/valence): {rows_skip:,}")

    if rows_ok == 0:
        print("\nERROR: No valid rows found. Check that the CSV has valence and year columns.")
        sys.exit(1)

    # Build output rows
    output_rows = []
    for year in sorted(by_year.keys()):
        d = by_year[year]
        output_rows.append({
            'year':         year,
            'valence':      mean(d['valence']),
            'energy':       mean(d['energy']),
            'tempo':        mean(d['tempo']),
            'danceability': mean(d['danceability']),
            'popularity':   mean(d['popularity']),
            'track_count':  len(d['valence']),
        })

    out_path = os.path.join(DATA_DIR, 'valence-by-year.csv')
    fieldnames = ['year', 'valence', 'energy', 'tempo', 'danceability', 'popularity', 'track_count']

    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"\nWritten {len(output_rows)} year rows → {out_path}")
    print(f"Year range: {output_rows[0]['year']} – {output_rows[-1]['year']}")
    print(f"Sample (last 3 rows):")
    for r in output_rows[-3:]:
        print(f"  {r['year']}: valence={r['valence']}, energy={r['energy']}, tracks={r['track_count']}")

    print("\nDone. Refresh the browser — the resonance timeline will load real valence data automatically.")


def main():
    if len(sys.argv) > 1:
        input_path = sys.argv[1]
        if not os.path.exists(input_path):
            print(f"ERROR: File not found: {input_path}")
            sys.exit(1)
    else:
        input_path = None
        for name in FALLBACK_NAMES:
            candidate = os.path.join(DATA_DIR, name)
            if os.path.exists(candidate):
                input_path = candidate
                print(f"Found: {name}")
                break

        if not input_path:
            print("ERROR: Could not find Kaggle CSV. Drop it in data/ as one of:")
            for name in FALLBACK_NAMES:
                print(f"  {name}")
            print("\nOr pass the path directly:")
            print("  python data/process_kaggle_spotify.py /path/to/your-file.csv")
            sys.exit(1)

    process(input_path)


if __name__ == '__main__':
    main()

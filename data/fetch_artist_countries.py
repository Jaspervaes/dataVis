"""
fetch_artist_countries.py
Looks up the MusicBrainz `country` field for every distinct
`principal_artist_name` in datos_merged_1986_2023.csv and writes
artist-countries.csv (artist_name, country).

The Resonance Timeline page joins on this file at runtime to
attach a region to each track for the sidebar Region filter.

Runtime: ~1 hour for ~3,500 unique artists (MB rate limit: 1 req/sec).
Re-runs are incremental: existing entries in artist-countries.csv
are skipped, so you can resume after an interruption.
"""

import csv
import os
import sys
import time
import requests

HERE     = os.path.dirname(__file__)
SRC_FILE = os.path.join(HERE, "datos_merged_1986_2023.csv")
OUT_FILE = os.path.join(HERE, "artist-countries.csv")

MB_BASE  = "https://musicbrainz.org/ws/2/"
HEADERS  = {
    "User-Agent": "DataVisKULeuven/1.0 (sofiebauwens3@gmail.com)",
    "Accept":     "application/json",
}

ARTIST_COL = "principal_artist_name"


def mb_search_artist(name):
    """Return ISO-2 country for the best-scoring MB artist match, or ''."""
    try:
        r = requests.get(
            MB_BASE + "artist",
            params={"query": f'artist:"{name}"', "fmt": "json", "limit": 1},
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ERROR for {name!r}: {e}")
        return ""
    finally:
        time.sleep(1.1)

    artists = data.get("artists", [])
    if not artists:
        return ""
    return artists[0].get("country", "") or ""


def load_existing(path):
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {row["artist_name"]: row["country"] for row in csv.DictReader(f)}


def collect_unique_artists(path):
    seen = set()
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if ARTIST_COL not in reader.fieldnames:
            sys.exit(f"Column {ARTIST_COL!r} missing from {path}")
        for row in reader:
            name = (row.get(ARTIST_COL) or "").strip()
            if name:
                seen.add(name)
    return sorted(seen)


def main():
    artists  = collect_unique_artists(SRC_FILE)
    existing = load_existing(OUT_FILE)
    todo     = [a for a in artists if a not in existing]

    print(f"Total unique artists: {len(artists)}")
    print(f"Already cached:       {len(existing)}")
    print(f"To look up:           {len(todo)}")
    if not todo:
        return

    # Open for append; write header only if file is new.
    new_file = not os.path.exists(OUT_FILE)
    with open(OUT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["artist_name", "country"])
        if new_file:
            writer.writeheader()

        for i, name in enumerate(todo, 1):
            country = mb_search_artist(name)
            writer.writerow({"artist_name": name, "country": country})
            f.flush()
            if i % 25 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)} processed (last: {name!r} -> {country or '—'})")

    print(f"\nDone. Wrote to {OUT_FILE}")


if __name__ == "__main__":
    main()

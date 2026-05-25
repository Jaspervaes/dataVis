"""
fetch_genre_forecast.py  v2
────────────────────────────────────────────────────────────────────────────
Four-step pipeline:

  Step 0  Download asaniczka + confirm real date window
  Step 1  Single genre taxonomy, applied everywhere
  Step 2  Global genre SHARE per release-year (1986-2025)
  Step 3  Compositional forecast 2026-2030 (logit-polynomial + renorm)
  Step 4  EU-vs-global divergence overlay from asaniczka (its real window only)

Outputs:
  data/global_genre_share_yearly.csv   — year, genre, share, track_count,
                                          is_forecast, lower, upper
  data/eu_vs_global_index_monthly.csv  — month, genre, eu_share,
                                          global_share, divergence

Usage:
  python data/fetch_genre_forecast.py              # download + run all
  python data/fetch_genre_forecast.py --no-download # skip download
────────────────────────────────────────────────────────────────────────────
"""

import argparse, ast, re, sys, subprocess
from pathlib import Path
import sys as _sys
from typing import Optional, List, Dict

import numpy as np
import pandas as pd

HERE = Path(__file__).parent

DATOS_PATH   = HERE / '_kaggle_downloads' / 'spotify-data-1986-2023'      / 'datos_merged_1986_2023.csv'
GLOBAL_PATH  = HERE / '_kaggle_downloads' / 'spotify-global-music-dataset-20092025' / 'track_data_final.csv'
ASANICZKA_DIR = HERE / '_kaggle_downloads' / 'top-spotify-songs-in-73-countries-daily-updated'

OUT_GLOBAL     = HERE / 'global_genre_share_yearly.csv'
OUT_EU         = HERE / 'eu_vs_global_index_monthly.csv'
OUT_INFLUENCE  = HERE / 'eu_influence_correlation.csv'
OUT_REGIONAL   = HERE / 'regional_monthly_shares.csv'

EU_COUNTRIES = {
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
    'IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES',
    'SE','GB','NO','CH','IS',
}

# Non-EU regions for the "where does taste come from?" influence map
REGIONS = {
    'US':       {'US'},
    'LatAm':    {'BR','MX','CO','AR','CL','PE','VE','EC','BO','UY','PY',
                 'GT','HN','CR','PA','DO','SV','NI'},
    'Asia':     {'JP','KR','IN','ID','PH','TH','VN','MY','SG','HK','TW','PK'},
    'Africa/ME':{'NG','ZA','EG','MA','SA','AE','IL','TR'},
}

MACRO_GENRES  = ['Pop','Hip-Hop','Rock','Electronic','R&B','Latin','Country','Jazz','Classical']
FORECAST_YEARS = list(range(2026, 2031))

# ── Step 1: genre taxonomy ────────────────────────────────────────────────────
# Rules are ordered most-specific → least-specific; first match wins.
GENRE_RULES = [
    (r'classical|orchestra|symphony|opera|chamber|baroque|concerto|sonata',   'Classical'),
    (r'jazz|blues?|bebop|swing|bossa.?nova',                                  'Jazz'),
    (r'latin|reggaeton|salsa|cumbia|bachata|merengue|tango|trap.lat|urbano|samba|bossa', 'Latin'),
    (r'hip.?hop|rap|trap|drill|gangsta|crunk|boom.?bap|mumble',               'Hip-Hop'),
    (r'\br&b\b|rhythm.and.blues|soul|funk|neo.?soul|motown|afrobeat|afropop|amapiano', 'R&B'),
    (r'electronic|house|techno|edm|dubstep|drum.and.bass|trance|ambient|disco|synth|electro', 'Electronic'),
    (r'rock|metal|punk|grunge|emo|alternative|indie.rock|hard.rock|prog',     'Rock'),
    (r'country|folk|americana|bluegrass|singer.?songwriter|indie.folk',       'Country'),
    (r'pop|dance.pop|electropop|teen.pop|dream.pop|art.pop|indie.pop|k.?pop', 'Pop'),
]


def normalise_genre(raw):
    # type: (object) -> Optional[str]
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return None
    s = str(raw).strip()
    if s in ('', '[]', 'nan', 'none'):
        return None
    # Handle Python list repr: "['pop', 'dance pop']"
    try:
        items = ast.literal_eval(s)
        s = ' '.join(str(i) for i in items).lower()
    except Exception:
        s = s.lower()
    for pattern, macro in GENRE_RULES:
        if re.search(pattern, s):
            return macro
    return None


def extract_year(val):
    # type: (object) -> Optional[int]
    m = re.match(r'(\d{4})', str(val).strip())
    if m:
        y = int(m.group(1))
        return y if 1980 <= y <= 2025 else None
    return None


def extract_year_quarter(val):
    # type: (object) -> Optional[float]
    """Decimal year-quarter: 1986.0 = Q1 1986, 1986.25 = Q2, 1986.5 = Q3, 1986.75 = Q4."""
    s = str(val).strip()
    m = re.match(r'(\d{4})(?:-(\d{2}))?', s)
    if not m:
        return None
    y = int(m.group(1))
    if not (1980 <= y <= 2025):
        return None
    if m.group(2):
        month = int(m.group(2))
        if 1 <= month <= 12:
            q = (month - 1) // 3
            return y + q * 0.25
    return float(y)


# ── Kaggle download ───────────────────────────────────────────────────────────
def kaggle_download(slug, dest):
    # type: (str, Path) -> None
    short = slug.split('/')[-1]
    out = dest / short
    out.mkdir(parents=True, exist_ok=True)
    print(f'  Downloading {slug} ...', flush=True)
    # Locate kaggle CLI next to the running Python executable
    kaggle_candidates = [
        Path(_sys.executable).parent / 'kaggle.exe',
        Path(_sys.executable).parent / 'Scripts' / 'kaggle.exe',
        Path(_sys.executable).parent.parent / 'Scripts' / 'kaggle.exe',
        Path('kaggle'),  # system PATH fallback
    ]
    kaggle_exe = next((str(p) for p in kaggle_candidates if Path(p).exists()), 'kaggle')

    try:
        subprocess.run(
            [kaggle_exe, 'datasets', 'download', '-d', slug, '-p', str(out), '--unzip'],
            check=True, capture_output=True, text=True,
        )
        print(f'  Done -> {out}')
    except subprocess.CalledProcessError as e:
        msg = (e.stderr or '').strip()
        print(f'  WARNING: download failed -- {msg or e}')


# ── Artist → genre lookup ─────────────────────────────────────────────────────
def build_genre_lookup():
    # type: () -> Dict[str, str]
    """Lower-case artist name → macro-genre. Uses all available genre sources."""
    lookup = {}

    if GLOBAL_PATH.exists():
        df = pd.read_csv(GLOBAL_PATH, usecols=['artist_name', 'artist_genres'],
                         low_memory=False, on_bad_lines='skip')
        for _, row in df.iterrows():
            g = normalise_genre(row.get('artist_genres'))
            if g:
                lookup[str(row['artist_name']).lower().strip()] = g
        print(f'  track_data_final  -> {len(lookup)} artist-genre entries')

    mb_path = HERE / 'spotify-tracks.csv'
    if mb_path.exists():
        df = pd.read_csv(mb_path, usecols=['artist_name', 'genre'],
                         low_memory=False, on_bad_lines='skip')
        before = len(lookup)
        for _, row in df.iterrows():
            name = str(row['artist_name']).lower().strip()
            g    = str(row.get('genre', '')).strip()
            if name not in lookup and g in MACRO_GENRES:
                lookup[name] = g
        print(f'  spotify-tracks.csv -> +{len(lookup)-before} entries')

    print(f'  Total lookup size: {len(lookup)}')
    return lookup


# ── Step 2: global genre share per release-year ───────────────────────────────
def build_global_shares(genre_lookup):
    # type: (Dict[str, str]) -> pd.DataFrame
    """
    Returns DataFrame with columns: year, genre, share, track_count
    'share' = fraction of tracks in that release-year assigned to that genre.
    Metric label: "share of still-popular catalog by release year" (survivorship caveat).
    """
    rows = []

    # -- datos_merged (1986-2023): genres via artist lookup --
    if DATOS_PATH.exists():
        df = pd.read_csv(DATOS_PATH, low_memory=False, on_bad_lines='skip')
        year_col   = next((c for c in ['album_release_date','release_date','year'] if c in df.columns), None)
        artist_col = next((c for c in ['principal_artist_name','artist_name','artists'] if c in df.columns), None)
        pop_col    = next((c for c in ['popularity','track_popularity'] if c in df.columns), None)

        if year_col and artist_col:
            df['_year']  = df[year_col].apply(extract_year_quarter)
            df['_genre'] = df[artist_col].str.lower().str.strip().map(genre_lookup)
            df['_pop']   = pd.to_numeric(df[pop_col] if pop_col else 50, errors='coerce').fillna(0)
            # Keep tracks with non-trivial popularity (survivorship filter)
            sub = df[df['_pop'] >= 20][['_year','_genre']].dropna()
            rows.append(sub)
            print(f'  datos_merged      -> {len(sub):,} usable rows')

    # -- track_data_final (2009-2025): genres from artist_genres field --
    if GLOBAL_PATH.exists():
        df = pd.read_csv(GLOBAL_PATH, low_memory=False, on_bad_lines='skip')
        df['_year']  = df['album_release_date'].apply(extract_year_quarter)
        df['_genre'] = df['artist_genres'].apply(normalise_genre)
        df['_pop']   = pd.to_numeric(df['track_popularity'], errors='coerce').fillna(0)
        sub = df[df['_pop'] >= 20][['_year','_genre']].dropna()
        rows.append(sub)
        print(f'  track_data_final  -> {len(sub):,} usable rows')

    if not rows:
        sys.exit('ERROR: no source CSVs found under data/_kaggle_downloads/')

    all_tracks = pd.concat(rows, ignore_index=True)
    # _year is now a decimal year (1986.0 / 1986.25 / 1986.5 / 1986.75)
    all_tracks['_year'] = all_tracks['_year'].astype(float)

    # Genre share per quarter (year-quarter)
    year_counts  = all_tracks.groupby('_year').size().rename('total')
    genre_counts = (all_tracks.groupby(['_year','_genre'])
                    .size().rename('track_count').reset_index())
    genre_counts = genre_counts.join(year_counts, on='_year')
    genre_counts['share'] = (genre_counts['track_count'] / genre_counts['total']).round(4)

    # Smooth quarterly shares with a 3-quarter rolling mean to tame noise
    # in sparse early years while preserving inflection in dense recent years
    smoothed_rows = []
    for genre, grp in genre_counts.groupby('_genre'):
        g = grp.sort_values('_year').copy()
        g['share'] = g['share'].rolling(window=3, min_periods=1, center=True).mean().round(4)
        smoothed_rows.append(g)
    genre_counts = pd.concat(smoothed_rows, ignore_index=True)

    # ── diagnostic: per-quarter track totals ──
    print('\n  Per-quarter track counts (sample, every 4th):')
    sorted_idx = sorted(year_counts.index)
    for i, y in enumerate(sorted_idx):
        if i % 4 != 0: continue
        n = year_counts[y]
        flag = '  [sparse]' if n < 8 else ''
        print(f'    {y:7.2f}: {n:5d}{flag}')

    return genre_counts.rename(columns={'_year':'year', '_genre':'genre'})


# ── Step 3: compositional forecast 2026-2030 ─────────────────────────────────
def compositional_forecast(shares_df):
    # type: (pd.DataFrame) -> pd.DataFrame
    """
    Logit-polynomial (degree 2) per genre, predict 2026-2030, renormalize so
    forecast shares still sum to 1. Confidence bands at ±1.5 sigma on logit scale.
    """
    genres_present = [g for g in MACRO_GENRES if g in shares_df['genre'].unique()]

    # Pivot: year × genre, fill missing cells with small value
    pivot = (shares_df[shares_df['genre'].isin(genres_present)]
             .pivot(index='year', columns='genre', values='share')
             .reindex(columns=genres_present)
             .fillna(0.001))
    # Renormalize rows so shares always sum to 1
    pivot = pivot.div(pivot.sum(axis=1), axis=0)

    years = pivot.index.values.astype(float)
    pred_med = {g: {} for g in genres_present}
    pred_lo  = {g: {} for g in genres_present}
    pred_hi  = {g: {} for g in genres_present}

    for genre in genres_present:
        shares = np.clip(pivot[genre].values, 0.001, 0.999)
        logit  = np.log(shares / (1 - shares))

        coeffs = np.polyfit(years, logit, 2)
        poly   = np.poly1d(coeffs)
        sigma  = np.std(logit - poly(years))

        for fy in FORECAST_YEARS:
            lp = float(poly(fy))
            pred_med[genre][fy] = 1 / (1 + np.exp(-lp))
            pred_lo [genre][fy] = 1 / (1 + np.exp(-(lp - 1.5 * sigma)))
            pred_hi [genre][fy] = 1 / (1 + np.exp(-(lp + 1.5 * sigma)))

    # Renormalize so medians sum to 1 per forecast year
    for fy in FORECAST_YEARS:
        total = sum(pred_med[g][fy] for g in genres_present)
        for genre in genres_present:
            pred_med[genre][fy] /= total
            pred_lo [genre][fy]  = max(0.0, pred_lo[genre][fy] / total)
            pred_hi [genre][fy]  = min(1.0, pred_hi[genre][fy] / total)

    rows = []
    for fy in FORECAST_YEARS:
        for genre in genres_present:
            rows.append({
                'year': fy, 'genre': genre,
                'share':       round(pred_med[genre][fy], 4),
                'lower':       round(pred_lo [genre][fy], 4),
                'upper':       round(pred_hi [genre][fy], 4),
                'track_count': 0,
                'is_forecast': True,
            })
    return pd.DataFrame(rows)


# ── Step 4: EU vs global divergence from asaniczka ───────────────────────────
def build_eu_divergence(genre_lookup):
    # type: (Dict[str, str]) -> Optional[pd.DataFrame]

    csv_files = list(ASANICZKA_DIR.rglob('*.csv')) if ASANICZKA_DIR.exists() else []
    if not csv_files:
        print('  asaniczka not found — skipping EU overlay.')
        return None

    main_csv = max(csv_files, key=lambda p: p.stat().st_size)
    print(f'  Loading {main_csv.name} ({main_csv.stat().st_size // 1_000_000} MB) ...')
    df = pd.read_csv(main_csv, low_memory=False, on_bad_lines='skip')
    print(f'  Columns: {list(df.columns)}')

    # ── Step 0 diagnostic ────────────────────────────────────────────────────
    date_col    = next((c for c in ['snapshot_date','date','Date'] if c in df.columns), None)
    country_col = next((c for c in ['country','Country','country_code'] if c in df.columns), None)
    artist_col  = next((c for c in ['artists','artist','artist_name','Artist'] if c in df.columns), None)
    track_id_col = next((c for c in ['spotify_id','track_id','id'] if c in df.columns), None)
    genre_col   = next((c for c in ['artist_genres','genres','genre'] if c in df.columns), None)

    if not date_col or not country_col:
        print('  WARNING: missing date or country column — skipping EU overlay.')
        return None

    df['_date'] = pd.to_datetime(df[date_col], errors='coerce')
    print(f'\n  === Step 0: asaniczka date range ===')
    print(f'  Min date : {df["_date"].min().date()}')
    print(f'  Max date : {df["_date"].max().date()}')
    print(f'  Rows     : {len(df):,}')
    print(f'  Countries: {sorted(df[country_col].dropna().unique())}')

    # ── Assign genre ─────────────────────────────────────────────────────────
    if genre_col:
        df['_genre'] = df[genre_col].apply(normalise_genre)
        print(f'  Genre assigned from column {genre_col!r}')
    elif artist_col:
        df['_genre'] = df[artist_col].str.lower().str.strip().map(genre_lookup)
        matched = df['_genre'].notna().sum()
        print(f'  Genre assigned via artist lookup: {matched:,}/{len(df):,} rows matched')
    else:
        print('  WARNING: cannot assign genres — no artist or genre column.')
        return None

    # ── Try to improve coverage via track_id join ─────────────────────────────
    if track_id_col and GLOBAL_PATH.exists():
        id_genre = (pd.read_csv(GLOBAL_PATH, usecols=['track_id','artist_genres'],
                                low_memory=False, on_bad_lines='skip')
                    .assign(_g=lambda d: d['artist_genres'].apply(normalise_genre))
                    .dropna(subset=['_g'])
                    .set_index('track_id')['_g'])
        missing = df['_genre'].isna()
        filled  = df.loc[missing, track_id_col].map(id_genre)
        df.loc[missing, '_genre'] = filled
        print(f'  Track-ID join filled {filled.notna().sum():,} extra genre gaps')

    df = df.dropna(subset=['_genre', '_date', country_col])
    print(f'  Rows with genre+date+country: {len(df):,}')

    df['_month'] = df['_date'].dt.to_period('M').astype(str)
    df['_is_eu'] = df[country_col].isin(EU_COUNTRIES)
    print(f'  EU rows: {df["_is_eu"].sum():,}  |  Global rows: {len(df):,}')

    # ── Aggregate monthly genre share ─────────────────────────────────────────
    def monthly_shares(sub, label):
        counts  = sub.groupby(['_month','_genre']).size().reset_index(name='n')
        totals  = sub.groupby('_month').size().reset_index(name='total')
        merged  = counts.merge(totals, on='_month')
        merged[label] = (merged['n'] / merged['total']).round(4)
        return merged[['_month','_genre', label]].rename(columns={'_genre':'genre','_month':'month'})

    eu_shares     = monthly_shares(df[df['_is_eu']], 'eu_share')
    global_shares = monthly_shares(df, 'global_share')

    result = eu_shares.merge(global_shares, on=['month','genre'], how='outer').fillna(0)
    result['divergence'] = (result['eu_share'] - result['global_share']).round(4)
    result = result.sort_values(['month','genre'])

    print(f'\n  EU overlay: {result["month"].nunique()} months × {result["genre"].nunique()} genres')
    print(f'  EU countries matched: {sorted(df[df["_is_eu"]][country_col].unique())}')

    # ── Build per-region monthly shares (for the influence map) ────────────────
    region_frames = {'EU': eu_shares.rename(columns={'eu_share': 'share'})}
    for region_name, region_codes in REGIONS.items():
        sub = df[df[country_col].isin(region_codes)]
        if len(sub) < 1000:
            print(f'  Skipping {region_name}: only {len(sub)} rows')
            continue
        rs = monthly_shares(sub, 'share')
        region_frames[region_name] = rs
        print(f'  {region_name}: {len(sub):,} rows, {rs["month"].nunique()} months, '
              f'countries {sorted(sub[country_col].unique())}')

    return result, region_frames


def compute_influence_correlations(region_frames):
    """For each genre, Pearson correlation between EU monthly share and each
    other region's monthly share. Returns DataFrame: genre, region, correlation, n_months."""
    if 'EU' not in region_frames:
        return None

    eu = region_frames['EU'].set_index(['month', 'genre'])['share']
    rows = []
    for region_name, region_df in region_frames.items():
        if region_name == 'EU':
            continue
        other = region_df.set_index(['month', 'genre'])['share']
        # Align on (month, genre), then per genre, correlate over months
        merged = pd.concat([eu, other], axis=1, keys=['eu', 'other']).reset_index()
        for genre, grp in merged.groupby('genre'):
            g = grp.dropna(subset=['eu', 'other'])
            if len(g) < 6:
                continue
            # Need variance in both series to correlate
            if g['eu'].std() < 1e-6 or g['other'].std() < 1e-6:
                continue
            corr = g['eu'].corr(g['other'])
            if pd.isna(corr):
                continue
            rows.append({
                'genre':       genre,
                'region':      region_name,
                'correlation': round(float(corr), 3),
                'n_months':    int(len(g)),
            })
    return pd.DataFrame(rows).sort_values(['genre', 'region'])


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-download', action='store_true',
                        help='Skip Kaggle download; use existing files.')
    args = parser.parse_args()

    if not args.no_download:
        print('=== Downloading asaniczka dataset ===')
        kaggle_download('asaniczka/top-spotify-songs-in-73-countries-daily-updated',
                        HERE / '_kaggle_downloads')

    print('\n=== Step 1: Building genre lookup ===')
    genre_lookup = build_genre_lookup()

    print('\n=== Step 2: Global genre share 1986–2025 ===')
    shares_df = build_global_shares(genre_lookup)

    print('\n=== Step 3: Compositional forecast 2026–2030 ===')
    forecast_df = compositional_forecast(shares_df)

    # Merge historical + forecast into one file
    hist_out = shares_df.copy()
    hist_out['is_forecast'] = False
    hist_out['lower'] = float('nan')
    hist_out['upper'] = float('nan')
    combined = pd.concat(
        [hist_out[['year','genre','share','track_count','is_forecast','lower','upper']],
         forecast_df[['year','genre','share','track_count','is_forecast','lower','upper']]],
        ignore_index=True,
    )
    combined.to_csv(OUT_GLOBAL, index=False)
    print(f'\n  Written {len(combined):,} rows -> {OUT_GLOBAL}')
    print(f'  Genres in file: {sorted(combined["genre"].unique())}')
    print(f'  Year range    : {combined["year"].min()}–{combined["year"].max()}')

    print('\n=== Step 4: EU vs global divergence + regional shares ===')
    div_result = build_eu_divergence(genre_lookup)
    if div_result is not None:
        eu_df, region_frames = div_result
    else:
        eu_df, region_frames = None, None

    if eu_df is not None:
        eu_df.to_csv(OUT_EU, index=False)
        print(f'\n  Written {len(eu_df):,} rows -> {OUT_EU}')
    else:
        pd.DataFrame(columns=['month','genre','eu_share','global_share','divergence']).to_csv(OUT_EU, index=False)
        print(f'  Written empty placeholder -> {OUT_EU}')

    print('\n=== Step 5: Regional influence correlations + monthly shares ===')
    if region_frames is not None and len(region_frames) > 1:
        # Save raw regional monthly shares for the small-multiples chart
        regional_rows = []
        for region_name, region_df in region_frames.items():
            tmp = region_df.copy()
            tmp['region'] = region_name
            regional_rows.append(tmp[['month','genre','region','share']])
        regional_df = pd.concat(regional_rows, ignore_index=True).sort_values(['region','genre','month'])
        regional_df.to_csv(OUT_REGIONAL, index=False)
        print(f'  Written {len(regional_df):,} rows -> {OUT_REGIONAL}')

        infl = compute_influence_correlations(region_frames)
        if infl is not None and len(infl):
            infl.to_csv(OUT_INFLUENCE, index=False)
            print(f'  Written {len(infl):,} rows -> {OUT_INFLUENCE}')
            print('\n  Strongest EU alignments:')
            for _, row in infl.nlargest(8, 'correlation').iterrows():
                print(f'    {row["genre"]:<12} <-> {row["region"]:<10} r = {row["correlation"]:+.2f}  (n={row["n_months"]})')
            print('\n  Strongest EU divergences:')
            for _, row in infl.nsmallest(5, 'correlation').iterrows():
                print(f'    {row["genre"]:<12} <-> {row["region"]:<10} r = {row["correlation"]:+.2f}  (n={row["n_months"]})')
        else:
            pd.DataFrame(columns=['genre','region','correlation','n_months']).to_csv(OUT_INFLUENCE, index=False)
            print('  No correlations could be computed')
    else:
        pd.DataFrame(columns=['genre','region','correlation','n_months']).to_csv(OUT_INFLUENCE, index=False)
        print('  Skipped (no regional data)')

    print('\n=== Done ===')


if __name__ == '__main__':
    main()

"""
fetch_musicbrainz.py
Fetches real track + artist data from the MusicBrainz API and writes:
  - spotify-tracks.csv         (one row per primary artist per track — Cultural Flow / Sankey)
  - artist-connections.csv     (one row per collaborating-artist pair — Network Map page 4)

Runtime: ~8-12 minutes for Phase 1, plus Phase 2 country lookups (more artists when
multi-credit extraction is on — expect 1-2 hours total at the 1 req/sec rate limit).
"""

import requests, time, csv, json, os
from collections import defaultdict
from itertools import combinations

MB_BASE   = "https://musicbrainz.org/ws/2/"
HEADERS   = {
    "User-Agent": "DataVisKULeuven/1.0 (sofiebauwens3@gmail.com)",
    "Accept":     "application/json",
}
OUT_FILE          = os.path.join(os.path.dirname(__file__), "spotify-tracks.csv")
CONNECTIONS_FILE  = os.path.join(os.path.dirname(__file__), "artist-connections.csv")

# ── Geography ────────────────────────────────────────────────────────────────
COUNTRY_TO_REGION = {
    # Europe
    "GB":"Europe","DE":"Europe","FR":"Europe","SE":"Europe","NO":"Europe",
    "NL":"Europe","BE":"Europe","IT":"Europe","ES":"Europe","PT":"Europe",
    "DK":"Europe","FI":"Europe","PL":"Europe","RU":"Europe","UA":"Europe",
    "IE":"Europe","CH":"Europe","AT":"Europe","HU":"Europe","CZ":"Europe",
    "RO":"Europe","GR":"Europe","RS":"Europe","HR":"Europe","IS":"Europe",
    "LU":"Europe","SK":"Europe","SI":"Europe","LV":"Europe","LT":"Europe",
    "EE":"Europe","BA":"Europe","MK":"Europe","ME":"Europe","AL":"Europe",
    # North America (US + Canada; matches sankey/cultural-flow split)
    "US":"North America","CA":"North America",
    # Latin America (Mexico + Central America + Caribbean + South America)
    "BR":"Latin America","MX":"Latin America",
    "CO":"Latin America","AR":"Latin America","CL":"Latin America","PE":"Latin America",
    "VE":"Latin America","CU":"Latin America","JM":"Latin America","TT":"Latin America",
    "DO":"Latin America","PA":"Latin America","EC":"Latin America","BO":"Latin America",
    "UY":"Latin America","PY":"Latin America","GT":"Latin America","HN":"Latin America",
    "CR":"Latin America","SV":"Latin America","NI":"Latin America","HT":"Latin America",
    # Africa
    "NG":"Africa","ZA":"Africa","GH":"Africa","KE":"Africa","SN":"Africa",
    "CM":"Africa","TZ":"Africa","UG":"Africa","ET":"Africa","EG":"Africa",
    "MA":"Africa","TN":"Africa","CI":"Africa","ML":"Africa","CD":"Africa",
    "AO":"Africa","MZ":"Africa","ZW":"Africa","BW":"Africa","ZM":"Africa",
    "RW":"Africa","BJ":"Africa","TG":"Africa","BF":"Africa","MW":"Africa",
    # Asia
    "JP":"Asia","KR":"Asia","CN":"Asia","IN":"Asia","ID":"Asia",
    "PH":"Asia","TH":"Asia","VN":"Asia","MY":"Asia","SG":"Asia",
    "PK":"Asia","BD":"Asia","IR":"Asia","TR":"Asia","SA":"Asia",
    "AE":"Asia","LB":"Asia","IL":"Asia","IQ":"Asia","SY":"Asia",
    "KZ":"Asia","UZ":"Asia","MM":"Asia","KH":"Asia","LK":"Asia",
    # Oceania
    "AU":"Oceania","NZ":"Oceania","FJ":"Oceania","PG":"Oceania",
}

# ── Genre normalisation ───────────────────────────────────────────────────────
# Map MB tag strings → the 6 Sankey target genres
GENRE_NORM = {
    "pop":"Pop","pop music":"Pop","pop rock":"Pop","teen pop":"Pop",
    "hip-hop":"Hip-Hop","hip hop":"Hip-Hop","rap":"Hip-Hop","trap":"Hip-Hop",
    "hip-hop/rap":"Hip-Hop","gangsta rap":"Hip-Hop","crunk":"Hip-Hop",
    "electronic":"Electronic","house":"Electronic","techno":"Electronic",
    "dance":"Electronic","edm":"Electronic","electronica":"Electronic",
    "ambient":"Electronic","synth-pop":"Electronic","trance":"Electronic",
    "drum and bass":"Electronic","dubstep":"Electronic","disco":"Electronic",
    "r&b":"R&B","r and b":"R&B","rhythm and blues":"R&B","soul":"R&B",
    "neo soul":"R&B","rnb":"R&B","funk":"R&B","motown":"R&B",
    "afrobeats":"Afrobeats","afro-pop":"Afrobeats","afropop":"Afrobeats",
    "afro pop":"Afrobeats","afro beat":"Afrobeats","afrobeat":"Afrobeats",
    "highlife":"Afrobeats","afro house":"Afrobeats","juju":"Afrobeats",
    "afroswing":"Afrobeats","amapiano":"Afrobeats",
    "latin":"Latin","reggaeton":"Latin","salsa":"Latin","cumbia":"Latin",
    "bossa nova":"Latin","samba":"Latin","latin pop":"Latin",
    "latin hip-hop":"Latin","bachata":"Latin","merengue":"Latin",
    "vallenato":"Latin","tango":"Latin","latin rock":"Latin",
}

# Primary search tag → canonical Sankey genre
SEARCH_GENRES = {
    "pop":       "Pop",
    "hip-hop":   "Hip-Hop",
    "electronic":"Electronic",
    "r&b":       "R&B",
    "afrobeats": "Afrobeats",
    "latin":     "Latin",
}

# Fetch more records by year window so all years are represented.
YEAR_START   = 1986
YEAR_END     = 2025
YEAR_STEP    = 1
QUERY_LIMIT  = 100
MAX_OFFSET   = 500

def mb_get(endpoint, params):
    params["fmt"] = "json"
    r = requests.get(MB_BASE + endpoint, params=params, headers=HEADERS, timeout=30)
    time.sleep(1.1)
    r.raise_for_status()
    return r.json()

def normalise_genre(tags, fallback):
    for tag in tags:
        g = GENRE_NORM.get(tag.lower())
        if g:
            return g
    return fallback

# ── Phase 1: collect recordings per genre ────────────────────────────────────
print("=== Phase 1: Fetching recordings ===")
raw_tracks = []

for tag, genre_name in SEARCH_GENRES.items():
    print(f"\n  Genre: {genre_name} (tag: {tag})")
    for year in range(YEAR_START, YEAR_END + 1, YEAR_STEP):
        year_query = f'date:[{year} TO {year}]'
        for offset in range(0, MAX_OFFSET, QUERY_LIMIT):
            try:
                data = mb_get("recording", {
                    "query": f'tag:"{tag}" AND {year_query}',
                    "limit": QUERY_LIMIT,
                    "offset": offset,
                })
                recs = data.get("recordings", [])
                print(f"    year={year} offset={offset} -> {len(recs)} recordings")
                if not recs:
                    break
                for rec in recs:
                    # Capture EVERY artist in the credit array (not just the first),
                    # so we can derive collaboration pairs for the network map.
                    credits = rec.get("artist-credit", [])
                    artists = []
                    for ac in credits:
                        if isinstance(ac, str):
                            continue  # join phrase like " & "
                        a = ac.get("artist", {})
                        aid, aname = a.get("id", ""), a.get("name", "")
                        if aid:
                            artists.append({"artist_id": aid, "artist_name": aname})
                    if not artists:
                        continue
                    date = rec.get("first-release-date", "")
                    year = date[:4] if date and date[:4].isdigit() else ""
                    rec_tags = [t["name"] for t in rec.get("tags", [])]
                    raw_tracks.append({
                        "track_id":   rec["id"],
                        "title":      rec.get("title", ""),
                        # Primary artist kept for backwards-compat with spotify-tracks.csv.
                        "artist_id":  artists[0]["artist_id"],
                        "artist_name":artists[0]["artist_name"],
                        "artists":    artists,
                        "genre":      normalise_genre(rec_tags, genre_name),
                        "year":       year,
                    })
            except Exception as e:
                print(f"    ERROR year={year} offset={offset}: {e}")
                break

print(f"\nTotal raw tracks collected: {len(raw_tracks)}")

# Write raw tracks to a checkpoint file for debugging/inspection
raw_tracks_file = os.path.join(os.path.dirname(__file__), "raw-tracks.json")
with open(raw_tracks_file, "w", encoding="utf-8") as f:
    json.dump(raw_tracks, f, indent=2, ensure_ascii=False)
print(f"Raw tracks checkpoint written to {raw_tracks_file}")

# ── Phase 2: lookup artist countries ─────────────────────────────────────────
# Collect EVERY unique artist seen across all artist-credit arrays so that
# collaborators (not just primaries) get country mappings.
print("\n=== Phase 2: Looking up artist countries ===")
unique_artists = {}
for t in raw_tracks:
    for a in t.get("artists", [{"artist_id": t["artist_id"], "artist_name": t["artist_name"]}]):
        if a["artist_id"] and a["artist_id"] not in unique_artists:
            unique_artists[a["artist_id"]] = {"name": a["artist_name"], "country": ""}

print(f"Unique artists to look up: {len(unique_artists)}")

for i, (aid, info) in enumerate(unique_artists.items()):
    if i % 50 == 0:
        print(f"  {i}/{len(unique_artists)} artists processed…")
    try:
        data   = mb_get(f"artist/{aid}", {})
        info["country"] = data.get("country", "")
    except Exception as e:
        print(f"  ERROR looking up {aid}: {e}")

# ── Phase 3: build and write CSV ─────────────────────────────────────────────
print("\n=== Phase 3: Writing CSV ===")
rows = []
skipped_no_region = 0

for t in raw_tracks:
    aid     = t["artist_id"]
    country = unique_artists.get(aid, {}).get("country", "")
    region  = COUNTRY_TO_REGION.get(country, "")
    if not region:
        skipped_no_region += 1
        continue
    if not t["year"]:
        continue
    rows.append({
        "track_id":      t["track_id"],
        "artist_name":   t["artist_name"],
        "artist_country":country,
        "genre":         t["genre"],
        "year":          t["year"],
        "energy":        "",
        "valence":       "",
        "tempo":         "",
        "danceability":  "",
        "popularity":    "",
    })

print(f"Rows with valid region: {len(rows)}")
print(f"Skipped (no region mapping): {skipped_no_region}")

with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "track_id","artist_name","artist_country","genre",
        "year","energy","valence","tempo","danceability","popularity"
    ])
    writer.writeheader()
    writer.writerows(rows)

print(f"\nDone. Written {len(rows)} rows to {OUT_FILE}")

# ── Phase 4: build artist-connections.csv (collaboration pairs) ──────────────
# One row per unordered (artist_a, artist_b) pair. collaboration_count is the
# number of tracks they appear on together; year is the earliest co-credit year.
print("\n=== Phase 4: Building artist-connections.csv ===")

pair_records = {}  # key: tuple(sorted [a_id, b_id]) -> dict
skipped_single = skipped_no_region_pair = 0

for t in raw_tracks:
    artists = t.get("artists", [])
    if len(artists) < 2:
        skipped_single += 1
        continue
    year_int = int(t["year"]) if t["year"] and t["year"].isdigit() else None
    for a, b in combinations(artists, 2):
        a_id, b_id = a["artist_id"], b["artist_id"]
        if a_id == b_id:
            continue
        a_country = unique_artists.get(a_id, {}).get("country", "")
        b_country = unique_artists.get(b_id, {}).get("country", "")
        a_region  = COUNTRY_TO_REGION.get(a_country, "")
        b_region  = COUNTRY_TO_REGION.get(b_country, "")
        if not a_region or not b_region:
            skipped_no_region_pair += 1
            continue
        # Canonicalise pair order so (a,b) and (b,a) collapse.
        if a_id > b_id:
            a_id, b_id = b_id, a_id
            a, b = b, a
            a_country, b_country = b_country, a_country
            a_region, b_region   = b_region, a_region
        key = (a_id, b_id)
        rec = pair_records.get(key)
        if rec is None:
            pair_records[key] = {
                "artist_id":           a_id,
                "artist_name":         a["artist_name"],
                "country":             a_country,
                "region":              a_region,
                "collaborator_id":     b_id,
                "collaborator_name":   b["artist_name"],
                "collab_country":      b_country,
                "collab_region":       b_region,
                "collaboration_count": 1,
                "year":                year_int if year_int is not None else "",
            }
        else:
            rec["collaboration_count"] += 1
            if year_int is not None and (rec["year"] == "" or year_int < rec["year"]):
                rec["year"] = year_int

print(f"Tracks with only one credited artist (skipped): {skipped_single}")
print(f"Pairs dropped for missing region: {skipped_no_region_pair}")
print(f"Unique collaboration pairs: {len(pair_records)}")

with open(CONNECTIONS_FILE, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "artist_id","artist_name","country","region",
        "collaborator_id","collaborator_name","collab_country","collab_region",
        "collaboration_count","year",
    ])
    writer.writeheader()
    writer.writerows(pair_records.values())

print(f"Done. Written {len(pair_records)} pairs to {CONNECTIONS_FILE}")

# Cross-region sanity check: the network map is meaningless without these.
cross_region = sum(
    1 for r in pair_records.values()
    if r["region"] != r["collab_region"]
)
europe_cross = sum(
    1 for r in pair_records.values()
    if (r["region"] == "Europe") != (r["collab_region"] == "Europe")
)
print(f"  Cross-region pairs: {cross_region}")
print(f"  Europe ↔ non-Europe pairs: {europe_cross}")

# Quick summary
from collections import Counter
region_counts = Counter(r["artist_country"] for r in rows)
genre_counts  = Counter(r["genre"] for r in rows)
print("\nRegion breakdown:")
region_totals = defaultdict(int)
for country, count in region_counts.items():
    region_totals[COUNTRY_TO_REGION[country]] += count
for region, count in sorted(region_totals.items()):
    print(f"  {region}: {count}")
print("\nGenre breakdown:")
for genre, count in genre_counts.most_common():
    print(f"  {genre}: {count}")

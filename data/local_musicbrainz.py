import os
import json
import csv
from collections import Counter, defaultdict
import requests
import time

MB_BASE   = "https://musicbrainz.org/ws/2/"
HEADERS   = {
    "User-Agent": "DataVisKULeuven/1.0 (sofiebauwens3@gmail.com)",
    "Accept":     "application/json",
}

HERE = os.path.dirname(__file__)

RAW_TRACKS_FILE = os.path.join(HERE, "raw-tracks.json")
ARTIST_DUMP     = os.path.join(HERE, "artist_dump")
OUT_FILE        = os.path.join(HERE, "spotify-tracks-2.csv")

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
    # Americas
    "US":"Americas","CA":"Americas","BR":"Americas","MX":"Americas",
    "CO":"Americas","AR":"Americas","CL":"Americas","PE":"Americas",
    "VE":"Americas","CU":"Americas","JM":"Americas","TT":"Americas",
    "DO":"Americas","PA":"Americas","EC":"Americas","BO":"Americas",
    "UY":"Americas","PY":"Americas","GT":"Americas","HN":"Americas",
    "CR":"Americas","SV":"Americas","NI":"Americas","HT":"Americas",
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

# ── Phase 1: collect recordings (improved, more representative) ──────────────
print("=== Phase 1: Fetching recordings ===")

raw_tracks = []

seen_recordings = set()  # prevents duplicates across queries

for tag, genre_name in SEARCH_GENRES.items():

    print(f"\n  Genre: {genre_name} (tag: {tag})")

    # NOTE: no year slicing anymore → MUCH better coverage
    base_query = f'tag:"{tag}"'

    for offset in range(0, 40000, QUERY_LIMIT):

        try:
            data = mb_get("recording", {
                "query": base_query,
                "limit": QUERY_LIMIT,
                "offset": offset,
            })

            recs = data.get("recordings", [])

            print(f"    offset={offset} -> {len(recs)} recordings")

            if not recs:
                break

            for rec in recs:

                rec_id = rec.get("id")
                if not rec_id or rec_id in seen_recordings:
                    continue
                seen_recordings.add(rec_id)

                ac = rec.get("artist-credit", [{}])[0]
                if isinstance(ac, str):
                    continue

                artist = ac.get("artist", {})
                artist_id = artist.get("id", "")
                artist_name = artist.get("name", "")

                if not artist_id:
                    continue

                # safer year extraction (keep as-is if missing)
                date = rec.get("first-release-date", "")
                year = date[:4] if date and date[:4].isdigit() else ""

                rec_tags = [t["name"] for t in rec.get("tags", [])]

                raw_tracks.append({
                    "track_id": rec_id,
                    "title": rec.get("title", ""),
                    "artist_id": artist_id,
                    "artist_name": artist_name,
                    "genre": normalise_genre(rec_tags, genre_name),
                    "year": year,
                })

        except Exception as e:
            print(f"    ERROR offset={offset}: {e}")
            break

print(f"\nTotal raw tracks collected: {len(raw_tracks)}")

# Write raw tracks to a checkpoint file for debugging/inspection
raw_tracks_file = os.path.join(os.path.dirname(__file__), "raw-tracks-2.json")
with open(raw_tracks_file, "w", encoding="utf-8") as f:
    json.dump(raw_tracks, f, indent=2, ensure_ascii=False)
print(f"Raw tracks checkpoint written to {raw_tracks_file}")

# ── Load raw tracks ──────────────────────────────────────────────────────────


print("Loading raw tracks...")

with open(RAW_TRACKS_FILE, "r", encoding="utf-8") as f:
    raw_tracks = json.load(f)

print(f"Raw tracks loaded: {len(raw_tracks)}")

# ── Collect needed artist IDs ────────────────────────────────────────────────

needed_artist_ids = {
    t["artist_id"]
    for t in raw_tracks
    if t.get("artist_id")
}

print(f"Unique artist IDs needed: {len(needed_artist_ids)}")

# ── Lookup countries locally ─────────────────────────────────────────────────

print("\nLooking up artist countries locally...")

artist_country = {}

found = 0

with open(ARTIST_DUMP, "r", encoding="utf-8") as f:

    for i, line in enumerate(f):
        line = line.strip()
        if not line:
            continue

        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue

        mbid = record.get("id")
        if not mbid:
            continue

        country = record.get("country")
        if not country:
            area = record.get("area")
            if isinstance(area, dict):
                iso_codes = area.get("iso-3166-1-codes") or []
                if iso_codes:
                    country = iso_codes[0]

        if mbid in needed_artist_ids and country:
            artist_country[mbid] = country
            found += 1

            if found % 100 == 0:
                print(f"  Found {found}/{len(needed_artist_ids)}")

            if found == len(needed_artist_ids):
                break

print(f"\nArtists matched: {len(artist_country)}")

# ── Build rows ───────────────────────────────────────────────────────────────

print("\nBuilding CSV rows...")

rows = []
skipped_no_region = 0

for t in raw_tracks:

    artist_id = t["artist_id"]

    country = artist_country.get(artist_id, "")
    region = COUNTRY_TO_REGION.get(country)
    if not region:
        skipped_no_region += 1
        continue

    if not t.get("year"):
        skipped_no_region += 1
        continue

    rows.append({
        "track_id":       t["track_id"],
        "artist_name":    t["artist_name"],
        "artist_country": country,
        "genre":          t["genre"],
        "year":           t["year"],
        "energy":         "",
        "valence":        "",
        "tempo":          "",
        "danceability":   "",
        "popularity":     "",
    })

print(f"Rows kept: {len(rows)}")
print(f"Skipped (no region): {skipped_no_region}")

# ── Write CSV ────────────────────────────────────────────────────────────────

with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:

    writer = csv.DictWriter(
        f,
        fieldnames=[
            "track_id",
            "artist_name",
            "artist_country",
            "genre",
            "year",
            "energy",
            "valence",
            "tempo",
            "danceability",
            "popularity",
        ]
    )

    writer.writeheader()
    writer.writerows(rows)

print(f"\nDone.")
print(f"Written: {OUT_FILE}")

# ── Summary ──────────────────────────────────────────────────────────────────

region_counts = defaultdict(int)

for r in rows:
    region = COUNTRY_TO_REGION[r["artist_country"]]
    region_counts[region] += 1

genre_counts = Counter(r["genre"] for r in rows)

print("\nRegion breakdown:")

for region, count in sorted(region_counts.items()):
    print(f"  {region}: {count}")

print("\nGenre breakdown:")

for genre, count in genre_counts.most_common():
    print(f"  {genre}: {count}")
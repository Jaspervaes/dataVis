"""
fetch_musicbrainz.py
Fetches real track + artist data from the MusicBrainz API and writes
spotify-tracks.csv for the Cultural Flow Sankey visualisation.

Runtime: ~8-12 minutes (API rate limit: 1 req/sec).
"""

import requests, time, csv, json, os
from collections import defaultdict

MB_BASE   = "https://musicbrainz.org/ws/2/"
HEADERS   = {
    "User-Agent": "DataVisKULeuven/1.0 (sofiebauwens3@gmail.com)",
    "Accept":     "application/json",
}
OUT_FILE  = os.path.join(os.path.dirname(__file__), "spotify-tracks.csv")

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
    for offset in range(0, 500, 100):
        try:
            data = mb_get("recording", {"query": f'tag:"{tag}"', "limit": 100, "offset": offset})
            recs = data.get("recordings", [])
            print(f"    offset={offset} -> {len(recs)} recordings")
            for rec in recs:
                ac = rec.get("artist-credit", [{}])[0]
                if isinstance(ac, str):
                    continue
                artist = ac.get("artist", {})
                artist_id   = artist.get("id", "")
                artist_name = artist.get("name", "")
                if not artist_id:
                    continue
                date = rec.get("first-release-date", "")
                year = date[:4] if date and date[:4].isdigit() else ""
                rec_tags = [t["name"] for t in rec.get("tags", [])]
                raw_tracks.append({
                    "track_id":   rec["id"],
                    "title":      rec.get("title", ""),
                    "artist_id":  artist_id,
                    "artist_name":artist_name,
                    "genre":      normalise_genre(rec_tags, genre_name),
                    "year":       year,
                })
        except Exception as e:
            print(f"    ERROR at offset={offset}: {e}")

print(f"\nTotal raw tracks collected: {len(raw_tracks)}")

# ── Phase 2: lookup artist countries ─────────────────────────────────────────
print("\n=== Phase 2: Looking up artist countries ===")
unique_artists = {}
for t in raw_tracks:
    if t["artist_id"] not in unique_artists:
        unique_artists[t["artist_id"]] = {"name": t["artist_name"], "country": ""}

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

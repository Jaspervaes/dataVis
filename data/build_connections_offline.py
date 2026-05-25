"""
build_connections_offline.py
─────────────────────────────────────────────────────────────
Builds data/artist-connections.csv WITHOUT any MusicBrainz API calls.

Replaces the slow Phase-2 country lookups in fetch_musicbrainz.py: instead of
one rate-limited request per artist, it joins against a local MusicBrainz
*artist* JSON dump (each record already carries a `country` ISO-2 code).

Inputs
  - raw-tracks.json        : Phase-1 output; each track has a multi-artist
                             `artists` list + title (already on disk).
  - <repo>/data/artist/mbdump/artist : the extracted MusicBrainz artist JSON
                             dump (one artist JSON per line). Download
                             artist.tar.xz from the MB json-dumps and
                             `tar -xf` it; adjust ARTIST_DUMP if it lands
                             elsewhere.
  - country-coords.json    : ISO-2 -> { region } (same map the globe uses).

Output
  - artist-connections.csv : one row per collaborating-artist pair, schema
                             matching the network-map page.

Run: python build_connections_offline.py
"""

import os, json, csv
from itertools import combinations
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))           # project/data
REPO = os.path.dirname(os.path.dirname(HERE))               # repo root

# The artist dump was extracted into the repo-root data/ folder.
ARTIST_DUMP = os.path.join(REPO, "data", "artist", "mbdump", "artist")
RAW_TRACKS  = os.path.join(HERE, "raw-tracks.json")
COORDS      = os.path.join(HERE, "country-coords.json")
OUT_FILE    = os.path.join(HERE, "artist-connections.csv")


def country_of(artist_json):
    """ISO-2 country for an artist: prefer `country`, fall back to area codes."""
    c = artist_json.get("country")
    if c:
        return c
    for key in ("area", "begin-area"):
        a = artist_json.get(key)
        if isinstance(a, dict):
            codes = a.get("iso-3166-1-codes")
            if codes:
                return codes[0]
    return None


# ── Load region map (ISO-2 -> region) from the viz's coord file ──────────────
with open(COORDS, encoding="utf-8") as f:
    coords = json.load(f)
ISO_TO_REGION = {iso: info["region"] for iso, info in coords.items()}

# ── Load tracks + collect the set of artist MBIDs we actually need ───────────
print("Loading raw-tracks.json …")
with open(RAW_TRACKS, encoding="utf-8") as f:
    raw_tracks = json.load(f)

needed_ids = set()
for t in raw_tracks:
    for a in t.get("artists", []):
        if a.get("artist_id"):
            needed_ids.add(a["artist_id"])
print(f"  tracks: {len(raw_tracks):,} | unique artists needed: {len(needed_ids):,}")

# ── Stream the artist dump, keeping only the artists we need ─────────────────
print(f"Scanning artist dump: {ARTIST_DUMP}")
if not os.path.exists(ARTIST_DUMP):
    raise SystemExit(f"Artist dump not found at {ARTIST_DUMP}\n"
                     f"Download artist.tar.xz from the MB json-dumps and extract it, "
                     f"or edit ARTIST_DUMP at the top of this script.")

artist_country = {}     # MBID -> ISO-2
scanned = 0
with open(ARTIST_DUMP, encoding="utf-8") as f:
    for line in f:
        scanned += 1
        if scanned % 250000 == 0:
            print(f"  {scanned:,} artists scanned, {len(artist_country):,}/{len(needed_ids):,} matched")
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        aid = obj.get("id")
        if aid in needed_ids:
            c = country_of(obj)
            if c:
                artist_country[aid] = c
print(f"  matched countries for {len(artist_country):,}/{len(needed_ids):,} artists")

# ── Build pairwise collaborations ────────────────────────────────────────────
print("Building collaboration pairs …")
pair_records = {}
skipped_single = skipped_no_region = 0

for t in raw_tracks:
    artists = t.get("artists", [])
    if len(artists) < 2:
        skipped_single += 1
        continue
    yr = t.get("year")
    year_int = int(yr) if (isinstance(yr, str) and yr.isdigit()) else (yr if isinstance(yr, int) else None)

    for a, b in combinations(artists, 2):
        a_id, b_id = a.get("artist_id"), b.get("artist_id")
        if not a_id or not b_id or a_id == b_id:
            continue
        a_c = artist_country.get(a_id)
        b_c = artist_country.get(b_id)
        a_r = ISO_TO_REGION.get(a_c)
        b_r = ISO_TO_REGION.get(b_c)
        if not a_r or not b_r:
            skipped_no_region += 1
            continue
        # Canonicalise pair order.
        ax, bx = a, b
        if a_id > b_id:
            a_id, b_id = b_id, a_id
            ax, bx = b, a
            a_c, b_c = b_c, a_c
            a_r, b_r = b_r, a_r
        key = (a_id, b_id)
        rec = pair_records.get(key)
        if rec is None:
            pair_records[key] = {
                "artist_id": a_id, "artist_name": ax.get("artist_name", ""),
                "country": a_c, "region": a_r,
                "collaborator_id": b_id, "collaborator_name": bx.get("artist_name", ""),
                "collab_country": b_c, "collab_region": b_r,
                "collaboration_count": 1,
                "year": year_int if year_int is not None else "",
            }
        else:
            rec["collaboration_count"] += 1
            if year_int is not None and (rec["year"] == "" or year_int < rec["year"]):
                rec["year"] = year_int

print(f"  tracks with one artist (skipped): {skipped_single:,}")
print(f"  pairs dropped for missing region: {skipped_no_region:,}")
print(f"  unique collaboration pairs: {len(pair_records):,}")

# ── Write CSV ────────────────────────────────────────────────────────────────
with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "artist_id","artist_name","country","region",
        "collaborator_id","collaborator_name","collab_country","collab_region",
        "collaboration_count","year",
    ])
    writer.writeheader()
    writer.writerows(pair_records.values())
print(f"\nWrote {len(pair_records):,} pairs to {OUT_FILE}")

# ── Sanity check ─────────────────────────────────────────────────────────────
cross = sum(1 for r in pair_records.values() if r["region"] != r["collab_region"])
euro  = sum(1 for r in pair_records.values()
            if (r["region"] == "Europe") != (r["collab_region"] == "Europe"))
print(f"  cross-region pairs: {cross:,}")
print(f"  Europe <-> non-Europe pairs: {euro:,}")

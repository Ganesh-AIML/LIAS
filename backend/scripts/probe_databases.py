"""F.0: Probe Neon + Atlas to determine migration status.

Read-only: lists table/collection counts on both sides.
Run: python scripts/probe_databases.py (from backend/)
"""
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

DATABASE_URL = os.getenv("DATABASE_URL", "")
neon_ok = False
neon_tables = {}
if not DATABASE_URL:
    print("[NEON] DATABASE_URL not set -- skipping")
else:
    try:
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' ORDER BY table_name"
        )
        tables = [r[0] for r in cur.fetchall()]
        for t in tables:
            cur.execute(f'SELECT COUNT(*) FROM "{t}"')
            neon_tables[t] = cur.fetchone()[0]
        cur.close()
        conn.close()
        neon_ok = True
    except Exception as e:
        print(f"[NEON] Connection failed: {e}")

MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "lias")
atlas_ok = False
atlas_colls = {}
if not MONGO_URI:
    print("[ATLAS] MONGO_URI not set -- skipping")
else:
    try:
        import pymongo
        client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=8000)
        client.admin.command("ping")
        mdb = client[MONGO_DB_NAME]
        for name in mdb.list_collection_names():
            atlas_colls[name] = mdb[name].count_documents({})
        atlas_ok = True
    except Exception as e:
        print(f"[ATLAS] Connection failed: {e}")

print()
print("=" * 72)
print(f"  DATABASE PROBE: {MONGO_DB_NAME}")
print("=" * 72)

print()
print("-- NEON (PostgreSQL) --")
if not neon_ok:
    print("  (not connected)")
else:
    if not neon_tables:
        print("  (no public tables found)")
    else:
        total = 0
        for t, c in sorted(neon_tables.items()):
            print(f"  {t:<30s} {c:>10,d}")
            total += c
        print(f"  {'TOTAL':<30s} {total:>10,d}")

print()
print("-- ATLAS (MongoDB) --")
if not atlas_ok:
    print("  (not connected)")
else:
    if not atlas_colls:
        print("  (no collections found)")
    else:
        total = 0
        for name, c in sorted(atlas_colls.items()):
            print(f"  {name:<30s} {c:>10,d}")
            total += c
        print(f"  {'TOTAL':<30s} {total:>10,d}")

if neon_ok and atlas_ok:
    print()
    print("-- SIDE-BY-SIDE (Neon vs Atlas) --")
    all_keys = sorted(set(list(neon_tables.keys()) + list(atlas_colls.keys())))
    print(f"  {'Collection':<30s} {'Neon':>10s} {'Atlas':>10s} {'Delta':>10s}")
    print(f"  {'-'*30} {'-'*10} {'-'*10} {'-'*10}")
    for k in all_keys:
        nv = neon_tables.get(k, 0)
        av = atlas_colls.get(k, 0)
        delta = av - nv
        marker = " <<<" if abs(delta) > 0 else ""
        print(f"  {k:<30s} {nv:>10,d} {av:>10,d} {delta:>+10,d}{marker}")

print()
print("=" * 72)
if neon_ok and atlas_ok:
    if any(atlas_colls.values()):
        print("VERDICT: Mongo populated -- migration likely ran.")
    else:
        print("VERDICT: Mongo EMPTY -- migration never ran or data was purged.")
elif neon_ok and not atlas_ok:
    print("VERDICT: Neon has data but Atlas unreachable.")
elif not neon_ok and atlas_ok:
    print("VERDICT: Neon unreachable but Atlas has data.")
else:
    print("VERDICT: Neither database reachable.")
print("=" * 72)

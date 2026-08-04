"""F.2: Verify production Mongo indexes match the MONGO_INDEXES spec.

Read-only: lists actual indexes per collection vs expected.
Run: python scripts/verify_indexes.py (from backend/)
"""
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from app.mongo_indexes import MONGO_INDEXES
from app.repositories import COLLECTIONS
from app.database import get_mongo_client

MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "lias")

def verify():
    client = get_mongo_client()
    if client is None:
        print("MONGO_URI not set -- cannot verify")
        return False
    client.admin.command("ping")
    mdb = client[MONGO_DB_NAME]

    all_ok = True
    all_collections = set(list(MONGO_INDEXES.keys()) + list(COLLECTIONS.values()))

    print(f"Verifying indexes on database: {MONGO_DB_NAME}")
    print("=" * 72)

    for coll_name in sorted(all_collections):
        coll = mdb[coll_name]
        actual = coll.index_information()

        expected_specs = MONGO_INDEXES.get(coll_name, [])
        expected_names = {name: (keys, unique) for name, keys, unique in expected_specs}

        # Check _id (always present)
        actual_non_id = {k: v for k, v in actual.items() if k != "_id"}

        print(f"\n{coll_name}:")
        print(f"  Actual indexes: {len(actual)} (including _id)")
        print(f"  Expected from MONGO_INDEXES: {len(expected_specs)}")

        # Check each expected index exists
        for name, (keys, unique) in expected_names.items():
            if name not in actual:
                print(f"  MISSING: {name} (keys={keys}, unique={unique})")
                all_ok = False
            else:
                idx = actual[name]
                actual_unique = idx.get("unique", False)
                if actual_unique != unique:
                    print(f"  MISMATCH: {name} unique={actual_unique} (expected {unique})")
                    all_ok = False

        # Check for unexpected non-_id indexes
        extra = set(actual_non_id.keys()) - set(expected_names.keys())
        if extra:
            print(f"  EXTRA (not in MONGO_INDEXES): {sorted(extra)}")

        # Report actual indexes
        for name, idx in sorted(actual_non_id.items()):
            keys = idx.get("key", [])
            unique = idx.get("unique", False)
            status = "OK" if name in expected_names else "EXTRA"
            print(f"  [{status}] {name}: keys={keys} unique={unique}")

    print()
    print("=" * 72)
    if all_ok:
        print("RESULT: All expected indexes present and correct.")
    else:
        print("RESULT: Index issues found -- see above.")
    print("=" * 72)
    return all_ok

if __name__ == "__main__":
    ok = verify()
    raise SystemExit(0 if ok else 1)

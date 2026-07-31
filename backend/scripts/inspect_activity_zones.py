"""Inspect what Garmin actually returns for time-in-zone, on a real account.

Run once, against your own data, before trusting `_zone_bands`:

    python scripts/inspect_activity_zones.py            # 5 most recent runs
    python scripts/inspect_activity_zones.py --limit 20

It reads the stored Garmin tokens for the first user that has them (same
decryption path as the sync), calls `hrTimeInZones` on recent RUN activities,
and prints the raw payload next to what `_zone_bands` +
`load_service.redistribute_zone_seconds` make of it — including the TRIMP each
way, which is the whole point of the exercise.

The payload shape varies by watch model and activity type. This script exists to
show you the real one rather than the one the docs promise; it writes nothing.
"""

import argparse
import asyncio
import json

from app.core.crypto import decrypt_token_blob
from app.core.db import get_db
from app.models.activity import SportType
from app.services import garmin_sync_service, load_service


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=5, help="how many runs to inspect")
    args = parser.parse_args()

    db = get_db()
    credentials = await db.garmin_credentials.find_one({"encrypted_tokens": {"$ne": None}})
    if credentials is None:
        print("Aucun compte Garmin connecté en base.")
        return
    user_id = credentials["user_id"]

    profile = await db.fitness_profiles.find_one({"user_id": user_id}) or {}
    hr_max, hr_rest = profile.get("hr_max"), profile.get("hr_rest")
    print(f"user_id={user_id}  hr_max={hr_max}  hr_rest={hr_rest}")
    if not hr_max or not hr_rest:
        print("Profil FC incomplet : la redistribution ne sera pas calculée.")

    token_blob = decrypt_token_blob(credentials["encrypted_tokens"])
    client = await asyncio.to_thread(garmin_sync_service._restore_client_sync, token_blob)

    cursor = (
        db.activities.find({"user_id": user_id, "sport": SportType.RUN.value})
        .sort("start_time", -1)
        .limit(args.limit)
    )
    async for doc in cursor:
        activity_id = doc.get("garmin_activity_id")
        if activity_id is None:
            continue
        print("\n" + "=" * 72)
        print(f"activity {activity_id}  {doc.get('start_time')}  {doc.get('duration_s')}s")
        try:
            payload = await asyncio.to_thread(client.get_activity_hr_in_timezones, str(activity_id))
        except Exception as exc:  # noqa: BLE001 — this is an exploration tool
            print(f"  appel en échec : {exc!r}")
            continue

        print("--- payload brut ---")
        print(json.dumps(payload, indent=2, ensure_ascii=False)[:2000])

        bands = garmin_sync_service._zone_bands(payload)
        print(f"--- bandes extraites ({len(bands)}) ---")
        for low, high, seconds in bands:
            print(f"  [{low:.0f} → {high:.0f}[  {seconds:.0f}s")

        if not (hr_max and hr_rest) or not bands:
            continue
        zone_seconds = load_service.redistribute_zone_seconds(bands, hr_max, hr_rest)
        if zone_seconds is None:
            print("  rien d'exploitable après redistribution")
            continue
        print("--- redistribué sur nos zones Karvonen ---")
        print("  " + "  ".join(f"Z{i + 1}={s:.0f}s" for i, s in enumerate(zone_seconds)))
        print(f"  somme={sum(zone_seconds):.0f}s (durée stockée : {doc.get('duration_s')}s)")

        by_zones = load_service.compute_trimp(
            doc.get("duration_s") or 0,
            doc.get("avg_hr"),
            hr_max,
            hr_rest,
            zone_seconds=zone_seconds,
        )
        by_avg = load_service.compute_trimp(
            doc.get("duration_s") or 0, doc.get("avg_hr"), hr_max, hr_rest
        )
        print(f"  TRIMP par zones={by_zones}  vs par FC moyenne={by_avg}")


if __name__ == "__main__":
    asyncio.run(main())

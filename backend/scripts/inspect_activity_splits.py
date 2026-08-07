"""Inspect what Garmin actually returns for per-lap splits, on a real account.

Run once, against your own data, before trusting any field name here:

    python scripts/inspect_activity_splits.py            # 3 most recent runs
    python scripts/inspect_activity_splits.py --limit 10
    python scripts/inspect_activity_splits.py --activity-id 123456789

Why this exists: the estimated race time is built by extrapolating ONE recent
run with Riegel, and the run it picks is taken whole — warm-up and cool-down
included. A structured test session (12 min warm-up, 2 km flat out, 11 min easy)
therefore extrapolates the average of all three, which came out 22 minutes slow
on a half marathon.

The watch knows better: it labels each lap (Échauffement / Course à pied /
Récupération). The question this script answers is what that label is CALLED in
the payload, because the garmin-sync skill is explicit that shape varies by watch
model — guessing a field name would produce code that silently never fires.

It calls both `/splits` (lapDTOs) and `/typedsplits`, prints the raw payload
next to what `_laps` currently extracts, and lists every key seen on a lap so a
type field can't hide. Read-only: it writes nothing.
"""

import argparse
import asyncio
import json

from app.core.crypto import decrypt_token_blob
from app.core.db import get_db
from app.models.activity import SportType
from app.services import garmin_sync_service

# Field names that would plausibly carry "this lap is a warm-up". Printed
# prominently when found — the point is to learn the real one, not to rely on
# this list being right.
_TYPE_HINTS = ("intensity", "type", "step", "phase", "category")


def _fmt_pace(seconds: float, metres: float) -> str:
    if metres <= 0 or seconds <= 0:
        return "—"
    pace = seconds / (metres / 1000)
    minutes, secs = divmod(round(pace), 60)
    return f"{minutes}:{secs:02d}/km"


def _describe_keys(laps: list) -> None:
    """Every key seen across the laps, with the type-ish ones called out."""
    keys: set[str] = set()
    for lap in laps:
        if isinstance(lap, dict):
            keys.update(lap.keys())
    if not keys:
        return
    suspects = sorted(k for k in keys if any(h in k.lower() for h in _TYPE_HINTS))
    print(f"  clés vues sur les tours ({len(keys)}) : {', '.join(sorted(keys))}")
    if suspects:
        print(f"  >>> candidats pour le type d'étape : {', '.join(suspects)}")
        for lap in laps:
            if isinstance(lap, dict):
                values = {k: lap.get(k) for k in suspects}
                print(f"      {values}")
    else:
        print("  >>> AUCUN champ de type d'étape trouvé sur cette activité.")


async def _dump(client, activity_id: int) -> None:
    for label, method in (
        ("/splits (lapDTOs)", "get_activity_splits"),
        ("/typedsplits", "get_activity_typed_splits"),
    ):
        print(f"\n--- {label} ---")
        try:
            payload = await asyncio.to_thread(getattr(client, method), str(activity_id))
        except Exception as exc:  # noqa: BLE001 — this is an exploration tool
            print(f"  appel en échec : {exc!r}")
            continue

        print(json.dumps(payload, indent=2, ensure_ascii=False)[:3000])
        laps = (payload or {}).get("lapDTOs") if isinstance(payload, dict) else None
        if isinstance(laps, list) and laps:
            _describe_keys(laps)

    # What the sync would store today, so the gap is visible side by side.
    try:
        payload = await asyncio.to_thread(client.get_activity_splits, str(activity_id))
    except Exception:  # noqa: BLE001
        return
    rows = garmin_sync_service._laps(payload)
    print(f"\n--- ce que `_laps` en extrait aujourd'hui ({len(rows)} tours) ---")
    total_s = total_m = 0.0
    for row in rows:
        total_s += row["duration_s"]
        total_m += row["distance_m"]
        print(
            f"  {row['index']:>2}. {row['distance_m']:>7.0f} m  {row['duration_s']:>5}s  "
            f"{_fmt_pace(row['duration_s'], row['distance_m']):>9}  fc={row['avg_hr']}"
        )
    if rows:
        print(f"  TOTAL {total_m:.0f} m  {total_s:.0f}s  {_fmt_pace(total_s, total_m)}")
        print("  ^ c'est cette moyenne-là que Riegel extrapole aujourd'hui.")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=3, help="how many recent runs to inspect")
    parser.add_argument("--activity-id", type=int, help="inspect one activity instead")
    args = parser.parse_args()

    db = get_db()
    credentials = await db.garmin_credentials.find_one({"encrypted_tokens": {"$ne": None}})
    if credentials is None:
        print("Aucun compte Garmin connecté en base.")
        return
    user_id = credentials["user_id"]
    print(f"user_id={user_id}")

    token_blob = decrypt_token_blob(credentials["encrypted_tokens"])
    client = await asyncio.to_thread(garmin_sync_service._restore_client_sync, token_blob)

    if args.activity_id is not None:
        print("\n" + "=" * 72)
        print(f"activity {args.activity_id}")
        await _dump(client, args.activity_id)
        return

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
        print(
            f"activity {activity_id}  {doc.get('start_time')}  "
            f"{doc.get('duration_s')}s  {doc.get('distance_m')}m"
        )
        await _dump(client, int(activity_id))


if __name__ == "__main__":
    asyncio.run(main())

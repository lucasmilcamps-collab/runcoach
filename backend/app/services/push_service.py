"""Web Push (VAPID) delivery.

Only the VAPID private key is configured; the browser applicationServerKey is
derived from it. Subscriptions live in `push_subscriptions` (one per browser,
keyed by endpoint). `send_due_notifications` is what the daily scheduler calls:
it builds each user's messages (today's session + a replan nudge) and pushes.
No health data is ever logged (project security rules)."""

import asyncio
import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime

from cryptography.hazmat.primitives import serialization
from motor.motor_asyncio import AsyncIOMotorDatabase
from py_vapid import Vapid01
from pywebpush import WebPushException, webpush

from app.core.config import settings
from app.models.push import PushSubscriptionIn
from app.services import plan_progress, plan_service

_PUSH_TTL_S = 3600  # a stale "today's session" is worthless — don't queue it long

# French session labels for notification copy (mirrors the mobile SESSION_LABELS).
_SESSION_LABELS: dict[str, str] = {
    "easy": "Footing",
    "long_run": "Sortie longue",
    "tempo": "Tempo",
    "threshold": "Seuil",
    "intervals": "Fractionné",
    "recovery": "Récupération",
    "cross_training": "Cross-training",
    "rest": "Repos",
}


@dataclass(frozen=True)
class Notification:
    title: str
    body: str
    url: str = "/"


def get_public_key() -> str | None:
    """The browser applicationServerKey: base64url of the raw uncompressed public
    point, derived from the configured private key. None when push is off."""
    if not settings.vapid_private_key:
        return None
    vapid = Vapid01.from_string(settings.vapid_private_key)
    raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def save_subscription(
    db: AsyncIOMotorDatabase, user_id: str, sub: PushSubscriptionIn
) -> None:
    await db.push_subscriptions.update_one(
        {"user_id": user_id, "endpoint": sub.endpoint},
        {
            "$set": {
                "user_id": user_id,
                "endpoint": sub.endpoint,
                "keys": sub.keys.model_dump(),
                "updated_at": datetime.now(UTC),
            }
        },
        upsert=True,
    )


async def delete_subscription(db: AsyncIOMotorDatabase, user_id: str, endpoint: str) -> None:
    await db.push_subscriptions.delete_one({"user_id": user_id, "endpoint": endpoint})


def _send_sync(sub_doc: dict, payload: str) -> bool:
    """Push to one subscription. Returns True on delivery, False if the endpoint
    is gone (404/410 → caller prunes it). Re-raises other upstream errors so a
    transient failure isn't mistaken for a dead subscription."""
    try:
        webpush(
            subscription_info={"endpoint": sub_doc["endpoint"], "keys": sub_doc["keys"]},
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=_PUSH_TTL_S,
        )
        return True
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            return False
        raise


async def send_to_user(db: AsyncIOMotorDatabase, user_id: str, notification: Notification) -> int:
    """Deliver one notification to every browser the user has subscribed. Prunes
    dead subscriptions; a transient upstream error just skips that browser."""
    payload = json.dumps(
        {"title": notification.title, "body": notification.body, "url": notification.url}
    )
    sent = 0
    subs = [sub async for sub in db.push_subscriptions.find({"user_id": user_id})]
    for sub in subs:
        try:
            delivered = await asyncio.to_thread(_send_sync, sub, payload)
        except WebPushException:
            continue
        if delivered:
            sent += 1
        else:
            await db.push_subscriptions.delete_one({"_id": sub["_id"]})
    return sent


async def _notifications_for_user(db: AsyncIOMotorDatabase, user_id: str) -> list[Notification]:
    out: list[Notification] = []

    today = await plan_service.get_today_session(db, user_id)
    if today.has_session and today.sessions:
        primary = today.sessions[0]  # the day's primary session drives the notif
        adj = today.adjustment
        shown = adj.suggested_type if adj and adj.adjusted else primary.type
        label = _SESSION_LABELS.get(shown, "Séance")
        body = f"{label} · {primary.duration_min} min"
        if adj and adj.adjusted:
            body += " — ajustée selon ta forme"
        out.append(Notification(title="Séance du jour", body=body, url="/plan"))

    if await plan_service.unlogged_strength(db, user_id):
        out.append(
            Notification(
                title="Renfo à enregistrer",
                body="Tu as fait ton renfo d'hier ? Enregistre-le en 2 taps (avec le RPE) "
                "pour qu'il compte dans ta charge.",
                url="/add-activity",
            )
        )

    progress = await plan_progress.compute_progress(db, user_id)
    if progress.replan_suggested:
        out.append(
            Notification(
                title="Plan à réajuster",
                body=progress.replan_reason or "Ton plan mérite un réajustement.",
                url="/plan",
            )
        )

    return out


async def send_due_notifications(db: AsyncIOMotorDatabase) -> dict:
    """Build and send each subscribed user's due notifications. Called by the
    daily scheduler (secured /push/run). Returns a small summary (no health
    data)."""
    user_ids: list[str] = await db.push_subscriptions.distinct("user_id")
    notified = 0
    sent_total = 0
    for user_id in user_ids:
        notifications = await _notifications_for_user(db, user_id)
        if notifications:
            notified += 1
        for notification in notifications:
            sent_total += await send_to_user(db, user_id, notification)
    return {"users": len(user_ids), "notified": notified, "sent": sent_total}

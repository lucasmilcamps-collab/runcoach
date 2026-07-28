import base64
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01
from pywebpush import WebPushException

from app.models.activity import SportType
from app.models.plan import WEEKDAY_ORDER, Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import push_service


def _gen_private_key() -> str:
    v = Vapid01()
    v.generate_keys()
    der = v.private_key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return base64.urlsafe_b64encode(der).rstrip(b"=").decode()


def test_get_public_key_derives_from_private():
    key = _gen_private_key()
    with patch.object(push_service.settings, "vapid_private_key", key):
        pub = push_service.get_public_key()
    assert pub is not None and len(pub) == 87  # base64url of a 65-byte EC point


def test_get_public_key_none_when_unconfigured():
    with patch.object(push_service.settings, "vapid_private_key", ""):
        assert push_service.get_public_key() is None


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def _seed_subscription(db, user_id: str, endpoint: str = "https://push.example/abc") -> None:
    await db.push_subscriptions.insert_one(
        {
            "user_id": user_id,
            "endpoint": endpoint,
            "keys": {"p256dh": "p", "auth": "a"},
            "updated_at": datetime.now(UTC),
        }
    )


async def test_send_to_user_counts_delivered(db):
    user_id = await _seed_user(db)
    await _seed_subscription(db, user_id)
    with patch("app.services.push_service.webpush", MagicMock()):
        sent = await push_service.send_to_user(
            db, user_id, push_service.Notification("T", "B", "/")
        )
    assert sent == 1


async def test_send_to_user_prunes_stale_subscription(db):
    user_id = await _seed_user(db)
    await _seed_subscription(db, user_id)
    stale = WebPushException("gone")
    stale.response = SimpleNamespace(status_code=410)
    with patch("app.services.push_service.webpush", MagicMock(side_effect=stale)):
        sent = await push_service.send_to_user(
            db, user_id, push_service.Notification("T", "B", "/")
        )
    assert sent == 0
    assert await db.push_subscriptions.count_documents({"user_id": user_id}) == 0


async def _seed_today_plan(db, user_id: str) -> None:
    today = datetime.now(UTC).date()
    start = today - timedelta(days=today.weekday())
    weekday = WEEKDAY_ORDER[today.weekday()]
    session = Session(
        day=weekday, sport=SportType.RUN, type="tempo", duration_min=45, rationale="x"
    )
    week = Week(index=1, is_deload=False, target_load=100.0, sessions=[session])
    plan = Plan(goal=PlanGoal(description="Semi"), phases=[Phase(name="base", weeks=[week])])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "request": {
                "goal_type": "distance",
                "distance_km": 21.1,
                "available_days": list(Weekday),
                "max_run_sessions_per_week": 3,
                "fixed_sports": [],
            },
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )


async def test_send_due_notifications_pushes_todays_session(db):
    user_id = await _seed_user(db)
    await _seed_subscription(db, user_id)
    await _seed_today_plan(db, user_id)

    with patch("app.services.push_service.webpush", MagicMock()):
        summary = await push_service.send_due_notifications(db)

    assert summary["users"] == 1
    assert summary["notified"] == 1
    assert summary["sent"] >= 1


async def test_subscribe_and_unsubscribe_endpoints(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    sub = {"endpoint": "https://push.example/xyz", "keys": {"p256dh": "p", "auth": "a"}}

    r1 = await client.post("/api/v1/push/subscribe", headers=headers, json=sub)
    assert r1.status_code == 204
    assert await db.push_subscriptions.count_documents({"endpoint": sub["endpoint"]}) == 1

    r2 = await client.post(
        "/api/v1/push/unsubscribe", headers=headers, json={"endpoint": sub["endpoint"]}
    )
    assert r2.status_code == 204
    assert await db.push_subscriptions.count_documents({"endpoint": sub["endpoint"]}) == 0


async def test_run_endpoint_requires_secret(client, db):
    # No secret configured / no header → forbidden.
    r = await client.post("/api/v1/push/run")
    assert r.status_code == 403

    with patch.object(push_service.settings, "push_run_secret", "s3cr3t"):
        bad = await client.post("/api/v1/push/run", headers={"X-Push-Secret": "nope"})
        assert bad.status_code == 403
        ok = await client.post("/api/v1/push/run", headers={"X-Push-Secret": "s3cr3t"})
        assert ok.status_code == 200
        assert ok.json() == {"users": 0, "notified": 0, "sent": 0}


async def test_public_key_endpoint(client):
    key = _gen_private_key()
    with patch.object(push_service.settings, "vapid_private_key", key):
        r = await client.get("/api/v1/push/public-key")
    assert r.status_code == 200
    assert len(r.json()["public_key"]) == 87

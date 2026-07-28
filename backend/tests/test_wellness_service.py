from datetime import UTC, datetime, timedelta

from app.services import wellness_service


def test_mean_field_needs_min_samples():
    assert wellness_service._mean_field([{"hrv": 40} for _ in range(6)], "hrv") is None
    assert wellness_service._mean_field([{"hrv": 40} for _ in range(7)], "hrv") == 40.0


def test_mean_field_ignores_missing_and_bools():
    docs = [{"hrv": 40}, {"hrv": None}, {"hrv": True}, {}] + [{"hrv": 50} for _ in range(6)]
    # 40 + six 50s = 7 valid samples, mean ≈ 48.6
    assert wellness_service._mean_field(docs, "hrv") == 48.6


def test_short_night_streak_counts_consecutive():
    docs_desc = [
        {"sleep_seconds": 5 * 3600},
        {"sleep_seconds": 5 * 3600},
        {"sleep_seconds": 8 * 3600},
    ]
    assert wellness_service._short_night_streak(docs_desc) == 2


def test_short_night_streak_breaks_on_missing_night():
    assert wellness_service._short_night_streak([{"foo": 1}, {"sleep_seconds": 5 * 3600}]) == 0


async def test_get_recovery_signals_computes_baselines(db):
    user_id = "u1"
    today = datetime.now(UTC).date()
    for i in range(1, 11):  # 10 prior days establish the baseline
        await db.wellness_daily.insert_one(
            {
                "user_id": user_id,
                "day": (today - timedelta(days=i)).isoformat(),
                "hrv": 50,
                "resting_hr": 50,
                "sleep_seconds": 8 * 3600,
            }
        )
    await db.wellness_daily.insert_one(
        {
            "user_id": user_id,
            "day": today.isoformat(),
            "hrv": 40,
            "resting_hr": 58,
            "sleep_seconds": 5 * 3600,
            "body_battery": 72,
        }
    )

    signals = await wellness_service.get_recovery_signals(db, user_id, today)

    assert signals.hrv == 40
    assert signals.hrv_baseline == 50  # today excluded from its own baseline
    assert signals.resting_hr == 58
    assert signals.resting_hr_baseline == 50
    assert signals.sleep_hours == 5.0
    assert signals.body_battery == 72
    assert signals.short_nights_streak == 1
    assert signals.data_date == today


async def test_get_recovery_signals_empty_when_no_data(db):
    signals = await wellness_service.get_recovery_signals(db, "nobody", datetime.now(UTC).date())
    assert signals.hrv is None
    assert signals.hrv_baseline is None
    assert signals.short_nights_streak == 0

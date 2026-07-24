from app.services import plan_adaptation
from app.services.plan_adaptation import RecoverySignals


def test_high_fatigue_downgrades_quality_to_easy():
    adj = plan_adaptation.adjust_for_form("intervals", tsb=-30.0)
    assert adj.adjusted is True
    assert adj.suggested_type == "easy"
    assert "allégée" in adj.reason


def test_high_fatigue_downgrades_easy_to_recovery():
    adj = plan_adaptation.adjust_for_form("easy", tsb=-40.0)
    assert adj.adjusted is True
    assert adj.suggested_type == "recovery"


def test_normal_form_keeps_session():
    adj = plan_adaptation.adjust_for_form("threshold", tsb=0.0)
    assert adj.adjusted is False
    assert adj.suggested_type == "threshold"


def test_fresh_form_keeps_session():
    adj = plan_adaptation.adjust_for_form("long_run", tsb=15.0)
    assert adj.adjusted is False


def test_rest_stays_rest():
    adj = plan_adaptation.adjust_for_form("rest", tsb=-50.0)
    assert adj.adjusted is False
    assert adj.suggested_type == "rest"


def test_recovery_at_high_fatigue_downgrades_to_rest():
    adj = plan_adaptation.adjust_for_form("recovery", tsb=-30.0)
    assert adj.adjusted is True
    assert adj.suggested_type == "rest"


def test_boundary_tsb_not_fatigued():
    # Exactly the threshold is not "below" it → session kept.
    adj = plan_adaptation.adjust_for_form("tempo", tsb=plan_adaptation.TSB_HIGH_FATIGUE)
    assert adj.adjusted is False


# --- Wellness signals (HRV / resting HR / sleep) ---------------------------


def test_autonomic_stress_downgrades_quality():
    # HRV >10% below baseline AND resting HR >5 bpm above → downgrade a notch.
    sig = RecoverySignals(hrv=40, hrv_baseline=50, resting_hr=58, resting_hr_baseline=50)
    adj = plan_adaptation.adjust_session("intervals", tsb=0.0, signals=sig)
    assert adj.adjusted is True
    assert adj.suggested_type == "easy"
    assert "HRV" in adj.reason


def test_autonomic_stress_needs_both_signals():
    # HRV low but resting HR normal → too noisy alone, session kept.
    sig = RecoverySignals(hrv=40, hrv_baseline=50, resting_hr=50, resting_hr_baseline=50)
    adj = plan_adaptation.adjust_session("intervals", tsb=0.0, signals=sig)
    assert adj.adjusted is False


def test_autonomic_dormant_without_baseline():
    # No baseline (thin history) → the autonomic rule never fires.
    sig = RecoverySignals(hrv=40, resting_hr=60)
    adj = plan_adaptation.adjust_session("intervals", tsb=0.0, signals=sig)
    assert adj.adjusted is False


def test_short_nights_block_high_intensity():
    sig = RecoverySignals(short_nights_streak=2)
    adj = plan_adaptation.adjust_session("threshold", tsb=0.0, signals=sig)
    assert adj.adjusted is True
    assert adj.suggested_type == "easy"
    assert "nuits" in adj.reason


def test_short_nights_do_not_block_easy_session():
    # The rule only rules out Z4/Z5; an easy run is fine on short sleep.
    sig = RecoverySignals(short_nights_streak=3)
    adj = plan_adaptation.adjust_session("easy", tsb=0.0, signals=sig)
    assert adj.adjusted is False


def test_combined_signals_take_most_conservative():
    sig = RecoverySignals(
        hrv=40, hrv_baseline=50, resting_hr=58, resting_hr_baseline=50, short_nights_streak=2
    )
    adj = plan_adaptation.adjust_session("intervals", tsb=-30.0, signals=sig)
    assert adj.adjusted is True
    assert adj.suggested_type == "easy"
    assert "TSB" in adj.reason


def test_no_signals_keeps_session():
    adj = plan_adaptation.adjust_session("tempo", tsb=0.0)
    assert adj.adjusted is False

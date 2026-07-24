from app.services import plan_adaptation


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

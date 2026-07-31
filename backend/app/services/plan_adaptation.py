"""Deterministic daily session adjustment (training-science skill, "Signaux de
récupération"). No AI, no cost: given the day's planned session type, the
athlete's current form (TSB) and their overnight recovery signals (HRV, resting
HR, sleep), downgrade the session when the body says "back off" — and always
explain why (transparence = confiance).

Three transparent rules, combined by taking the most conservative outcome:
  1. TSB < −25 (high fatigue)                    → downgrade one notch.
  2. HRV < baseline −10 % AND FC repos > +5 bpm  → downgrade one notch.
  3. ≥ 2 consecutive nights < 6 h                → no Z4/Z5 today (→ easy).

Only downgrades; a planned stimulus is never upgraded (building fitness needs
it). Signals are optional: with no wellness data, only rule 1 applies.
"""

from dataclasses import dataclass
from datetime import date

# TSB below this = high fatigue → lighten the day (training-science: TSB < −25).
TSB_HIGH_FATIGUE = -25.0
# HRV more than 10 % under its 30-day baseline (training-science).
HRV_DROP_RATIO = 0.90
# Resting HR more than this many bpm over baseline (training-science: +5 bpm).
RHR_RISE_BPM = 5.0
# Consecutive short nights that forbid high intensity (training-science: 2 nights).
SHORT_NIGHTS_FOR_NO_INTENSITY = 2

# Run sessions that sit in Z4/Z5 — the ones short sleep specifically rules out.
_HIGH_INTENSITY: frozenset[str] = frozenset({"threshold", "intervals"})

# One-notch downgrade ladder (quality → Z2 → recovery → rest).
_DOWNGRADE: dict[str, str] = {
    "intervals": "easy",
    "threshold": "easy",
    "tempo": "easy",
    "long_run": "easy",
    "easy": "recovery",
    "cross_training": "recovery",
    "recovery": "rest",
    "rest": "rest",
}

# Lightness rank (smaller = lighter) — lets us pick the most conservative target
# when several rules fire at once.
_RANK: dict[str, int] = {
    "rest": 0,
    "recovery": 1,
    "easy": 2,
    "cross_training": 2,
    "tempo": 3,
    "long_run": 3,
    "threshold": 4,
    "intervals": 5,
}


@dataclass(frozen=True)
class RecoverySignals:
    """The athlete's overnight recovery state, as read from Garmin wellness data
    by wellness_service. The rule fields (hrv/resting_hr + baselines,
    short_nights_streak) drive the adjustment; sleep_hours / body_battery /
    data_date are carried for display only."""

    hrv: float | None = None
    hrv_baseline: float | None = None
    resting_hr: float | None = None
    resting_hr_baseline: float | None = None
    short_nights_streak: int = 0
    sleep_hours: float | None = None
    body_battery: int | None = None
    data_date: date | None = None


class Adjustment:
    __slots__ = ("adjusted", "original_type", "suggested_type", "reason")

    def __init__(self, adjusted: bool, original_type: str, suggested_type: str, reason: str):
        self.adjusted = adjusted
        self.original_type = original_type
        self.suggested_type = suggested_type
        self.reason = reason


def _autonomic_stress(s: RecoverySignals) -> bool:
    """HRV suppressed AND resting HR elevated, both vs their baselines — the
    combined signal the skill treats as a real recovery deficit (either alone is
    too noisy to act on)."""
    if None in (s.hrv, s.hrv_baseline, s.resting_hr, s.resting_hr_baseline):
        return False
    if s.hrv_baseline <= 0:
        return False
    hrv_low = s.hrv < s.hrv_baseline * HRV_DROP_RATIO
    rhr_high = s.resting_hr > s.resting_hr_baseline + RHR_RISE_BPM
    return hrv_low and rhr_high


def adjust_session(
    session_type: str, tsb: float, signals: RecoverySignals | None = None
) -> Adjustment:
    """Return the (possibly downgraded) session type plus a plain explanation.

    Collects every triggered recovery rule, then applies the single most
    conservative downgrade so the athlete never gets double-penalised — but the
    reason lists every signal that fired, for transparency."""
    if session_type == "rest":
        return Adjustment(False, "rest", "rest", "Jour de repos prévu.")

    s = signals or RecoverySignals()
    triggers: list[tuple[str, str]] = []  # (candidate target type, reason fragment)

    if tsb < TSB_HIGH_FATIGUE:
        triggers.append((_DOWNGRADE.get(session_type, "easy"), f"forme basse (TSB {tsb:+.0f})"))

    if _autonomic_stress(s):
        triggers.append(
            (
                _DOWNGRADE.get(session_type, "easy"),
                f"récupération incomplète (HRV {s.hrv:.0f} vs base {s.hrv_baseline:.0f}, "
                f"FC repos {s.resting_hr:.0f} vs {s.resting_hr_baseline:.0f})",
            )
        )

    if s.short_nights_streak >= SHORT_NIGHTS_FOR_NO_INTENSITY and session_type in _HIGH_INTENSITY:
        triggers.append(("easy", f"{s.short_nights_streak} nuits courtes (< 6 h)"))

    if not triggers:
        return Adjustment(
            False, session_type, session_type, "Forme et récupération OK : séance maintenue."
        )

    # Most conservative (lightest) target across all fired rules.
    target = min((t for t, _ in triggers), key=lambda tp: _RANK.get(tp, 99))
    reasons = " ; ".join(fragment for _, fragment in triggers)

    if _RANK.get(target, 99) >= _RANK.get(session_type, 99):
        # Rules fired but the session is already at/under the suggested level.
        return Adjustment(
            False,
            session_type,
            session_type,
            f"Signaux de fatigue ({reasons}) mais séance déjà légère : maintenue.",
        )

    return Adjustment(True, session_type, target, f"Séance allégée — {reasons}.")


# Backwards-compatible alias: form-only adjustment (no wellness signals).
def adjust_for_form(session_type: str, tsb: float) -> Adjustment:
    return adjust_session(session_type, tsb, None)

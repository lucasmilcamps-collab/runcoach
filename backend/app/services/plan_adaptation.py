"""Deterministic daily session adjustment (training-science skill, "Signaux de
récupération"). No AI, no cost: given the day's planned session type and the
athlete's current form (TSB), downgrade one notch when fatigue is high, and
always explain why (transparence = confiance).

HRV / resting-HR / sleep signals from the skill's rules will plug in here once
Garmin wellness sync exists; for now TSB is the available form signal.
"""

# TSB below this = high fatigue → lighten the day (training-science: TSB < −25).
TSB_HIGH_FATIGUE = -25.0

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


class Adjustment:
    __slots__ = ("adjusted", "original_type", "suggested_type", "reason")

    def __init__(self, adjusted: bool, original_type: str, suggested_type: str, reason: str):
        self.adjusted = adjusted
        self.original_type = original_type
        self.suggested_type = suggested_type
        self.reason = reason


def adjust_for_form(session_type: str, tsb: float) -> Adjustment:
    """Return the (possibly downgraded) session type plus a plain explanation.

    Only downgrades on high fatigue; never upgrades a planned session (building
    fitness needs the planned stimulus). A rest day stays rest."""
    if session_type == "rest":
        return Adjustment(False, "rest", "rest", "Jour de repos prévu.")

    if tsb < TSB_HIGH_FATIGUE:
        suggested = _DOWNGRADE.get(session_type, "easy")
        if suggested == session_type:
            return Adjustment(
                False,
                session_type,
                session_type,
                f"Forme basse (TSB {tsb:+.0f}) mais séance déjà légère : maintenue.",
            )
        return Adjustment(
            True,
            session_type,
            suggested,
            f"Forme basse (TSB {tsb:+.0f}, fatigue élevée) : séance allégée d'un cran "
            "pour préserver la récupération.",
        )

    return Adjustment(False, session_type, session_type, "Forme correcte : séance maintenue.")

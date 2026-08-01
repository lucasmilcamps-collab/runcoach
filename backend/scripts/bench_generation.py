"""Time one real plan generation, and say where the time went.

    export ANTHROPIC_API_KEY=sk-...
    PYTHONPATH=. python scripts/bench_generation.py --weeks 17
    PYTHONPATH=. python scripts/bench_generation.py --weeks 17 --no-structure

Calls the Anthropic API with the production prompt and a generous timeout, then
reports input/output tokens, wall time and the resulting throughput — the number
everything else is estimated from. It writes nothing: no plan is stored, no user
is touched.

Why it exists: the generation kept timing out and each diagnosis was inferred
from an error message. Output length drives generation time, and output length
is a property of the plan, so it can be measured once instead of guessed at.
"""

import argparse
import asyncio
import json
import time
from datetime import date, timedelta

import anthropic

from app.core.config import settings
from app.models.plan import Plan, PlanRequest, Weekday
from app.services import plan_service, plan_validation


def _sample_request(weeks: int, distance_km: float) -> PlanRequest:
    """A realistic athlete: three runs a week, a fixed basketball commitment and
    a strength block — the configuration the failures came from."""
    from app.models.activity import SportType
    from app.models.plan import FixedSport, StrengthPref

    return PlanRequest(
        goal_type="race",
        distance_km=distance_km,
        race_date=date.today() + timedelta(weeks=weeks),
        available_days=list(Weekday),
        min_run_sessions_per_week=2,
        max_run_sessions_per_week=3,
        fixed_sports=[
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.FRIDAY, flexible=True),
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.SATURDAY, flexible=True),
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.SUNDAY, flexible=True),
        ],
        strength=StrengthPref(enabled=True, sessions_per_week=1, duration_min=20),
    )


_TERSE = (
    "\nFORMAT COMPACT IMPOSÉ : laisse `structure` vide ([]) pour TOUTES les "
    "séances, et `rationale` en 5 mots maximum. Le volume de sortie est la "
    "contrainte principale."
)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weeks", type=int, default=17)
    parser.add_argument("--distance", type=float, default=42.2)
    parser.add_argument("--timeout", type=float, default=600.0)
    parser.add_argument(
        "--no-structure",
        action="store_true",
        help="ask for empty `structure` and short rationales, to price the trim",
    )
    args = parser.parse_args()

    if not settings.anthropic_api_key:
        raise SystemExit("ANTHROPIC_API_KEY absent — exporte-la avant de lancer.")

    request = _sample_request(args.weeks, args.distance)
    start = plan_service.resolve_start_date(request, date.today())
    # A neutral context: this measures generation cost, not the athlete's data.
    context = {
        "ctl": 40.0,
        "atl": 42.0,
        "tsb": -2.0,
        "has_hr_profile": True,
        "hr_max": 190,
        "hr_rest": 50,
        "low_confidence": False,
        "recent_run_sessions_8w": 20,
        "avg_weekly_run_minutes": 150.0,
        "days_since_last_run": 2,
        "weekly_run_minutes_8w": [140] * 8,
        "last_run": {
            "date": date.today().isoformat(),
            "duration_min": 50,
            "distance_km": 10.0,
            "avg_pace_min_per_km": "5:00",
        },
        "longest_run_8w_min": 90,
        "best_recent_effort": None,
        "needs_test": False,
        "avg_weekly_load_4w": 300.0,
    }

    system = plan_service._system_prompt(request)
    user = plan_service._user_prompt(request, context, start)
    if args.no_structure:
        user += _TERSE

    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key, timeout=args.timeout, max_retries=0
    )
    print(f"Plan de {args.weeks} semaines · modèle {settings.plan_model}")
    print(f"Prompt : {len(system) + len(user):,} caractères. Appel en cours…\n")

    began = time.monotonic()
    response = await client.messages.create(
        model=settings.plan_model,
        max_tokens=plan_service._MAX_TOKENS,
        system=system,
        messages=[{"role": "user", "content": user}],
        tools=[plan_service._PLAN_TOOL],
        tool_choice={"type": "tool", "name": "submit_plan"},
    )
    elapsed = time.monotonic() - began

    usage = response.usage
    out = usage.output_tokens
    print(f"durée           : {elapsed:.1f}s")
    print(f"tokens entrée   : {usage.input_tokens:,}")
    print(f"tokens sortie   : {out:,}")
    print(f"débit           : {out / elapsed:.1f} tokens/s")
    print(f"stop_reason     : {response.stop_reason}")
    print()
    print(
        f"budget actuel   : {plan_service._TOTAL_DEADLINE_S:.0f}s au total, "
        f"{plan_service._ANTHROPIC_TIMEOUT_S:.0f}s par tentative"
    )
    verdict = "TIENT" if elapsed <= plan_service._ANTHROPIC_TIMEOUT_S else "NE TIENT PAS"
    print(f"verdict         : {verdict} dans une génération synchrone")

    block = next((b for b in response.content if getattr(b, "type", None) == "tool_use"), None)
    payload = getattr(block, "input", None)
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict) or not payload:
        print("\nLe modèle n'a rien renvoyé d'exploitable.")
        return

    print(f"\nJSON produit    : {len(json.dumps(payload, ensure_ascii=False)):,} caractères")
    try:
        plan = Plan.model_validate(plan_service._unwrapped(payload))
    except Exception as exc:  # noqa: BLE001 — a benchmark reports, it doesn't raise
        print(f"schéma          : REFUSÉ ({exc})")
        return
    violations = plan_validation.validate_plan(plan, request, start, context)
    print(f"validation      : {len(violations)} violation(s)")
    for violation in violations[:10]:
        print(f"  - {violation}")


if __name__ == "__main__":
    asyncio.run(main())

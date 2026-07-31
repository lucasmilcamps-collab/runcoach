"""AI plan generation pipeline (plan-generator skill).

build_context → generate (Anthropic, JSON) → validate_plan → retry with the
violations as feedback (max 3) → persist as a new immutable version. The model
proposes; validate_plan guarantees. The API key lives server-side only and is
never logged, nor is any health data (project security rules)."""

import json
import math
import time
from datetime import UTC, date, datetime, timedelta

import anthropic
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from app.core.config import settings
from app.models.activity import SportType
from app.models.fitness import FitnessResponse
from app.models.plan import (
    WEEKDAY_ORDER,
    DailyAdjustment,
    InjuryReport,
    Plan,
    PlanRequest,
    PlanResponse,
    PlanVersionSummary,
    RecoverySummary,
    TodaySession,
    Week,
)
from app.services import (
    fitness_service,
    load_service,
    performance_service,
    plan_adaptation,
    plan_moves_service,
    plan_progress,
    plan_validation,
    wellness_service,
)

_MAX_ATTEMPTS = 3
_RUN_VOLUME_DAYS = 56  # last 8 weeks
# Ceiling for ONE attempt. A full multi-week plan is a big tool call (~40-60
# sessions) and usually lands in 45-60s; 75s absorbs a slow one without letting
# a single stuck call swallow the whole budget.
_ANTHROPIC_TIMEOUT_S = 75.0
# Global wall-clock budget across all attempts, and the reason the two constants
# differ: at 160/160 a first attempt that burned its own ceiling left nothing,
# so the retry the validator exists for never happened. Keeping the total at
# 2× one attempt means a maxed-out first pass still leaves a full correction
# round, and each attempt is additionally capped to whatever is left (see
# `_generate_valid_plan`) so the sum never overruns this.
#
# UNVERIFIED ASSUMPTION: generation runs inside the HTTP request and sends
# nothing for up to 150s. Streaming protects the call OUT to Anthropic, not the
# request coming IN — an idle-connection limit on the host would cut the client
# while this keeps spending tokens. Nobody has measured where that limit sits.
# See the plan-generator skill, "Limite de requête entrante", for the test to
# run and what to do if 150s doesn't hold (move generation to job_service).
_TOTAL_DEADLINE_S = 150.0
# Below this, what's left of the budget can't produce a plan — don't burn tokens
# on an attempt that will be cut off mid-generation.
_MIN_ATTEMPT_S = 25.0
# A full multi-week plan JSON (rationale + structure + paces per session) is
# large; 8k truncated it mid-list. Streaming removes the HTTP-timeout ceiling,
# so cap high — the cap only limits, billing is on tokens actually produced.
_MAX_TOKENS = 32000


def _plan_tool_schema() -> dict:
    """`Plan`'s JSON schema, minus the fields the model must never set.

    `skipped` is a per-week user override applied on read, not something a
    generated plan carries. Leaving it in the tool schema would invite the model
    to emit sessions already marked skipped — and the athlete would be told they
    had decided something they never did."""
    schema = Plan.model_json_schema()
    session = schema.get("$defs", {}).get("Session", {})
    session.get("properties", {}).pop("skipped", None)
    return schema


_PLAN_TOOL = {
    "name": "submit_plan",
    "description": (
        "Soumets le plan d'entraînement complet et conforme au schéma. "
        "Appelle cet outil une seule fois avec le plan entier."
    ),
    "input_schema": _plan_tool_schema(),
}


class NoActivePlanError(Exception):
    """No plan is currently active for this user."""


class PlanGenerationError(Exception):
    """Raised when generation can't produce a valid plan (bad key, upstream
    failure, or 3 failed validation attempts). Carries a user-safe message."""


class UnusableToolInput(Exception):
    """The model called `submit_plan` but handed back nothing we can read — an
    empty argument object, or JSON that doesn't parse (a cut-off payload).

    Not a schema violation, though it used to be reported as one: the empty dict
    it degraded into failed validation as "goal → Field required", so the retry
    told the model to fix fields it had never emitted, and the athlete was told
    the schema was wrong. Carries the turn so the retry can still replay it with
    feedback that matches what actually happened."""

    def __init__(self, problem: str, tool_use_id: str, assistant_content: list) -> None:
        super().__init__(problem)
        self.problem = problem
        self.tool_use_id = tool_use_id
        self.assistant_content = assistant_content


def _extract_json(text: str) -> str:
    """Isolate the JSON object even if the model wraps it in ```fences``` or adds
    a sentence before/after — the model doesn't always obey 'JSON only'."""
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        lines = lines[1:] if lines else lines
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    if not stripped.startswith("{"):
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start != -1 and end != -1 and end > start:
            stripped = stripped[start : end + 1]
    return stripped.strip()


def _avg_pace_min_per_km(duration_s: int, distance_m: float | None) -> str | None:
    if not distance_m or distance_m <= 0 or duration_s <= 0:
        return None
    sec_per_km = duration_s / (distance_m / 1000)
    minutes = int(sec_per_km // 60)
    seconds = int(round(sec_per_km % 60))
    if seconds == 60:
        minutes += 1
        seconds = 0
    return f"{minutes}:{seconds:02d}"


def _avg_weekly_load_4w(fitness: FitnessResponse, today: date) -> float:
    """Real weekly TRIMP over the last 4 weeks — the unit `Week.target_load` is
    in, so the model can calibrate week 1 against the athlete's actual load."""
    if not fitness.series:
        return 0.0
    cutoff = today - timedelta(days=28)
    total = sum(day.load for day in fitness.series if day.day >= cutoff)
    return round(total / 4, 1)


async def build_context(
    db: AsyncIOMotorDatabase, user_id: str, fitness: FitnessResponse | None = None
) -> dict:
    """Real athlete state fed to the prompt: current fitness/fatigue/form and
    recent run volume. Cross-training counts toward load elsewhere, but the plan
    prompt needs the running baseline specifically to set volumes.

    `fitness` may be passed in to avoid recomputing the CTL/ATL curve (a full
    activity scan) when the caller already has it."""
    if fitness is None:
        fitness = await fitness_service.compute_fitness(db, user_id)

    today = datetime.now(UTC).date()
    cutoff_date = today - timedelta(days=_RUN_VOLUME_DAYS)

    run_sessions = 0
    run_minutes = 0
    longest_run_8w_min = 0
    weekly_minutes = [0] * 8  # index 0 = oldest week, index 7 = most recent
    latest_dt: datetime | None = None
    latest: dict | None = None  # most recent run overall, ignoring the 8-week window
    best_pace_s: float | None = None  # fastest ≥3km run in the window (for Riegel)
    best_effort: dict | None = None
    recent_paces_s: list[float] = []  # every measurable run's pace, for the median

    cursor = db.activities.find({"user_id": user_id, "sport": SportType.RUN})
    async for doc in cursor:
        start = doc.get("start_time")
        if start is None:
            continue
        start_aware = start.replace(tzinfo=UTC) if start.tzinfo is None else start
        act_date = start_aware.astimezone(UTC).date()
        duration_s = int(doc.get("duration_s") or 0)
        distance_m = doc.get("distance_m")

        if latest_dt is None or start_aware > latest_dt:
            latest_dt = start_aware
            latest = {"date": act_date, "duration_s": duration_s, "distance_m": distance_m}

        if act_date < cutoff_date:
            continue
        run_sessions += 1
        minutes = duration_s // 60
        run_minutes += minutes
        longest_run_8w_min = max(longest_run_8w_min, minutes)
        weeks_ago = (today - act_date).days // 7
        if 0 <= weeks_ago <= 7:
            weekly_minutes[7 - weeks_ago] += minutes

        if distance_m and distance_m >= 1500 and duration_s > 0:
            pace = duration_s / (distance_m / 1000)  # s/km — faster is better
            recent_paces_s.append(pace)
            if best_pace_s is None or pace < best_pace_s:
                best_pace_s = pace
                best_effort = {
                    "distance_km": round(distance_m / 1000, 2),
                    "time_s": duration_s,
                    "days_ago": (today - act_date).days,
                }

    # Riegel takes the fastest run at face value, so a mismeasured one (GPS
    # drift, a run cut short) would set the paces for the whole plan. Flag it
    # against the athlete's own median pace; the estimate is kept, its
    # confidence is not (performance_service).
    if best_effort is not None and best_pace_s is not None:
        best_effort["pace_implausible"] = performance_service.is_source_pace_implausible(
            best_pace_s, recent_paces_s
        )

    days_since_last_run = (today - latest["date"]).days if latest else None
    last_run = None
    if latest is not None:
        last_run = {
            "date": latest["date"].isoformat(),
            "duration_min": latest["duration_s"] // 60,
            "distance_km": (
                round(latest["distance_m"] / 1000, 2) if latest["distance_m"] else None
            ),
            "avg_pace_min_per_km": _avg_pace_min_per_km(latest["duration_s"], latest["distance_m"]),
        }

    # A test session is warranted when there's no reliable performance to
    # estimate from: no recent measurable effort, thin history, or a long layoff.
    needs_test = (
        best_effort is None
        or fitness.low_confidence
        or days_since_last_run is None
        or days_since_last_run > 21
    )

    weeks = _RUN_VOLUME_DAYS / 7
    return {
        "ctl": fitness.ctl,
        "atl": fitness.atl,
        "tsb": fitness.tsb,
        "has_hr_profile": fitness.has_profile,
        "hr_max": fitness.hr_max,
        "hr_rest": fitness.hr_rest,
        "low_confidence": fitness.low_confidence,
        "recent_run_sessions_8w": run_sessions,
        "avg_weekly_run_minutes": round(run_minutes / weeks, 1),  # kept for compat
        "days_since_last_run": days_since_last_run,
        "weekly_run_minutes_8w": weekly_minutes,
        "last_run": last_run,
        "longest_run_8w_min": longest_run_8w_min,
        "best_recent_effort": best_effort,  # fastest ≥1.5km run in the window
        "needs_test": needs_test,
        "avg_weekly_load_4w": _avg_weekly_load_4w(fitness, today),
    }


def _strength_directive(request: PlanRequest) -> str:
    s = request.strength
    if not s.enabled:
        return "- Renforcement : NON demandé. N'ajoute aucune séance type='strength'.\n"
    return (
        f"- Renforcement : ajoute {s.sessions_per_week} séance(s) type='strength', "
        f"slot='addon', ~{s.duration_min} min, le MÊME jour qu'une séance de qualité "
        "(après la course) ou un jour facile, JAMAIS la veille d'une sortie longue "
        "ou d'une séance de qualité ; si deux/semaine, au moins 48 h d'écart. Ne "
        "prescris PAS d'exercices : indique seulement le créneau et l'intention "
        "(ex. bas du corps + gainage, RPE 6-7). Une séance addon ne compte pas dans "
        "le nombre de séances de course.\n"
    )


def _cross_training_directive(request: PlanRequest) -> str:
    """The ban has to be scoped, or it swallows the fixed sports.

    A declared commitment (basket every Saturday) is emitted as a session with
    `type='cross_training'` — there is no other type for it. Saying "add no
    cross_training session" without that distinction leaves the model choosing
    between two rules it was told were both absolute, and it drops the fixed
    sport: three attempts, three identical violations, budget gone."""
    if request.include_cross_training:
        return (
            "- Cross-training prescrit : autorisé (type='cross_training') pour "
            "ajouter du volume sans impact.\n"
        )
    return (
        "- Cross-training : n'AJOUTE aucune séance de cross-training de ta propre "
        "initiative. Cette interdiction ne concerne PAS les sports fixes déclarés "
        "par l'athlète : ceux-là sont obligatoires et s'écrivent eux aussi avec "
        "type='cross_training' (avec leur `sport`). Tu dois donc les inclure.\n"
    )


def _system_prompt(request: PlanRequest) -> str:
    return (
        "Tu es un coach de course à pied expert. Tu construis un plan "
        "d'entraînement personnalisé et SÛR. Règles de science de l'entraînement "
        "à respecter impérativement :\n"
        "- La charge hebdomadaire (target_load) n'augmente jamais de plus de 10% "
        "d'une semaine normale à la suivante.\n"
        "- Une semaine de deload (is_deload=true, charge réduite) au moins toutes "
        "les 3-4 semaines.\n"
        "- Périodisation en phases base → build → peak → taper (taper seulement "
        "s'il y a une date de course, avec charge décroissante avant le jour J).\n"
        "- Maximum 2 séances de qualité (tempo/threshold/intervals) par semaine, "
        "jamais deux jours de qualité consécutifs.\n"
        "- La sortie longue progresse d'au plus 15 min par semaine.\n"
        "- Séances de course : entre `min_run_sessions_per_week` et "
        "`max_run_sessions_per_week` par semaine. Marque EXACTEMENT "
        "`min_run_sessions_per_week` séances de course en priority='key' (les "
        "incontournables) chaque semaine normale ; les autres en priority='optional'. "
        "Le `rationale` des séances 'key' explique pourquoi elles priment.\n"
        "- La charge de la semaine 1 (target_load) reste proche de la charge réelle "
        "récente `avg_weekly_load_4w` (au plus +10%) : on démarre là où en est "
        "l'athlète, pas à l'objectif.\n"
        "- Les allures d'entraînement s'appuient sur le chrono ACTUEL estimé "
        "(`chrono_actuel_estime` s'il est fourni), pas sur l'objectif : des allures "
        "adossées à l'objectif sont inatteignables en début de plan. On progresse "
        "vers l'allure objectif au fil des phases.\n"
        "- Types de séance disponibles : easy, long_run, tempo, threshold, "
        "intervals, recovery, cross_training, strength, test, race, rest. Utilise "
        "`slot`='primary' par défaut ; 'addon' uniquement pour un renforcement court "
        "qui partage la journée d'une séance principale. S'il y a une date de course, "
        "la séance du jour J est type='race'.\n"
        "- Les sports fixes de l'utilisateur apparaissent sur l'un de leurs jours "
        "déclarés à CHAQUE semaine, sans exception (deload et taper compris). "
        "Chacun s'écrit comme une séance à part entière, avec sport = le sport "
        "déclaré et type='cross_training'. Ils ne comptent pas dans le nombre de "
        "séances de course. Aucune séance de qualité le lendemain d'un sport à "
        "impacts (padel, basket).\n"
        "- Toutes les séances tombent sur les jours disponibles indiqués.\n"
        "- Zones cardiaques via la FC max/repos fournies (Karvonen), jamais "
        "220−âge. Aucune recommandation médicale.\n"
        "- Si `low_confidence` est vrai dans l'état actuel (historique trop court "
        "pour être fiable), démarre délibérément bas et consacre les premières "
        "semaines à l'observation plutôt qu'à une progression agressive.\n"
        "- Chaque séance a un `rationale` d'une phrase expliquant sa place.\n"
        "- Détaille `structure` en blocs (échauffement, corps, récupération). Pour "
        "chaque bloc de course, renseigne `hr_zone` (1 à 5) et `pace_range` "
        '(allure min–max en min/km, ex. "4:15"–"4:30") cohérents avec le type '
        "de bloc ; échauffement/retour au calme en zone basse. Pour un bloc de "
        "cross-training ou de repos, laisse `hr_zone` et `pace_range` à null.\n"
        "- Le champ `sport` vaut EXACTEMENT l'une de ces valeurs : RUN, PADEL, "
        "BASKETBALL, BIKE, STRENGTH, OTHER. Une séance strength a sport=STRENGTH. "
        "Pour la natation, le yoga, la mobilité, un jour de repos ou tout autre "
        "cas, mets sport=OTHER (le type de séance précise déjà la nature).\n"
        + _strength_directive(request)
        + _cross_training_directive(request)
        + "\nSoumets le plan complet en appelant l'outil submit_plan (un seul appel)."
    )


def _weeks_directive(request: PlanRequest, start: date) -> str:
    if request.race_date is not None:
        weeks = max(1, math.ceil((request.race_date - start).days / 7))
        return (
            f"Le plan doit compter EXACTEMENT {weeks} semaines (il reste {weeks} "
            "semaines avant la course), la dernière étant la semaine de course "
            "avec un affûtage (taper) et une charge réduite. N'ajoute ni ne "
            "retire de semaines."
        )
    return "Construis un plan de 8 à 12 semaines."


_SEVERITY_LABELS = {"gene": "gêne légère", "douleur": "douleur", "arret": "arrêt"}


def _injury_directive(injury: InjuryReport | None) -> str:
    if injury is None:
        return ""
    severity = _SEVERITY_LABELS.get(injury.severity, injury.severity)
    return (
        f"\nBLESSURE DÉCLARÉE — zone « {injury.area} », gravité « {severity} », "
        f"{injury.days_off} jour(s) sans course possible. Construis une REPRISE : "
        f"commence par une phase allégée couvrant au moins ces {injury.days_off} "
        "premiers jours sans aucune course à impact ni sollicitation de la zone "
        "touchée (repos ou cross-training doux uniquement), puis remonte la charge "
        "très progressivement depuis un niveau réduit, sans jamais chercher à "
        "rattraper le retard. Priorité absolue à une reprise sûre. Aucune "
        "recommandation médicale.\n"
    )


_DETRAINING_DAYS_THRESHOLD = 21


def _detraining_directive(context: dict) -> str:
    """A gentle comeback when the athlete hasn't run in a while — same shape as
    the injury directive, driven by days_since_last_run rather than a report."""
    days = context.get("days_since_last_run")
    if days is None or days <= _DETRAINING_DAYS_THRESHOLD:
        return ""
    return (
        f"\nREPRISE APRÈS INTERRUPTION — l'athlète n'a pas couru depuis {days} jours. "
        "Démarre avec un volume nettement réduit par rapport à l'objectif, sans "
        "aucune séance de qualité les deux premières semaines, et remonte la charge "
        "très prudemment.\n"
    )


def _counts_directive(request: PlanRequest) -> str:
    lo, hi = request.min_run_sessions_per_week, request.max_run_sessions_per_week
    lines = [
        "CONTRAINTES DURES (à respecter à la lettre, chaque semaine) :",
        f"- Séances de COURSE : entre {lo} et {hi} par semaine. NE DÉPASSE JAMAIS {hi}. "
        f"Marque EXACTEMENT {lo} en priority='key', le reste en 'optional'.",
    ]
    if request.fixed_sports:
        fixed: dict[str, list[str]] = {}
        flexible: dict[str, list[str]] = {}
        for fs in request.fixed_sports:
            (flexible if fs.flexible else fixed).setdefault(fs.sport.value, []).append(fs.day.value)
        parts = []
        for sport in {*fixed, *flexible}:
            segs = []
            if fixed.get(sport):
                segs.append(", ".join(fixed[sport]) + " (jour(s) fixe(s))")
            if flexible.get(sport):
                segs.append("un de " + "/".join(flexible[sport]))
            parts.append(f"{sport} : " + " + ".join(segs))
        lines.append(
            "- Sports fixes présents CHAQUE semaine, SANS EXCEPTION (deload et taper "
            "compris), chacun en séance sport=<le sport> et type='cross_training' : "
            + " ; ".join(parts)
            + "."
        )
    return "\n".join(lines) + "\n"


def _test_directive(context: dict) -> str:
    """Ask for a week-1 assessment run when we lack a reliable performance to
    estimate from (feeds the chrono estimation once synced back)."""
    if not context.get("needs_test"):
        return ""
    return (
        "\nSÉANCE DE TEST — l'historique ne permet pas d'estimer le niveau de "
        "façon fiable. Place en SEMAINE 1 une séance type='test' : échauffement, "
        "un effort MAXIMAL sur 2 km (ou 1500 m), puis retour au calme. Son "
        "`rationale` explique qu'elle sert à mesurer le niveau et à recaler les "
        "allures. Conseille dans le rationale de lancer l'effort comme une "
        "activité Garmin propre (idéalement séparée) pour une mesure nette.\n"
    )


def _user_prompt(
    request: PlanRequest, context: dict, start: date, injury: InjuryReport | None = None
) -> str:
    req = request.model_dump(mode="json")
    return (
        f"Objectif de l'athlète :\n{json.dumps(req, ensure_ascii=False)}\n\n"
        f"État actuel (données réelles Garmin) :\n{json.dumps(context, ensure_ascii=False)}\n\n"
        f"{_weeks_directive(request, start)}\n"
        f"{_counts_directive(request)}"
        f"{_injury_directive(injury)}"
        f"{_detraining_directive(context)}"
        f"{_test_directive(context)}"
        "Construis le plan complet, semaine par semaine, du niveau actuel "
        "jusqu'à l'objectif, puis soumets-le via l'outil submit_plan. La sortie "
        "longue progresse d'au plus 15 min d'une semaine à l'autre. Reste TRÈS "
        "CONCIS pour tenir dans la limite : `rationale` en une phrase courte, et "
        "ne renseigne `structure` (blocs) QUE pour les fractionnés (intervals/"
        "threshold/tempo) ; laisse `structure` vide ([]) pour les autres séances "
        "(footing, sortie longue, récup, renfo, repos). Si des séances récentes "
        "ont été manquées (voir progression_recente), repars du niveau actuel."
    )


async def _call_anthropic(
    client: "anthropic.AsyncAnthropic",
    system: str,
    user: str,
    history: list[tuple[list, list]],
    timeout_s: float,
) -> tuple[dict, str, list]:
    """Call the model, forcing it to emit the plan through the `submit_plan`
    tool (input_schema = the Plan schema), which removes the whole "JSON not
    conforming to the schema" error class. Returns (plan_input, tool_use_id,
    assistant_content) — the last two feed the conversational retry history.

    History replays each failed attempt as the model's own tool_use turn plus a
    tool_result carrying the violations, so "fix only these points" is executable
    and the stable prefix lets prompt caching kick in on retries."""
    messages: list[dict] = [{"role": "user", "content": user}]
    for assistant_content, tool_result_content in history:
        messages.append({"role": "assistant", "content": assistant_content})
        messages.append({"role": "user", "content": tool_result_content})
    try:
        # Non-streaming: with a forced tool_choice, the streaming helper
        # intermittently returned an empty tool input; create() reliably gives
        # the fully-formed `.input`. `timeout_s` is this attempt's share of the
        # global budget, so a slow call is cut off while a retry is still
        # affordable rather than after the budget is gone.
        response = await client.messages.create(
            model=settings.plan_model,
            max_tokens=_MAX_TOKENS,
            system=system,
            messages=messages,
            tools=[_PLAN_TOOL],
            tool_choice={"type": "tool", "name": _PLAN_TOOL["name"]},
            timeout=timeout_s,
        )
    except anthropic.APITimeoutError as exc:
        raise PlanGenerationError(
            "Le modèle a mis trop de temps à répondre (timeout). Réessayez."
        ) from exc
    except anthropic.AuthenticationError as exc:
        raise PlanGenerationError(
            "Clé API Anthropic refusée (401). Vérifiez ANTHROPIC_API_KEY sur Render."
        ) from exc
    except anthropic.PermissionDeniedError as exc:
        raise PlanGenerationError(
            "Accès refusé par Anthropic (403) : facturation/crédits ou permissions du compte."
        ) from exc
    except anthropic.NotFoundError as exc:
        raise PlanGenerationError(
            f"Modèle « {settings.plan_model} » introuvable (404). Vérifiez PLAN_MODEL."
        ) from exc
    except anthropic.RateLimitError as exc:
        raise PlanGenerationError(
            "Limite de requêtes Anthropic atteinte (429). Réessayez dans un instant."
        ) from exc
    except anthropic.APIStatusError as exc:
        # Any other non-2xx (incl. 400 "credit balance too low"). Surface the
        # status and upstream message so the cause is diagnosable — the message
        # never contains the API key, only Anthropic's own error text.
        detail = (exc.message or "")[:160]
        raise PlanGenerationError(
            f"Erreur Anthropic (HTTP {exc.status_code} · {exc.type}) : {detail}"
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise PlanGenerationError("Impossible de joindre Anthropic (réseau). Réessayez.") from exc

    if getattr(response, "stop_reason", None) == "max_tokens":
        # The tool JSON was cut mid-way: retrying regenerates the same too-long
        # plan, so fail fast with an actionable message.
        raise PlanGenerationError(
            "Le plan est trop long pour être généré d'un seul bloc (réponse tronquée). "
            "Réduis la durée du plan ou le nombre de séances, puis réessaie."
        )

    tool_block = next((b for b in response.content if getattr(b, "type", None) == "tool_use"), None)
    if tool_block is None:
        raise PlanGenerationError(
            "Le modèle n'a pas renvoyé de plan structuré (aucun appel d'outil)."
        )
    assistant_content = [
        {
            "type": "tool_use",
            "id": tool_block.id,
            "name": tool_block.name,
            "input": tool_block.input,
        }
    ]

    plan_input = tool_block.input
    unusable: str | None = None
    if isinstance(plan_input, str):  # defensive: some SDK paths return a JSON string
        raw = plan_input
        try:
            plan_input = json.loads(raw)
        except json.JSONDecodeError as exc:
            # Was silently swallowed into {}, which then failed validation as
            # "goal → Field required" — a diagnosis that sent both the retry and
            # the athlete after the wrong problem. An unparseable payload is
            # almost always a cut-off one; say so.
            unusable = (
                f"JSON de l'outil illisible ({exc.msg} @ {exc.pos}/{len(raw)} car.) — "
                "réponse probablement tronquée"
            )
    if unusable is None and not isinstance(plan_input, dict):
        unusable = f"l'outil a reçu un {type(plan_input).__name__}, pas un objet"
    elif unusable is None and not plan_input:
        unusable = "submit_plan a été appelé sans aucun contenu"

    if unusable is not None:
        stop = getattr(response, "stop_reason", None)
        raise UnusableToolInput(
            f"{unusable} (stop_reason={stop}).", tool_block.id, assistant_content
        )

    return plan_input, tool_block.id, assistant_content


_PLAN_TOP_LEVEL_KEYS = frozenset({"goal", "phases"})


def _unwrapped(plan_input: dict) -> dict:
    """Accept a plan the model wrapped in an extra key.

    Asked for an object with `goal` and `phases`, a model will sometimes hand
    back `{"plan": {...}}` — the tool's own name, or the word from the prompt,
    used as an envelope. Validation then fails on both required fields at once,
    which reads exactly like an empty call and gives the retry nothing to work
    with. Unwrap a single-key envelope whose contents are recognisably the plan;
    anything else is passed through untouched so real errors stay real."""
    if _PLAN_TOP_LEVEL_KEYS & plan_input.keys():
        return plan_input
    for value in plan_input.values():
        if isinstance(value, dict) and _PLAN_TOP_LEVEL_KEYS <= value.keys():
            return value
    return plan_input


async def _generate_valid_plan(
    request: PlanRequest, context: dict, start: date, injury: InjuryReport | None = None
) -> Plan:
    if not settings.anthropic_api_key:
        raise PlanGenerationError("Génération IA non configurée (clé API absente).")

    system = _system_prompt(request)
    user = _user_prompt(request, context, start, injury)

    # One client per generation (reused across attempts), not one per attempt.
    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key, timeout=_ANTHROPIC_TIMEOUT_S
    )

    # Each entry: (assistant tool_use content, user tool_result content).
    history: list[tuple[list, list]] = []
    last_problem = "aucune réponse exploitable"
    deadline = time.monotonic() + _TOTAL_DEADLINE_S

    def _record(assistant_content: list, tool_use_id: str, feedback: str) -> None:
        history.append(
            (
                assistant_content,
                [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": feedback,
                        "is_error": True,
                    }
                ],
            )
        )

    for attempt in range(_MAX_ATTEMPTS):
        remaining = deadline - time.monotonic()
        if attempt > 0 and remaining < _MIN_ATTEMPT_S:
            raise PlanGenerationError(
                f"Budget temps de génération dépassé (~{_TOTAL_DEADLINE_S:.0f}s) "
                f"après {attempt} tentative(s). Dernier problème : {last_problem[:300]}"
            )
        try:
            plan_input, tool_use_id, assistant_content = await _call_anthropic(
                client, system, user, history, min(_ANTHROPIC_TIMEOUT_S, remaining)
            )
        except UnusableToolInput as exc:
            last_problem = exc.problem
            _record(
                exc.assistant_content,
                exc.tool_use_id,
                f"{exc.problem} Rappelle submit_plan avec le plan ENTIER dans "
                "l'argument. Si la réponse précédente était trop longue, réduis "
                "`rationale` à quelques mots et laisse `structure` vide sauf pour "
                "les fractionnés.",
            )
            continue
        try:
            plan = Plan.model_validate(_unwrapped(plan_input))
        except ValidationError as exc:
            errors = exc.errors()[:3]
            last_problem = "Schéma non respecté : " + "; ".join(
                f"{'.'.join(str(p) for p in e['loc'])} → {e['msg']}" for e in errors
            )
            # Name the keys that DID arrive. "goal → Field required" says what is
            # missing and nothing about what was sent instead, which is the half
            # that identifies the mistake — a wrapped or renamed payload looks
            # identical to an empty one in that message.
            got = ", ".join(sorted(plan_input)[:8]) or "(objet vide)"
            last_problem += f" [clés reçues : {got}]"
            _record(
                assistant_content,
                tool_use_id,
                last_problem + ". L'argument de submit_plan doit être l'objet plan LUI-MÊME, "
                "avec `goal` et `phases` à la racine — pas enveloppé dans une "
                "autre clé. Corrige et renvoie un plan conforme.",
            )
            continue
        violations = plan_validation.validate_plan(plan, request, start, context)
        if not violations:
            return plan
        last_problem = " ; ".join(violations)
        _record(
            assistant_content,
            tool_use_id,
            "Le plan viole ces règles : "
            + last_problem
            + ". Corrige uniquement ces points, garde le reste.",
        )

    raise PlanGenerationError(
        f"Plan invalide après {_MAX_ATTEMPTS} tentatives. Dernier problème : {last_problem[:400]}"
    )


async def _next_version(db: AsyncIOMotorDatabase, user_id: str) -> int:
    latest = await db.plans.find_one({"user_id": user_id}, sort=[("version", -1)])
    return (latest["version"] + 1) if latest else 1


def _recent_source(context: dict) -> dict | None:
    """Effort to base the Riegel estimate on: the best ≥3km run, else the last run."""
    best = context.get("best_recent_effort")
    if best and best.get("distance_km"):
        return best
    last = context.get("last_run")
    if last and last.get("distance_km"):
        return {
            "distance_km": last["distance_km"],
            "time_s": last["duration_min"] * 60,
            "days_ago": context.get("days_since_last_run") or 0,
        }
    return None


def _project_ctl(ctl_now: float, weekly_loads: list[float]) -> float:
    """Roll CTL forward through the plan's weekly loads (daily EMA, 42-day tau)."""
    ctl = ctl_now
    for weekly in weekly_loads:
        daily = weekly / 7
        for _ in range(7):
            ctl += (daily - ctl) / load_service.CTL_TIME_CONSTANT
    return ctl


def _weeks_until(request: PlanRequest, start: date) -> int:
    if request.race_date is not None:
        return max(1, math.ceil((request.race_date - start).days / 7))
    return 10  # midpoint of the default 8-12 week range


# Latest weekday (Mon=0) on which starting the current week still leaves enough
# of it to train: with three runs a week, the back half usually still holds two
# of them. From Thursday on, the week is a write-off.
_LAST_DAY_TO_START_THIS_WEEK = 2  # Wednesday


def resolve_start_date(request: PlanRequest, today: date) -> date:
    """The Monday that the plan's week 1 begins on.

    Weeks are the unit a plan is built and read in — every session carries a
    weekday, and "today's session" is found by counting weeks from this date —
    so a plan always starts on a Monday, whatever the athlete picked.

    Without an explicit choice, starting the current week is only sensible while
    the week still has room: generate on a Friday and week 1 arrives with five
    of its seven days already gone, so the athlete opens the app to a week they
    have already failed. Past that point the plan starts next Monday.

    A chosen date is never allowed to land before the current week: a plan
    starting in the past would put the athlete mid-plan on day one, with
    sessions they never had the chance to run already counted as missed.
    """
    this_monday = today - timedelta(days=today.weekday())
    if request.start_date is not None:
        chosen_monday = request.start_date - timedelta(days=request.start_date.weekday())
        return max(chosen_monday, this_monday)
    return (
        this_monday
        if today.weekday() <= _LAST_DAY_TO_START_THIS_WEEK
        else this_monday + timedelta(days=7)
    )


async def generate_plan(
    db: AsyncIOMotorDatabase,
    user_id: str,
    request: PlanRequest,
    injury: InjuryReport | None = None,
) -> PlanResponse:
    """Generate, validate, and persist a new plan version. Runs synchronously
    inside the request (like the Garmin sync): on a free single-instance host a
    background task can be killed mid-run, so the caller awaits the real result.

    `injury`, when set, makes it a comeback replan: the prompt steers the early
    weeks toward recovery and a gradual ramp (plan-generator skill)."""
    today = datetime.now(UTC).date()
    # The plan's own calendar starts here, and not necessarily today: the week
    # count, the prompt, the validator and the stored anchor all reason from
    # this date, so a plan asked for on a Friday to start next Monday gets the
    # right number of weeks rather than one week too many.
    start = resolve_start_date(request, today)
    # Compute the CTL/ATL curve once and share it: both build_context and
    # compute_progress need it, and it scans every activity.
    fitness = await fitness_service.compute_fitness(db, user_id)
    context = await build_context(db, user_id, fitness=fitness)

    # Replan awareness: if a prior plan exists, tell the model what was actually
    # done recently so the regenerated plan restarts from reality, not the paper
    # plan (plan-generator skill: pass the real completed history).
    progress = await plan_progress.compute_progress(db, user_id, fitness=fitness)
    if progress.has_plan:
        context["progression_recente"] = {
            "seances_cles_prevues_14j": progress.recent_key_planned,
            "seances_cles_realisees_14j": progress.recent_key_completed,
            "seances_cles_manquees_14j": progress.recent_key_missed,
        }

    if injury is not None:
        context["blessure"] = {
            "zone": injury.area,
            "gravite": injury.severity,
            "jours_sans_course": injury.days_off,
        }

    # Estimated current race time (Riegel), injected so the model anchors paces
    # on real form, not just the goal. Feasibility is a notice, never a blocker.
    current_estimate = None
    feasibility = None
    source = _recent_source(context)
    if request.distance_km and source:
        current_estimate = performance_service.estimate_current_time(
            source["distance_km"], source["time_s"], source["days_ago"], request.distance_km
        )
        if source.get("pace_implausible"):
            current_estimate = performance_service.downgrade_confidence(current_estimate)
        context["chrono_actuel_estime"] = {
            "distance_km": request.distance_km,
            "temps_estime_min": round(current_estimate.seconds / 60),
            "confiance": current_estimate.confidence,
        }
        if request.target_time_min:
            feasibility = performance_service.feasibility_warning(
                request.target_time_min * 60, current_estimate.seconds, _weeks_until(request, start)
            )

    version = await _next_version(db, user_id)

    try:
        plan = await _generate_valid_plan(request, context, start, injury)
    except PlanGenerationError as exc:
        doc = {
            "user_id": user_id,
            "version": version,
            "status": "failed",
            "request": request.model_dump(mode="json"),
            "plan": None,
            "error_message": str(exc),
            "created_at": datetime.now(UTC),
        }
        result = await db.plans.insert_one(doc)
        return PlanResponse(
            id=str(result.inserted_id),
            status="failed",
            request=request,
            error_message=str(exc),
        )

    # Projected time at the plan's end (current estimate scaled by projected CTL).
    estimated_min = projected_min = None
    if current_estimate is not None:
        estimated_min = round(current_estimate.seconds / 60)
        weekly_loads = [w.target_load for ph in plan.phases for w in ph.weeks]
        ctl_projected = _project_ctl(fitness.ctl, weekly_loads)
        projected_s = performance_service.project_time_at_target(
            current_estimate.seconds, fitness.ctl, ctl_projected
        )
        projected_min = round(projected_s / 60)

    doc = {
        "user_id": user_id,
        "version": version,
        "status": "ready",
        "request": request.model_dump(mode="json"),
        "plan": plan.model_dump(mode="json"),
        "start_date": start.isoformat(),
        "injury": injury.model_dump(mode="json") if injury else None,
        "estimated_time_min": estimated_min,
        "projected_time_min": projected_min,
        "feasibility_warning": feasibility,
        "error_message": None,
        "created_at": datetime.now(UTC),
    }
    result = await db.plans.insert_one(doc)
    return PlanResponse(
        id=str(result.inserted_id),
        status="ready",
        request=request,
        plan=plan,
        estimated_time_min=estimated_min,
        projected_time_min=projected_min,
        feasibility_warning=feasibility,
    )


async def unlogged_strength(
    db: AsyncIOMotorDatabase, user_id: str, day: date | None = None
) -> bool:
    """True when a strength session was planned on `day` (default: yesterday) but
    no strength/manual activity was recorded that day. Freeletics doesn't sync to
    Garmin, so this drives a "log it in 2 taps" reminder (Lot 6.3) — otherwise the
    load is silently under-counted."""
    target = day or (datetime.now(UTC).date() - timedelta(days=1))
    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        return False

    plan = Plan.model_validate(doc["plan"])
    await plan_moves_service.apply_overrides(db, user_id, plan, doc["version"])
    weeks = _flatten_weeks(plan)
    week_pos = (target - _plan_start_date(doc, target)).days // 7
    if week_pos < 0 or week_pos >= len(weeks):
        return False

    weekday = WEEKDAY_ORDER[target.weekday()]
    planned = any(s.day == weekday and s.type == "strength" for s in weeks[week_pos].sessions)
    if not planned:
        return False

    day_start = datetime(target.year, target.month, target.day, tzinfo=UTC)
    logged = await db.activities.find_one(
        {
            "user_id": user_id,
            "start_time": {"$gte": day_start, "$lt": day_start + timedelta(days=1)},
            "$or": [{"sport": SportType.STRENGTH}, {"manual": True}],
        }
    )
    return logged is None


async def cancel_current_plan(db: AsyncIOMotorDatabase, user_id: str) -> None:
    """Stop the active plan: it is no longer current, but stays in the history.

    Every other read already filters on `status == "ready"` (today's session,
    progress, per-week overrides), so flipping the status is enough to retire
    the plan everywhere without touching those call sites.
    """
    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None:
        raise NoActivePlanError
    await db.plans.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(UTC)}},
    )


async def get_current_plan(db: AsyncIOMotorDatabase, user_id: str) -> PlanResponse | None:
    doc = await db.plans.find_one({"user_id": user_id}, sort=[("version", -1)])
    if doc is None:
        return None
    # A stopped plan is not a current plan: return None so the API answers 404
    # and the app shows its "create a plan" state rather than an in-between one.
    if doc.get("status") == "cancelled":
        return None
    plan = Plan.model_validate(doc["plan"]) if doc.get("plan") else None
    if plan is not None and doc.get("status") == "ready":
        await plan_moves_service.apply_overrides(db, user_id, plan, doc["version"])
    return PlanResponse(
        id=str(doc["_id"]),
        status=doc["status"],
        request=PlanRequest.model_validate(doc["request"]) if doc.get("request") else None,
        plan=plan,
        estimated_time_min=doc.get("estimated_time_min"),
        projected_time_min=doc.get("projected_time_min"),
        feasibility_warning=doc.get("feasibility_warning"),
        error_message=doc.get("error_message"),
    )


def _version_reason(doc: dict, prev_request: dict | None) -> str:
    """Why this version was created, inferred from what we stored. An injury is
    explicit; the first version is the initial plan; otherwise a changed request
    means the objective moved, an identical one means a plain replan."""
    if doc.get("injury"):
        return "Reprise après blessure"
    if prev_request is None:
        return "Plan initial"
    if doc.get("request") != prev_request:
        return "Objectif ajusté"
    return "Replanification"


async def list_plan_versions(db: AsyncIOMotorDatabase, user_id: str) -> list[PlanVersionSummary]:
    """Read-only list of successful plan versions, newest first, with the active
    one flagged."""
    cursor = db.plans.find({"user_id": user_id, "status": {"$in": ["ready", "cancelled"]}}).sort(
        "version", 1
    )
    docs = [doc async for doc in cursor]

    summaries: list[PlanVersionSummary] = []
    prev_request: dict | None = None
    for doc in docs:
        plan = doc.get("plan") or {}
        goal = plan.get("goal") or {}
        weeks = sum(len(phase.get("weeks", [])) for phase in plan.get("phases", []))
        injury = doc.get("injury") or None
        summaries.append(
            PlanVersionSummary(
                version=doc["version"],
                created_at=doc["created_at"],
                status=doc.get("status", "ready"),
                goal_description=goal.get("description"),
                race_date=goal.get("race_date"),
                weeks_total=weeks or None,
                reason=_version_reason(doc, prev_request),
                injury_area=(injury or {}).get("area"),
                estimated_time_min=doc.get("estimated_time_min"),
                projected_time_min=doc.get("projected_time_min"),
            )
        )
        prev_request = doc.get("request")

    # Same rule as `get_current_plan`: the newest version drives the app, unless
    # it was stopped — in which case nothing is active, and an older "ready"
    # version does NOT get promoted back.
    if summaries and summaries[-1].status == "ready":
        summaries[-1].is_active = True

    summaries.reverse()  # newest first
    return summaries


async def get_plan_version(
    db: AsyncIOMotorDatabase, user_id: str, version: int
) -> PlanResponse | None:
    """A single stored version, read-only (versions are never mutated)."""
    doc = await db.plans.find_one(
        {"user_id": user_id, "version": version, "status": {"$in": ["ready", "cancelled"]}}
    )
    if doc is None:
        return None
    return PlanResponse(
        id=str(doc["_id"]),
        status=doc["status"],
        request=PlanRequest.model_validate(doc["request"]) if doc.get("request") else None,
        plan=Plan.model_validate(doc["plan"]) if doc.get("plan") else None,
        estimated_time_min=doc.get("estimated_time_min"),
        projected_time_min=doc.get("projected_time_min"),
        feasibility_warning=doc.get("feasibility_warning"),
        error_message=doc.get("error_message"),
    )


def _plan_start_date(doc: dict, today: date) -> date:
    stored = doc.get("start_date")
    if isinstance(stored, str):
        try:
            return date.fromisoformat(stored)
        except ValueError:
            pass
    # Pre-Phase-4 plans have no start_date: anchor to the Monday of the week the
    # plan was created.
    created = doc.get("created_at")
    base = created.date() if created is not None else today
    return base - timedelta(days=base.weekday())


def _flatten_weeks(plan: Plan) -> list[Week]:
    return [week for phase in plan.phases for week in phase.weeks]


async def get_today_session(db: AsyncIOMotorDatabase, user_id: str) -> TodaySession:
    """Today's planned session, adjusted for current form (Phase 4, step 1)."""
    today = datetime.now(UTC).date()
    fitness = await fitness_service.compute_fitness(db, user_id)
    tsb = fitness.tsb

    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        return TodaySession(
            date=today,
            has_plan=False,
            has_session=False,
            tsb=tsb,
            message="Aucun plan actif. Créez-en un dans l'onglet Plan.",
        )

    plan = Plan.model_validate(doc["plan"])
    await plan_moves_service.apply_overrides(db, user_id, plan, doc["version"])
    weeks = _flatten_weeks(plan)
    start = _plan_start_date(doc, today)
    week_pos = (today - start).days // 7  # 0-based position

    if week_pos < 0:
        # A plan can now be dated forward (start next Monday rather than
        # mid-week). Saying "plan terminé" here would be the exact opposite of
        # the truth.
        days = (start - today).days
        when = "demain" if days == 1 else f"dans {days} jours"
        return TodaySession(
            date=today,
            has_plan=True,
            has_session=False,
            tsb=tsb,
            message=f"Ton plan démarre lundi, {when}. Profite-en pour récupérer.",
        )
    if week_pos >= len(weeks):
        return TodaySession(
            date=today,
            has_plan=True,
            has_session=False,
            tsb=tsb,
            message="Plan terminé — générez-en un nouveau pour continuer.",
        )

    week = weeks[week_pos]
    weekday = WEEKDAY_ORDER[today.weekday()]
    day_sessions = [s for s in week.sessions if s.day == weekday and s.type != "rest"]
    if not day_sessions:
        return TodaySession(
            date=today,
            has_plan=True,
            has_session=False,
            week_index=week_pos + 1,
            tsb=tsb,
            message="Pas de séance prévue aujourd'hui — repos.",
        )

    # The primary session drives today's adjustment; addons (e.g. a short strength
    # block) ride along — and are dropped if the primary is eased off.
    primary = next((s for s in day_sessions if s.slot == "primary"), day_sessions[0])
    addons = [s for s in day_sessions if s is not primary and s.slot == "addon"]

    signals = await wellness_service.get_recovery_signals(db, user_id, today)
    result = plan_adaptation.adjust_session(primary.type, tsb, signals)
    recovery = RecoverySummary(
        hrv=signals.hrv,
        hrv_baseline=signals.hrv_baseline,
        resting_hr=signals.resting_hr,
        resting_hr_baseline=signals.resting_hr_baseline,
        sleep_hours=signals.sleep_hours,
        body_battery=signals.body_battery,
        date=signals.data_date,
    )

    sessions = [primary]
    reason = result.reason
    if result.adjusted and addons:
        reason = f"{result.reason} Le renforcement du jour est retiré."
    else:
        sessions.extend(addons)

    return TodaySession(
        date=today,
        has_plan=True,
        has_session=True,
        week_index=week_pos + 1,
        sessions=sessions,
        adjustment=DailyAdjustment(
            adjusted=result.adjusted,
            original_type=result.original_type,
            suggested_type=result.suggested_type,
            reason=reason,
        ),
        tsb=tsb,
        recovery=recovery if recovery.has_any else None,
    )

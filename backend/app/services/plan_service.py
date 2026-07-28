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
    plan_adaptation,
    plan_progress,
    plan_validation,
    wellness_service,
)

_MAX_ATTEMPTS = 3
_RUN_VOLUME_DAYS = 56  # last 8 weeks
_ANTHROPIC_TIMEOUT_S = 120.0
# Global wall-clock budget across all attempts. The hosting platform cuts a
# synchronous request well before _ANTHROPIC_TIMEOUT_S × _MAX_ATTEMPTS (6 min):
# stop before launching a doomed attempt rather than burn tokens for a plan the
# client will never receive.
_TOTAL_DEADLINE_S = 90.0
# A full multi-week plan JSON (rationale + structure + paces per session) is
# large; 8k truncated it mid-list. Streaming removes the HTTP-timeout ceiling,
# so cap high — the cap only limits, billing is on tokens actually produced.
_MAX_TOKENS = 32000


class PlanGenerationError(Exception):
    """Raised when generation can't produce a valid plan (bad key, upstream
    failure, or 3 failed validation attempts). Carries a user-safe message."""


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
        "avg_weekly_load_4w": _avg_weekly_load_4w(fitness, today),
    }


def _system_prompt() -> str:
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
        "- Respecte `max_run_sessions_per_week` : jamais plus de ce nombre de "
        "séances de COURSE par semaine (les autres sports et le repos ne comptent pas).\n"
        "- La charge de la semaine 1 (target_load) reste proche de la charge réelle "
        "récente `avg_weekly_load_4w` (au plus +10%) : on démarre là où en est "
        "l'athlète, pas à l'objectif.\n"
        "- Les sports fixes de l'utilisateur apparaissent le bon jour ; aucune "
        "séance de qualité le lendemain d'un sport à impacts (padel, basket).\n"
        "- Toutes les séances tombent sur les jours disponibles indiqués.\n"
        "- Zones cardiaques via la FC max/repos fournies (Karvonen), jamais "
        "220−âge. Aucune recommandation médicale.\n"
        "- Si `low_confidence` est vrai dans l'état actuel (historique trop court "
        "pour être fiable), démarre délibérément bas et consacre les premières "
        "semaines à l'observation plutôt qu'à une progression agressive.\n"
        "- Chaque séance a un `rationale` d'une phrase expliquant sa place.\n"
        "- Détaille `structure` en blocs (échauffement, corps, récupération). Pour "
        "chaque bloc de course, renseigne `hr_zone` (1 à 5) et `pace_range` "
        "(allure min–max en min/km, ex. \"4:15\"–\"4:30\") cohérents avec le type "
        "de bloc ; échauffement/retour au calme en zone basse. Pour un bloc de "
        "cross-training ou de repos, laisse `hr_zone` et `pace_range` à null.\n"
        "- Le champ `sport` vaut EXACTEMENT l'une de ces valeurs : RUN, PADEL, "
        "BASKETBALL, BIKE, STRENGTH, OTHER. Pour la natation, le yoga, la "
        "mobilité, un jour de repos ou tout autre cas, mets sport=OTHER (le "
        "type de séance précise déjà la nature).\n\n"
        "Réponds UNIQUEMENT avec un objet JSON conforme au schéma, sans texte "
        "autour, sans balises markdown."
    )


def _weeks_directive(request: PlanRequest, today: date) -> str:
    if request.race_date is not None:
        weeks = max(1, math.ceil((request.race_date - today).days / 7))
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


def _user_prompt(
    request: PlanRequest, context: dict, today: date, injury: InjuryReport | None = None
) -> str:
    schema = json.dumps(Plan.model_json_schema(), ensure_ascii=False)
    req = request.model_dump(mode="json")
    return (
        f"Objectif de l'athlète :\n{json.dumps(req, ensure_ascii=False)}\n\n"
        f"État actuel (données réelles Garmin) :\n{json.dumps(context, ensure_ascii=False)}\n\n"
        f"{_weeks_directive(request, today)}\n"
        f"{_injury_directive(injury)}"
        f"{_detraining_directive(context)}"
        "Construis le plan complet, semaine par semaine, du niveau actuel "
        "jusqu'à l'objectif. La sortie longue progresse d'au plus 15 min d'une "
        "semaine à l'autre. Le cross-training compte comme charge. Si des séances "
        "récentes ont été manquées (voir progression_recente), repars du niveau "
        "actuel sans chercher à rattraper le retard.\n\n"
        f"Schéma JSON attendu (respecte-le exactement) :\n{schema}"
    )


async def _call_anthropic(
    client: "anthropic.AsyncAnthropic",
    system: str,
    user: str,
    history: list[tuple[str, str]],
) -> str:
    # Real conversational history: each past attempt is replayed as the model's
    # own assistant turn followed by the validation feedback, so "fix only these
    # points, keep the rest" is actually executable — the model sees the plan it
    # must correct. The stable prefix also lets prompt caching kick in on retries.
    messages: list[dict] = [{"role": "user", "content": user}]
    for prev_raw, prev_feedback in history:
        messages.append({"role": "assistant", "content": prev_raw})
        messages.append({"role": "user", "content": prev_feedback})
    try:
        # Streaming avoids HTTP read timeouts on a large JSON output (claude-api
        # skill). Thinking is disabled: the schema is explicit and validate_plan
        # re-prompts on any rule miss, so deep reasoning isn't needed here — and
        # it keeps generation fast and cheap on a solo app.
        async with client.messages.stream(
            model=settings.plan_model,
            max_tokens=_MAX_TOKENS,
            system=system,
            messages=messages,
            thinking={"type": "disabled"},
        ) as stream:
            response = await stream.get_final_message()
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
        raise PlanGenerationError(
            "Impossible de joindre Anthropic (réseau). Réessayez."
        ) from exc
    return "".join(block.text for block in response.content if block.type == "text")


async def _generate_valid_plan(
    request: PlanRequest, context: dict, today: date, injury: InjuryReport | None = None
) -> Plan:
    if not settings.anthropic_api_key:
        raise PlanGenerationError("Génération IA non configurée (clé API absente).")

    system = _system_prompt()
    user = _user_prompt(request, context, today, injury)

    # One client per generation (reused across attempts), not one per attempt.
    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key, timeout=_ANTHROPIC_TIMEOUT_S
    )

    history: list[tuple[str, str]] = []  # (raw_response, feedback) per failed attempt
    last_problem = "aucune réponse exploitable"
    deadline = time.monotonic() + _TOTAL_DEADLINE_S

    for attempt in range(_MAX_ATTEMPTS):
        if attempt > 0 and time.monotonic() >= deadline:
            raise PlanGenerationError(
                f"Budget temps de génération dépassé (~{_TOTAL_DEADLINE_S:.0f}s) "
                f"après {attempt} tentative(s). Dernier problème : {last_problem[:300]}"
            )
        raw = await _call_anthropic(client, system, user, history)
        try:
            plan = Plan.model_validate_json(_extract_json(raw))
        except ValidationError as exc:
            errors = exc.errors()[:3]
            last_problem = "JSON non conforme au schéma : " + "; ".join(
                f"{'.'.join(str(p) for p in e['loc'])} → {e['msg']}" for e in errors
            )
            feedback = last_problem + ". Renvoie un JSON strictement conforme au schéma."
            history.append((raw, feedback))
            continue
        violations = plan_validation.validate_plan(plan, request, today, context)
        if not violations:
            return plan
        last_problem = " ; ".join(violations)
        feedback = (
            "Le plan viole ces règles : "
            + last_problem
            + ". Corrige uniquement ces points, garde le reste."
        )
        history.append((raw, feedback))

    raise PlanGenerationError(
        f"Plan invalide après {_MAX_ATTEMPTS} tentatives. Dernier problème : {last_problem[:400]}"
    )


async def _next_version(db: AsyncIOMotorDatabase, user_id: str) -> int:
    latest = await db.plans.find_one({"user_id": user_id}, sort=[("version", -1)])
    return (latest["version"] + 1) if latest else 1


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

    version = await _next_version(db, user_id)

    try:
        plan = await _generate_valid_plan(request, context, today, injury)
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

    # Anchor the plan to the Monday of the generation week so "today's session"
    # maps cleanly onto weekday-labelled sessions.
    start_date = today - timedelta(days=today.weekday())
    doc = {
        "user_id": user_id,
        "version": version,
        "status": "ready",
        "request": request.model_dump(mode="json"),
        "plan": plan.model_dump(mode="json"),
        "start_date": start_date.isoformat(),
        "injury": injury.model_dump(mode="json") if injury else None,
        "error_message": None,
        "created_at": datetime.now(UTC),
    }
    result = await db.plans.insert_one(doc)
    return PlanResponse(
        id=str(result.inserted_id), status="ready", request=request, plan=plan
    )


async def get_current_plan(db: AsyncIOMotorDatabase, user_id: str) -> PlanResponse | None:
    doc = await db.plans.find_one({"user_id": user_id}, sort=[("version", -1)])
    if doc is None:
        return None
    return PlanResponse(
        id=str(doc["_id"]),
        status=doc["status"],
        request=PlanRequest.model_validate(doc["request"]) if doc.get("request") else None,
        plan=Plan.model_validate(doc["plan"]) if doc.get("plan") else None,
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


async def list_plan_versions(
    db: AsyncIOMotorDatabase, user_id: str
) -> list[PlanVersionSummary]:
    """Read-only history of successful plan versions, newest first."""
    cursor = db.plans.find({"user_id": user_id, "status": "ready"}).sort("version", 1)
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
                goal_description=goal.get("description"),
                race_date=goal.get("race_date"),
                weeks_total=weeks or None,
                reason=_version_reason(doc, prev_request),
                injury_area=(injury or {}).get("area"),
            )
        )
        prev_request = doc.get("request")

    summaries.reverse()  # newest first
    return summaries


async def get_plan_version(
    db: AsyncIOMotorDatabase, user_id: str, version: int
) -> PlanResponse | None:
    """A single stored version, read-only (versions are never mutated)."""
    doc = await db.plans.find_one(
        {"user_id": user_id, "version": version, "status": "ready"}
    )
    if doc is None:
        return None
    return PlanResponse(
        id=str(doc["_id"]),
        status=doc["status"],
        request=PlanRequest.model_validate(doc["request"]) if doc.get("request") else None,
        plan=Plan.model_validate(doc["plan"]) if doc.get("plan") else None,
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

    doc = await db.plans.find_one(
        {"user_id": user_id, "status": "ready"}, sort=[("version", -1)]
    )
    if doc is None or not doc.get("plan"):
        return TodaySession(
            date=today, has_plan=False, has_session=False, tsb=tsb,
            message="Aucun plan actif. Créez-en un dans l'onglet Plan.",
        )

    plan = Plan.model_validate(doc["plan"])
    weeks = _flatten_weeks(plan)
    start = _plan_start_date(doc, today)
    week_pos = (today - start).days // 7  # 0-based position

    if week_pos < 0 or week_pos >= len(weeks):
        return TodaySession(
            date=today, has_plan=True, has_session=False, tsb=tsb,
            message="Plan terminé — générez-en un nouveau pour continuer.",
        )

    week = weeks[week_pos]
    weekday = WEEKDAY_ORDER[today.weekday()]
    session = next((s for s in week.sessions if s.day == weekday), None)
    if session is None:
        return TodaySession(
            date=today, has_plan=True, has_session=False, week_index=week_pos + 1, tsb=tsb,
            message="Pas de séance prévue aujourd'hui — repos.",
        )

    signals = await wellness_service.get_recovery_signals(db, user_id, today)
    result = plan_adaptation.adjust_session(session.type, tsb, signals)
    recovery = RecoverySummary(
        hrv=signals.hrv,
        hrv_baseline=signals.hrv_baseline,
        resting_hr=signals.resting_hr,
        resting_hr_baseline=signals.resting_hr_baseline,
        sleep_hours=signals.sleep_hours,
        body_battery=signals.body_battery,
        date=signals.data_date,
    )
    return TodaySession(
        date=today,
        has_plan=True,
        has_session=True,
        week_index=week_pos + 1,
        session=session,
        adjustment=DailyAdjustment(
            adjusted=result.adjusted,
            original_type=result.original_type,
            suggested_type=result.suggested_type,
            reason=result.reason,
        ),
        tsb=tsb,
        recovery=recovery if recovery.has_any else None,
    )

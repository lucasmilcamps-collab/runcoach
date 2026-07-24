"""AI plan generation pipeline (plan-generator skill).

build_context → generate (Anthropic, JSON) → validate_plan → retry with the
violations as feedback (max 3) → persist as a new immutable version. The model
proposes; validate_plan guarantees. The API key lives server-side only and is
never logged, nor is any health data (project security rules)."""

import json
from datetime import UTC, date, datetime, timedelta

import anthropic
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from app.core.config import settings
from app.models.activity import SportType
from app.models.plan import Plan, PlanRequest, PlanResponse
from app.services import fitness_service, plan_validation

_MAX_ATTEMPTS = 3
_RUN_VOLUME_DAYS = 56  # last 8 weeks
_ANTHROPIC_TIMEOUT_S = 120.0
_MAX_TOKENS = 8000  # a plan JSON is a few thousand tokens — no need for 16k


class PlanGenerationError(Exception):
    """Raised when generation can't produce a valid plan (bad key, upstream
    failure, or 3 failed validation attempts). Carries a user-safe message."""


def _strip_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        # Drop the opening ``` / ```json line and the closing fence.
        lines = stripped.splitlines()
        lines = lines[1:] if lines else lines
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        stripped = "\n".join(lines)
    return stripped.strip()


async def build_context(db: AsyncIOMotorDatabase, user_id: str) -> dict:
    """Real athlete state fed to the prompt: current fitness/fatigue/form and
    recent run volume. Cross-training counts toward load elsewhere, but the plan
    prompt needs the running baseline specifically to set volumes."""
    fitness = await fitness_service.compute_fitness(db, user_id)

    cutoff = datetime.now(UTC) - timedelta(days=_RUN_VOLUME_DAYS)
    run_sessions = 0
    run_minutes = 0
    cursor = db.activities.find({"user_id": user_id, "sport": SportType.RUN})
    async for doc in cursor:
        start = doc.get("start_time")
        if start is None:
            continue
        start_aware = start.replace(tzinfo=UTC) if start.tzinfo is None else start
        if start_aware < cutoff:
            continue
        run_sessions += 1
        run_minutes += int(doc.get("duration_s") or 0) // 60

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
        "avg_weekly_run_minutes": round(run_minutes / weeks, 1),
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
        "- Les sports fixes de l'utilisateur apparaissent le bon jour ; aucune "
        "séance de qualité le lendemain d'un sport à impacts (padel, basket).\n"
        "- Toutes les séances tombent sur les jours disponibles indiqués.\n"
        "- Zones cardiaques via la FC max/repos fournies (Karvonen), jamais "
        "220−âge. Aucune recommandation médicale.\n"
        "- Chaque séance a un `rationale` d'une phrase expliquant sa place.\n\n"
        "Réponds UNIQUEMENT avec un objet JSON conforme au schéma, sans texte "
        "autour, sans balises markdown."
    )


def _user_prompt(request: PlanRequest, context: dict) -> str:
    schema = json.dumps(Plan.model_json_schema(), ensure_ascii=False)
    req = request.model_dump(mode="json")
    return (
        f"Objectif de l'athlète :\n{json.dumps(req, ensure_ascii=False)}\n\n"
        f"État actuel (données réelles Garmin) :\n{json.dumps(context, ensure_ascii=False)}\n\n"
        "Construis le plan complet, semaine par semaine, du niveau actuel "
        "jusqu'à l'objectif. Le cross-training compte comme charge.\n\n"
        f"Schéma JSON attendu (respecte-le exactement) :\n{schema}"
    )


async def _call_anthropic(system: str, user: str, feedback: str | None) -> str:
    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key, timeout=_ANTHROPIC_TIMEOUT_S
    )
    messages: list[dict] = [{"role": "user", "content": user}]
    if feedback is not None:
        messages.append({"role": "user", "content": feedback})
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


async def _generate_valid_plan(request: PlanRequest, context: dict, today: date) -> Plan:
    if not settings.anthropic_api_key:
        raise PlanGenerationError("Génération IA non configurée (clé API absente).")

    system = _system_prompt()
    user = _user_prompt(request, context)
    feedback: str | None = None

    for _ in range(_MAX_ATTEMPTS):
        raw = await _call_anthropic(system, user, feedback)
        try:
            plan = Plan.model_validate_json(_strip_fences(raw))
        except ValidationError as exc:
            feedback = (
                f"Le JSON précédent était invalide ({exc.error_count()} erreurs). "
                "Renvoie un JSON conforme au schéma."
            )
            continue
        violations = plan_validation.validate_plan(plan, request, today)
        if not violations:
            return plan
        feedback = (
            "Le plan viole ces règles : "
            + " ; ".join(violations)
            + ". Corrige uniquement ces points, garde le reste."
        )

    raise PlanGenerationError(
        "Impossible de produire un plan valide après plusieurs tentatives. Réessayez."
    )


async def _next_version(db: AsyncIOMotorDatabase, user_id: str) -> int:
    latest = await db.plans.find_one({"user_id": user_id}, sort=[("version", -1)])
    return (latest["version"] + 1) if latest else 1


async def generate_plan(
    db: AsyncIOMotorDatabase, user_id: str, request: PlanRequest
) -> PlanResponse:
    """Generate, validate, and persist a new plan version. Runs synchronously
    inside the request (like the Garmin sync): on a free single-instance host a
    background task can be killed mid-run, so the caller awaits the real result."""
    today = datetime.now(UTC).date()
    context = await build_context(db, user_id)
    version = await _next_version(db, user_id)

    try:
        plan = await _generate_valid_plan(request, context, today)
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

    doc = {
        "user_id": user_id,
        "version": version,
        "status": "ready",
        "request": request.model_dump(mode="json"),
        "plan": plan.model_dump(mode="json"),
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

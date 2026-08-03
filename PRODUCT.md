# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Solo tool: the developer, a runner who also does cross-training (padel, basketball) and wants an AI coach that builds and adapts a running plan around real recovery data. No other users are targeted at this stage.

## Product Purpose

Relay generates a running training plan by AI from a goal (target race or distance + time), then continuously adapts that plan using real Garmin data (activities, HR, HRV, sleep, Body Battery, VO2max). It is positioned as a hybrid-training orchestrator rather than a running app: the surface's job is arbitrating load between running, strength work and team sports. Success means the plan stays realistic and safe week to week without the user having to manually rebalance it.

## Positioning

Unlike Runna, the plan adapts dynamically to real recovery signals (HRV, sleep, Body Battery) and treats sessions from other sports (padel, basketball) as real training load feeding the same fatigue/fitness model — not as noise to ignore.

## Operating Context

Personal, single-user tool. One Expo codebase targets iOS, Android, and web/desktop — no separate desktop frontend is ever built. Backend is FastAPI + MongoDB (Motor, async); plan generation calls the Anthropic API backend-only (never from the mobile client, no client-side API key). Garmin tokens are stored encrypted in MongoDB, never logged in clear text.

Usage scene: a personal cockpit rather than a feed. The athlete opens it to answer three questions and stop — what do I do today, what has this week already cost me across every sport, and what should I move. Secondary flows: logging running and cross-training sessions, and reading the load/form detail (CTL/ATL/TSB) behind the week's summary.

Built and deployed (GitHub → Render + MongoDB Atlas). The four planned phases are in place: (1) backend + auth + Garmin sync, (2) load engine (TRIMP/CTL/ATL/TSB) + AI plan generation with a programmatic validator, (3) Expo app UI installed as an iOS PWA (Accueil, Séances, Activités, Réglages), (4) dynamic daily adjustment + replan triggers. Ongoing work refines the plan-generation pipeline (see `docs/refonte-plan-generator.md`).

## Capabilities and Constraints

- Heart-rate zones are computed from real max/resting HR via the Karvonen method — never the 220-minus-age formula.
- Weekly training load never increases more than 10% week over week, cross-training included.
- A deload week is mandatory every 3–4 weeks in any generated plan.
- Cross-training sessions always count toward ATL/CTL — never excluded from load calculations.
- Any AI-generated plan must pass the programmatic validator (`plan_validation.validate_plan`) before being persisted; on failure the plan is regenerated, never persisted invalid.
- No medical recommendations: if data suggests severe overtraining, the app can only recommend rest and consulting a professional.
- Platform is adaptive: iOS and Android should follow their native conventions (HIG / Material) while web keeps a coherent, non-native-mimicking experience — one shared brand identity across all three.
- The home screen carries exactly three blocks (today's session, the week's load ledger, one arbitration). Anything new that must be seen daily displaces one of them rather than being added as a fourth.

## Brand Commitments

The product is named **Relay** (previously the working names "RunCoach" and "Mosa"). The name is the thesis: a relay is a handover, and the plan is the sequence of handovers between disciplines.

The visual world is **"The Load Ledger"** — a technical register, documented in `DESIGN.md` and `design-system/relay-load-ledger/`. Two commitments carry it and are not negotiable per-screen:

- **Two appearances, both first-class** — Graphite (soft anthracite) and Sable (very light sand). The app is read at 6am in a dark bedroom and again at 22h after a match, so it follows the OS by default rather than picking one.
- **Colour means training load and nothing else** — Go, Prudence and Récup are read-outs, never applied to buttons or other "act here" affordances. The primary action is a neutral high-contrast fill.

Explicitly ruled out by the brand: gym-poster codes (lightning bolts, aggressive reds), social-feed framing, and the previous "Night-Trail" map metaphor (contour hairlines, waypoint pins, blaze orange).

## Evidence on Hand

The backend and mobile app both exist and are deployed; the sole real user is the developer. There is still no third-party user data, testimonials, or marketing content. First real test case remains a half-marathon plan with a fixed weekly basketball commitment. Future design and content work must not fabricate testimonials, sample data, or metrics beyond this stated test case.

## Product Principles

1. Real recovery data drives every plan adaptation — Garmin signals (HRV, sleep, Body Battery) outrank a rigid, pre-fixed schedule.
2. Cross-training is load, not noise — other sports are integrated into the athlete's fatigue/fitness model, never excluded.
3. Safety constraints are non-negotiable — the 10% weekly progression cap, mandatory deload cadence, and programmatic validation before persistence are never bypassed for the sake of a "better-looking" plan.
4. No medical overreach — the app coaches training load and adaptation, it does not diagnose or replace a professional.

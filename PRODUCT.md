# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Solo tool: the developer, a runner who also does cross-training (padel, basketball) and wants an AI coach that builds and adapts a running plan around real recovery data. No other users are targeted at this stage.

## Product Purpose

RunCoach generates a running training plan by AI from a goal (target race or distance + time), then continuously adapts that plan using real Garmin data (activities, HR, HRV, sleep, Body Battery, VO2max). Success means the plan stays realistic and safe week to week without the user having to manually rebalance it.

## Positioning

Unlike Runna, the plan adapts dynamically to real recovery signals (HRV, sleep, Body Battery) and treats sessions from other sports (padel, basketball) as real training load feeding the same fatigue/fitness model — not as noise to ignore.

## Operating Context

Personal, single-user tool. One Expo codebase targets iOS, Android, and web/desktop — no separate desktop frontend is ever built. Backend is FastAPI + MongoDB (Motor, async); plan generation calls the Anthropic API backend-only (never from the mobile client, no client-side API key). Garmin tokens are stored encrypted in MongoDB, never logged in clear text.

Usage scene: reviewing/consulting the generated plan, logging running and cross-training sessions, and checking a load/form dashboard (CTL/ATL/TSB) to understand current fatigue and readiness.

Project is starting from zero (no backend/ or mobile/ code yet), planned in phases: (1) backend + auth + Garmin sync, (2) load engine (TSS/CTL/ATL) + plan v1 (test case: half-marathon with fixed weekly basketball), (3) Expo app UI (plan, tracking, dashboard), (4) dynamic plan adaptation (the differentiator).

## Capabilities and Constraints

- Heart-rate zones are computed from real max/resting HR via the Karvonen method — never the 220-minus-age formula.
- Weekly training load never increases more than 10% week over week, cross-training included.
- A deload week is mandatory every 3–4 weeks in any generated plan.
- Cross-training sessions always count toward ATL/CTL — never excluded from load calculations.
- Any AI-generated plan must pass the programmatic validator (`plan_service.validate_plan`) before being persisted; on failure the plan is regenerated, never persisted invalid.
- No medical recommendations: if data suggests severe overtraining, the app can only recommend rest and consulting a professional.
- Platform is adaptive: iOS and Android should follow their native conventions (HIG / Material) while web keeps a coherent, non-native-mimicking experience — one shared brand identity across all three.

## Brand Commitments

"RunCoach" is a working name only, not confirmed as final. No existing logo, visual assets, or brand guidelines to preserve.

## Evidence on Hand

None yet — no backend or mobile code exists, no real user data, screenshots, or content to draw from. First real test case will be a half-marathon plan with a fixed weekly basketball commitment. Future design and content work must not fabricate testimonials, sample data, or metrics beyond this stated test case.

## Product Principles

1. Real recovery data drives every plan adaptation — Garmin signals (HRV, sleep, Body Battery) outrank a rigid, pre-fixed schedule.
2. Cross-training is load, not noise — other sports are integrated into the athlete's fatigue/fitness model, never excluded.
3. Safety constraints are non-negotiable — the 10% weekly progression cap, mandatory deload cadence, and programmatic validation before persistence are never bypassed for the sake of a "better-looking" plan.
4. No medical overreach — the app coaches training load and adaptation, it does not diagnose or replace a professional.

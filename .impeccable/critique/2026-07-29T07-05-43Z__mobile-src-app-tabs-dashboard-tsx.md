---
target: écran Accueil
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-29T07-05-43Z
slug: mobile-src-app-tabs-dashboard-tsx
---
# Critique — Accueil (Home) screen · `mobile/src/app/(tabs)/dashboard.tsx`

Method: dual-agent (A: design review · B: detector + a11y evidence)
Mode: Operate · Platform: adaptive (iOS PWA / Android / web)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Sync chip is clear, but 3 of 4 queries have no loading UI and "0 / 0 km" reads as ambiguous/broken status |
| 2 | Match System / Real World | 2 | Raw training-science jargon untranslated: "+14", "équilibre charge / récupération", "Fitness 42j", "Fatigue 7j" |
| 3 | User Control and Freedom | 3 | Stepper nodes navigate to plan; little to escape. Fine |
| 4 | Consistency and Standards | 2 | Breaks its own teal + One-Blaze color laws; removes tab icons; active-tab state is color-only |
| 5 | Error Prevention | 3 | Little user input to mis-enter here |
| 6 | Recognition Rather Than Recall | 2 | "+14 / FRAIS / histogram" require recalled meaning; icon-less tabs force reading over recognition |
| 7 | Flexibility and Efficiency | 2 | HR-profile link (powers the whole Forme calc) buried, muted, doesn't read as tappable; no quick "log a session" |
| 8 | Aesthetic and Minimalist Design | 3 | Strong restraint, but Forme card is dense (5 numbers + 90 bars) |
| 9 | Error Recovery | 2 | Only Garmin-sync error surfaces; 4 TanStack queries swallow errors silently |
| 10 | Help and Documentation | 1 | Nothing explains form/fitness/fatigue/TSB; no info affordance on the one card built entirely from jargon |
| **Total** | | **22/40** | **Acceptable — significant work needed** |

## Design Specificity Verdict

**Authored for RunCoach in its chrome and palette, but category-interchangeable in its core composition — and it breaks two of its own committed color laws.**

On-brand and coherent: the tonal depth model (ground→elevated, hairline contour, zero shadows) is executed faithfully everywhere (`week-progress-card.tsx:104`, `fitness-card.tsx:146`) — the "Tonal-Not-Cast Rule" is honored cleanly. The mono `waypointLabel` signage system gives real product character. The `WeekStepper` waypoint-trail is a legitimately on-brand metaphor.

Where it collapses to generic: the hero is a **three-column stat-row + center donut ring** — the single most interchangeable pattern in the category (Runna/Nike/Garmin/Whoop all ship it). The Forme card is the default big-number + histogram + two-stat-row. And the product's actual differentiator — **cross-training load from other sports folded into your form** — is completely invisible: nothing on this screen signals padel/basket exist.

**Color-law violations (both committed in DESIGN.md, both broken here):**
- **Teal misuse** — `formBand()` returns `hydro` teal for TSB > 5 (`fitness-card.tsx:17`), coloring "FRAIS" and the giant "+14" teal. But teal is reserved for *"live data flowing"*. TSB is a stored computed metric, not a live stream — teal has been silently repurposed as "good status," muddying the connected-data signal.
- **One Blaze Rule** — blaze appears as a *fill* twice at once: the current `WeekStepper` node (`week-stepper.tsx:94`, legitimate) **and** the histogram's last bar (`fitness-card.tsx:184`). On a non-zero week the ring arc adds a third. "Today's bar" is not an "act here."

## Deterministic Scan

`detect.mjs` returned `[]` (exit 0) on the screen and all 8 components — **a non-result, not a clean bill.** The detector's only `.tsx` style extractor matches web `styled\`…\`` / `css\`…\`` tagged templates; RunCoach uses RN `StyleSheet.create({…})` object syntax, which it never parses, and its ruleset has no RN a11y concepts (pt touch targets, `accessibilityRole`, contrast). Every `[]` is an RN false-negative by construction. No live browser overlay: Expo dev server wasn't running (ports 8081/19006 refused); not started from scratch. The static a11y sweep below is the real signal.

## Overall Impression

Calm, disciplined, genuinely "6am before a run" — the restraint is real and the tonal craft is the best part. But the screen's job on a **Home** tab is to answer one question at a glance — *am I ready to run, and what do I do next?* — and it doesn't. On a fresh week it opens with three zeros and a progress ring that **can't fill** (`target.km = 0`), then congratulates the user with an unexplained teal "+14" for having logged nothing. The single biggest opportunity: replace the goal-less ring + jargon dump with a plain-language "here's where you are, here's the next move," and put the product's cross-training thesis somewhere on its own home screen.

## What's Working

1. **Tonal depth discipline is exemplary** — every surface uses the background→backgroundElement step with hairline contour and *no shadow anywhere*. The most faithfully executed part of the brief.
2. **The mono waypoint-label system creates real product character** — ACTIVITÉS / SEMAINES / FORME / PROGRAMME EN COURS as signage reads authored, not borrowed.
3. **The unconnected `EmptyState` is well-built** — glyph + title + one why-line + one primary action + ghost fallback. Ironically the *true* empty state is handled better than the connected-but-zero state the screenshot shows.

## Priority Issues

**[P0] The hero ring shows "0 / 0 km" and cannot fill on a fresh week.**
The largest, top-most element fails in the most common first-run scenario. `fraction = target.km > 0 ? done/target : 0` (`week-progress-card.tsx:19`); `target.km` comes from `estimateDistanceKm()` (`week-progress.ts:67`) which yields 0 when the current plan week has no pace ranges. Result: a goal-less ring plus the contradiction "0/6 sessions but 0 km," which reads as broken.
*Fix:* Never render a 0-denominator ring. When `target.km === 0 && target.count > 0`, drive the ring off session count (0/6) or show planned km explicitly ("0 / 42 km"); guarantee count and km agree.

**[P1] Teal and blaze both violate their committed color laws.**
These two colors are the app's entire semantic vocabulary. Teal on "+14"/"FRAIS" (`fitness-card.tsx:17,71,77`) teaches teal = "good form," corrupting its reserved "live Garmin data" meaning. Blaze as a fill twice (`week-stepper.tsx:94` / `fitness-card.tsx:184`) dilutes "you are here / act here."
*Fix:* Recolor the form band neutral (parchment/text), reserve a teal dot only for genuinely fresh-sync values, keep red for the severe-fatigue guardrail. Change `barLast` to a non-blaze emphasis so the only blaze fill on the screen is the current waypoint / ring arc.

**[P1] The Forme card ships raw training-science jargon with zero translation.**
"+14", "équilibre charge / récupération", "Fitness 42j", "Fatigue 7j" (`fitness-card.tsx:77-93`) are meaningless to the target runner; the product's core value (are you ready to run?) is locked behind vocabulary. Nielsen #10 = 1 because of this card alone.
*Fix:* Lead with a plain-language verdict ("Reposé — prêt pour une grosse séance"), demote the number to a supporting chip, add a tappable "?" one-liner, relabel to human terms ("Ta base / Ta fatigue récente").

**[P1] TanStack query errors are silently swallowed.**
Only the Garmin-sync error surfaces (`dashboard.tsx:67`). `activitiesQuery`/`fitnessQuery`/`planQuery`/`progressQuery` have no `isError` handling — a failed `getFitness`/`listActivities` yields `[]`/`undefined` and the UI shows an empty-ish card with no message or retry. Riley (stress tester) sees a silently-broken screen.
*Fix:* Surface a "quelque chose n'a pas fonctionné · réessayer" state per card on query error; add loading UI for the 3 queries that currently show nothing while resolving.

**[P2] The action that powers the entire Forme calc is buried, mis-sized, and doesn't look tappable.**
"AJUSTER MA FRÉQUENCE CARDIAQUE" (`fitness-card.tsx:102`) is the lowest element, muted `textSecondary`, styled identically to non-interactive `waypointLabel`s (no chevron/accent). Measured **~20pt tall, no `hitSlop` → fails the 44pt target.** Yet HRmax/HRrest is what makes CTL/ATL trustworthy (Karvonen).
*Fix:* Give it a real control affordance (chevron / bordered ghost row) and ≥44pt height; when `low_confidence`, promote it up the card ("Affine ton estimation →").

**[P2] State is signalled by color alone in two places, and two accent-on-elevated pairs fail AA.**
Active tab differs from inactive only by tint — same `fontWeight: '600'` (`_layout.tsx:27-32`) → WCAG 1.4.1 fail. `WeekStepper` current/done state is color-only with no `accessibilityState` (`week-stepper.tsx:39-52`) — VoiceOver reads every week identically. Measured contrast fails: flare 12px "Fatigue élevée" on elevated = **4.20:1** (`fitness-card.tsx:71`); done-week 11px numbers `#14140F` on `contour` = **3.91:1** (`week-stepper.tsx:99`). (Note: muted `#A79F8C` text *passes* at 6.24–7.02 — not a problem.)
*Fix:* Add weight/underline/pill to the active tab; add `accessibilityState={{selected}}` + a shape cue to stepper nodes; darken flare text or bump to ≥16px; lift done-node number contrast.

## Persona Red Flags

**Jordan (first-timer) — most at risk.** Opens to three zeros and a ring that can't fill, then a card of unexplained numbers that congratulates them ("+14 FRAIS") for doing nothing. No plain-language "what to do next" in the connected state. Mental model after 5 seconds: *"Is it broken? What do these mean? What am I supposed to do?"*

**Sam (accessibility).** Active-tab state color-only (`_layout.tsx:27-28`); stepper state color-only with no `accessibilityState`; the critical HR link is a ~20pt low-affordance control; two 11–12px accent texts fail AA (4.20 / 3.91). The progress ring SVG has no `accessibilityLabel`; the histogram label carries no value/trend.

**Casey (distracted-mobile).** Icon-less all-text tab bar forces reading three French words to navigate; the Forme card (5 numbers + 90 bars) doesn't survive a stoplight glance. The one thing Casey wants — "am I ready today?" — exists only encoded as "+14," never as a word.

## Minor Observations

- Redundant "FORME" labels stacked in one card (`fitness-card.tsx:69` and `:86`).
- "AJUSTER MA FRÉQUENCE CARDIAQUE" / "FC SAISIE MANUELLEMENT · MODIFIER" are full instructions in IBM Plex Mono uppercase — violates the "Signage-Not-Sentence Rule" (mono = measurements only).
- 90-bar histogram at 44px tall with 1px bars/gaps — the "last bar is today" story is invisible without prior knowledge.
- `MaxContentWidth = 800` single-column cap strands content on wide desktop web — one narrow strip flanked by dead space. The two summary cards could sit side-by-side above ~700px.
- First successful sync drops the user straight into the three-zeros view with no transitional "welcome, here's your first week" beat.

## Questions to Consider

- If the whole thesis is *cross-training folds into your load*, why is there zero evidence any sport but running exists on the Home screen? Where's the basket session in this week's ring?
- Should the hero on a fresh week be a progress ring at all? A ring is a *fill-me* promise; on day one there's nothing to fill. Would "Ta semaine commence — 6 séances au programme" outperform "0 / 0 km"?
- Is celebrating inactivity as "freshness (+14)" the message a *coaching* app wants on an empty week — or is the honest hero "Prêt à démarrer," with form deferred until there's data behind it?
- If the biggest number on the screen is teal but computed from stored history (not live), haven't you already taught the user that teal means nothing in particular?

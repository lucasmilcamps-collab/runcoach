---
name: RunCoach
description: Night-trail waymarking for a solo, recovery-adaptive running coach
colors:
  ground: "#14140F"
  ground-elevated: "#1F2018"
  contour: "#8A6F47"
  contour-faint: "#8A6F4733"
  parchment: "#F1ECDD"
  parchment-muted: "#A79F8C"
  blaze: "#E8792C"
  blaze-deep: "#C05F1B"
  hydro: "#2FA8A0"
  flare: "#F26D71"
typography:
  body:
    fontFamily: "System (SF Pro / Roboto / system-ui)"
    fontWeight: 400
  label:
    fontFamily: "IBM Plex Mono"
    fontWeight: 500
    letterSpacing: "0.04em"
rounded:
  sm: "8px"
  md: "14px"
  lg: "20px"
spacing:
  half: "2px"
  one: "4px"
  two: "8px"
  three: "16px"
  four: "24px"
  five: "32px"
  six: "64px"
components:
  button-primary:
    backgroundColor: "{colors.blaze}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  button-primary-pressed:
    backgroundColor: "{colors.blaze-deep}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.parchment}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
---

# Design System: RunCoach

## Overview

**Creative North Star: "Night-Trail Waymarking"**

RunCoach's first surface is a trailhead read at dusk: a topographic world rendered dark, where thin contour-line hairlines trace the ground and a single "you are here" waymarker in trail-blaze orange advances as you move through onboarding. The mechanism this world carries: a plan that reads your terrain (real recovery data) and adjusts the route in front of you, not a fixed course laid down in advance. Nothing here is a stock fitness-app gradient hero or a clinical dashboard card grid — it is signage, not decoration.

Dark is the resting state (project convention, not a category default): the app is read at 6am before a run or mid-recovery in bed, not under gallery lighting. Contour lines carry structure the way hairline rules carry structure in an editorial grid, but they are drawn from a real cartographic vocabulary: sienna-brown hairlines on near-black olive ground, exactly as a relief map reads under a headlamp.

**Key Characteristics:**
- Dark, warm-neutral ground with sienna contour hairlines as the only structural ornament
- One accent does all the work: trail-blaze orange marks the current position, the primary action, and nothing else
- A second, narrow-use accent (hydro teal) exists only to mean "connected / data flowing" — never decorative
- IBM Plex Mono appears only where the app is being precise about a measurement or a position (step count, a coordinate-style label) — body text stays on the native system font

## Colors

Restrained strategy: a warm-dark neutral ground carries the surface, one saturated accent carries every action and position marker.

### Primary
- **Trail Blaze** (`#E8792C`): the "you are here" waymarker, every primary button, every active/selected state. Nothing else in the system may use this hue — its rarity is what makes it readable as "act here."
- **Trail Blaze Deep** (`#C05F1B`): pressed/active state of Trail Blaze surfaces.

### Secondary
- **Hydro Teal** (`#2FA8A0`): reserved for one meaning only — a live, successful data connection (Garmin connected, sync running). Borrowed from the hydrology-blue convention on real topo maps.

### Tertiary
- **Flare Red** (`#F26D71`): errors and destructive actions only. Distinct enough from Trail Blaze that "act here" and "something's wrong" are never visually confused.

### Neutral
- **Night Ground** (`#14140F`): base background. Warm near-black, not a pure or cool black.
- **Elevated Ground** (`#1F2018`): cards, sheets, input fields, anything one tonal step above the base — depth by tone, not by shadow.
- **Contour** (`#8A6F47`): hairline dividers, waypoint-path strokes, input borders at rest. The system's one recurring line weight/color.
- **Contour Faint** (`#8A6F4733`, 20% alpha): decorative contour texture where a hairline would be too loud (e.g. background topographic linework behind the welcome screen).
- **Parchment** (`#F1ECDD`): primary text on dark ground. Warm off-white, never pure white.
- **Parchment Muted** (`#A79F8C`): secondary/caption text, placeholder text.

### Named Rules
**The One Blaze Rule.** Trail Blaze orange appears on at most one element's fill per screen at rest (the primary CTA or the active waypoint pin). Everything else that needs emphasis uses weight, a Contour outline, or Parchment at full opacity instead of reaching for the accent.

## Typography

**Display/Label Font:** IBM Plex Mono (with monospace fallback)
**Body Font:** System — SF Pro on iOS, Roboto on Android, system-ui on web

**Character:** The system font carries every sentence a user reads and every native control, so Dynamic Type and platform conventions stay intact. IBM Plex Mono appears only for things that are literally a measurement or a position — a step counter, a waypoint index — the way a topo map sets grid references and elevation figures in a technical face distinct from its place names.

### Hierarchy
- **Title** (system font, semibold, 28/34): screen titles ("Bienvenue", "Connecter Garmin").
- **Body** (system font, regular, 16/22, max ~70ch on web): all reading text, form labels, button labels.
- **Caption** (system font, regular, 13/18): helper text, error text, secondary metadata.
- **Waypoint Label** (IBM Plex Mono, medium, 12/16, tracking 0.04em, uppercase): the "01 / 04" step counter and any coordinate-style micro-label. Never used for a full sentence.

### Named Rules
**The Signage-Not-Sentence Rule.** IBM Plex Mono never carries a full sentence or a paragraph; the moment it would wrap past a few characters, it has left signage and become body text, and switches to the system font.

## Layout

Generous vertical rhythm (Spacing scale below). Primary actions anchor to the bottom safe area as heavy, latching commitments (native call-to-action placement), never floating mid-content. The waypoint stepper sits above the screen title on every screen in the onboarding flow, so the trail position is always the first thing read.

**One alignment axis.** On a wide screen every element of a dashboard — the hero, both card columns, the week trail and the tab bar — starts and ends on the same two vertical lines. Anything that opts out (a bar stretched edge to edge, a block left outside the grid, a row whose contents drift to its extremes) reads as broken even when each piece is individually fine.

**Three width caps, one per kind of screen.** Forms and dialogs (login, plan setup, add activity, réglages…) cap at **560** — a field or a full-width button stretched to 800 reads as unfinished on desktop. Reading/list surfaces stay single-column at **800** to keep line length in HIG/Material-friendly bounds. Dashboard surfaces (Accueil, Séances) cap at **1000** and lay their summary cards out in **two columns at ≥720px** via `CardColumns` — on desktop web a single 800px strip flanked by dead space wasted the viewport, and the two summary cards read better side by side. Below the breakpoint everything stacks, unchanged. Cards are distributed by index parity so one tall card doesn't drag the layout, and a lone card falls back to full width rather than sitting in a half-width strip.

**Side by side means the same height.** Both columns end on one line: a card that stops a hundred pixels short of its neighbour reads as a layout that gave up, not as a deliberate pair. Each card takes a share of its column's leftover height and absorbs it *in kind* — the fitness curve grows into it, the week ring re-centres in it, the load bars settle around theirs. A card that swallows the space as a strip of empty padding under its content has not solved the problem, it has moved it.

Spacing scale (matches `src/constants/theme.ts`): half 2 · one 4 · two 8 · three 16 · four 24 · five 32 · six 64. More space above a heading than below it, throughout.

## Elevation & Depth

Flat-by-default: depth comes from the Night Ground → Elevated Ground tonal step, never from drop shadows. The one exception is the active waypoint pin, which carries a soft, low-opacity warm glow (a headlamp-lit marker on a dark map), not a hard drop shadow.

### Named Rules
**The Tonal-Not-Cast Rule.** Elevation is a fill-color step (Night Ground → Elevated Ground), never a `box-shadow`/native shadow, except the single named glow on the active waypoint marker.

## Shapes

Rounded (`8` / `14` / `20`): soft enough to feel like routed signage edges, never pill-shaped or fully circular except the waypoint pin itself (a true circle, the one place a perfect circle is earned — it is literally a map pin). Contour-hairline borders (1px, Contour color) outline input fields and ghost buttons instead of a filled background.

## Components

### Buttons
- **Shape:** rounded `md` (14px).
- **Primary:** Trail Blaze fill, Night Ground text, semibold, full-width at the bottom safe area. Pressed → Trail Blaze Deep.
- **Ghost/Secondary:** transparent fill, 1px Contour border, Parchment text. Used for "Se connecter" / "Plus tard" style secondary actions.
- **Disabled:** Contour Faint fill, Parchment Muted text, no press feedback.

### Touch targets on a PWA
Every control reserves **44×44 in the layout** — padding, or a transparent frame around a deliberately small visual. `hitSlop` is not an option here: it has no effect on react-native-web, and the web build *is* the product (an installed iOS PWA), so a control that leans on it is only as big as it looks. Measured before this rule existed: the plan's "Historique" link was 97×16, the week dots 28×28, the back buttons 36×36.

### Screen Crest (the signature, everywhere)
Two topographic contour lines bleed off the **top-right corner of every screen**, behind the header — the app's letterhead. One component (`screen-crest.tsx`), one drawing, one placement: the welcome screen used to build its own out of bordered `View` ellipses while the session detail drew real contours in SVG, so the same intent read as two unrelated ornaments rather than an identity.

**Near-subliminal by design** (contour at 7–10% opacity). You should have to look for it. A motif at full strength on every screen stops signifying anything and becomes wallpaper, and texture behind numbers costs legibility — so it lives in the header band and never under data or a list.

It sits inside the content column, not against the viewport edge, so it holds the same alignment axis as everything else on wide screens. The frame clips its own bleed: hanging the drawing on negative offsets added up to 36px of horizontal scroll on every screen.

**Considered and rejected:** making the motif *encode* something (contour density by plan phase). Invisible in practice, and it would break the constancy that makes a signature readable as one. The crest is identity, not information.

### Sport identity on a session
A training week mixes running with padel, basket, vélo and renfo, and the athlete's first question scanning it is *"which of these are runs?"*. Every session therefore carries **two redundant cues**: a sport glyph (`sport-icon.tsx`, same 24px/1.75 stroke vocabulary as the rest of the icon set) and a **sport-aware name**.

**Name runs by their training type, everything else by its sport.** "Footing" and "Tempo" are the meaningful distinction between two runs; "Cross-training" is a label that hides the one thing that distinguishes a basket session from a padel one. The sport is already on every session — the UI simply wasn't using it.

Cross-training is never visually subordinated to running: same card, same weight, different glyph and name. It is load, not noise.

### Action footers
A screen gets **one** full-width blaze button — the commitment it exists for. Everything else that happens to be actionable shares a single compact ghost row (44pt, sized to the row). Stacking every action as its own full-width block makes them all look equally important and buries the one that matters; it also grows without limit as features are added.

Before adding a button, check it isn't already reachable: a "Voir la semaine" action that only calls `back()` duplicates the header's back arrow and earns nothing.

### Chips / Segmented controls
Selectable chips (objectives, weekdays, durations, RPE, days-off) share one component. **Selected is an outline, not a fill:** 1.5px accent border, accent text, semibold weight, on the `backgroundSelected` tone. The setup forms show a dozen chips at once — filling each one with Trail Blaze drowned the screen's primary button in orange, which is exactly what The One Blaze Rule exists to prevent. The single blaze *fill* on a form belongs to its CTA. Selection never rests on color alone (border + text + weight, plus `accessibilityState`), and the plan-setup "variable day" state takes the Hydro tone with an `≈` prefix so the two selected states are distinguishable without color.

### Inputs / Fields
- **Style:** Elevated Ground fill, 1px Contour border, Parchment text, Parchment Muted placeholder.
- **Focus:** border shifts to Trail Blaze at 1.5px, no glow.
- **Error:** border shifts to Flare Red; a Flare Red caption line names the problem beneath the field (never a generic "invalid").

### Waypoint Stepper (signature component)
Four waypoint dots (Welcome → Login → Connect Garmin → Dashboard) connected by a thin Contour path. The current step's dot is a Trail Blaze *stroke* with the named glow — not a fill, so it never competes with the screen's primary button for the One Blaze Rule's one allowed fill. Completed steps fill Parchment Muted solid; upcoming steps stay hollow (Contour outline only). A Waypoint Label ("01/04", in Parchment, not Blaze) sits beside the current dot. This is the one component every onboarding screen shares — it only appears during onboarding, never as permanent chrome on the dashboard once the trail is complete.

### Readiness Hero (Accueil's lead)
The Accueil screen opens with the one question a Home tab exists to answer: **"suis-je prêt à courir, et qu'est-ce que je fais aujourd'hui ?"** — answered in plain French before any number. The plain-language form verdict ("Reposé — bon jour pour une séance intense.") leads; the computed value is demoted to a supporting `Forme +14 · Frais` line; today's (form-adjusted) session sits below a hairline as the single next move, tappable through to Séances. No blaze *fill* lives here — only the "Aujourd'hui" text kicker — so the One Blaze Rule's one fill stays with the current-week waymarker.

**The verdict lives in exactly one place.** `formBand()` (`lib/fitness-format.ts`) is the single source of the band, its wording and its color; the hero states it and the Forme card never repeats it. A screen that says "Forme +14 · Frais" twice reads as unfinished.

### Plan summary (what opening a plan lands on)
Opening a plan from Mes plans lands on a summary, not on its 60 sessions: **Objectif** (goal, chrono départ → projeté), **Régularité**, **Volume**, **Cycles**, **Le plan**. The full week-by-week list is one tap behind "Voir toutes les séances" — it answers a question you only ask after the ones the summary answers.

Each card leads with the one figure it exists to give (80%, 34,3 km au pic) and a plain-French line saying what it's for. Three read-outs, three deliberately different forms:

- **Régularité** — one cell per committed run, one column per week. Done / manquée / à venir differ by fill *and* outline, never by colour alone, with a legend naming all three. Missed sessions are drawn in contour, never in Flare Red: skipping a run is a fact the plan adapts to, not an error to flag. A week is only scored once it is over — shading an unfinished week as "missed" would be a lie, and it stays out of the percentage's denominator.
- **Volume** — bars, from a zero baseline, rounded at the data end only. Weekly volume is a discrete tally per week and the job is comparing weeks, which is what bars are for; the height *is* the value, so the baseline cannot start anywhere else. (Contrast the fitness curve, a rolling average, which is a line on a fitted window — the form follows the data, not the house style.) Deload weeks are lighter, not absent: the shorter bar says "less", the tone says it was planned.
- **Cycles** — one segmented bar, each segment as wide as its phase is long, with the current phase brought forward. The names sit in a plain wrapping row **below** it, never in columns matching the segments: a phase's width says how many weeks it lasts and has nothing to do with how long its name is.

### Week Runs (what this week asks of you)
Under the week trail on Accueil: the current week's running sessions, one 44pt row each — day, name, duration and estimated distance — opening straight onto the session. The trail says *where* you are in the plan and the hero says what to do *today*; between them, "what does this week ask of me?" had no answer short of opening Séances.

**Runs only, and that is the point.** It sits a few blocks below "Ta charge cette semaine", which lists every sport with the same bar treatment because cross-training *is* load. These two are not in tension: one answers "what has my body absorbed this week?", the other "what does the running plan ask of me?". Folding padel into the second would blur both. A deload week wears a Décharge chip — without it, a light week reads as falling behind rather than as planned recovery.

### Load Breakdown (the thesis, made literal)
"Ta charge cette semaine" lists every sport logged this week — running *and* padel/basket/bike — with the **same bar treatment**, because the product's whole thesis is that cross-training is load, not noise. Bars are sienna Contour, never a second accent: this is a read-out, not a call to act. Cross-training is never visually subordinated to running, and never collapsed into a single "activities" total.

### Charts: baselines, and saying it in words
The 90-day fitness trend is a **line**, not bars. Bars and filled areas state their value through their height, so they are only ever drawn from a zero baseline; a line carries no such claim and may be scaled to the data's own range. CTL lives inside a narrow band, and a zero baseline pressed three months of training into the top fifth of the plot — so the line gets a fitted window, with a floor on how far it will zoom (a couple of points of drift must keep looking like drift, never a mountain range).

**A chart states its conclusion in words.** The curve shows the shape; a plain-French line above it ("En hausse · +14 sur 90 jours", "Stable sur 90 jours") gives the direction and the size of the move, so the magnitude never rests on a scaled axis the reader can't see. Chart marks stay in Contour with the endpoint in Parchment — never Blaze: a read-out is not a call to act.

### Navigation
No tab bar during onboarding (it is a linear trail, not a set of destinations). Once the trailhead flow completes, the app switches to native tab navigation for the main product, styled with the same Night Ground / Trail Blaze vocabulary but documented separately once that surface is built.

## Do's and Don'ts

### Do:
- **Do** keep Trail Blaze to one filled element per screen (The One Blaze Rule).
- **Do** render depth as a tonal step (Night Ground → Elevated Ground), never a cast shadow (The Tonal-Not-Cast Rule).
- **Do** keep IBM Plex Mono to short signage labels only (The Signage-Not-Sentence Rule).
- **Do** use Hydro Teal exclusively to mean "connected/live data" — nowhere else.

### Don't:
- **Don't** add a gradient hero, stock runner photography, or confetti/celebration animation on the welcome screen — that is the category rut this world explicitly refuses.
- **Don't** use Flare Red for anything but errors/destructive actions, even when a designer's instinct reaches for red as a second accent.
- **Don't** turn the Waypoint Stepper into a literal illustrated map (terrain textures, drawn mountains) — it stays abstract signage, not an illustration.

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
  flare: "#E5484D"
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
- **Flare Red** (`#E5484D`): errors and destructive actions only. Distinct enough from Trail Blaze that "act here" and "something's wrong" are never visually confused.

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

Single-column, generous vertical rhythm (Spacing scale below); content max-width 800 on web/tablet to keep line length in HIG/Material-friendly bounds. Primary actions anchor to the bottom safe area as heavy, latching commitments (native call-to-action placement), never floating mid-content. The waypoint stepper sits above the screen title on every screen in the onboarding flow, so the trail position is always the first thing read.

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

### Inputs / Fields
- **Style:** Elevated Ground fill, 1px Contour border, Parchment text, Parchment Muted placeholder.
- **Focus:** border shifts to Trail Blaze at 1.5px, no glow.
- **Error:** border shifts to Flare Red; a Flare Red caption line names the problem beneath the field (never a generic "invalid").

### Waypoint Stepper (signature component)
Four waypoint dots (Welcome → Login → Connect Garmin → Dashboard) connected by a thin Contour path. The current step's dot is a Trail Blaze *stroke* with the named glow — not a fill, so it never competes with the screen's primary button for the One Blaze Rule's one allowed fill. Completed steps fill Parchment Muted solid; upcoming steps stay hollow (Contour outline only). A Waypoint Label ("01/04", in Parchment, not Blaze) sits beside the current dot. This is the one component every onboarding screen shares — it only appears during onboarding, never as permanent chrome on the dashboard once the trail is complete.

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

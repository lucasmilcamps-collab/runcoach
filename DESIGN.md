---
name: Relay
description: A load ledger for one athlete's whole week — calm performance, dual anthracite/sable, colour reserved for training-load signals
colors:
  surface: "#16181A"
  raised: "#1D2023"
  inset: "#24282C"
  rule: "#33383E"
  rule-strong: "#6B747D"
  ink: "#E9E7E3"
  ink-muted: "#9BA1A7"
  go: "#4FB286"
  prudence: "#D9A23F"
  recup: "#6E9CCB"
  alerte: "#E4776A"
typography:
  body:
    fontFamily: "System (SF Pro / Roboto / system-ui)"
    fontWeight: 400
  label:
    fontFamily: "Azeret Mono"
    fontWeight: 500
    letterSpacing: "0.06em"
  figure:
    fontFamily: "Azeret Mono"
    fontWeight: 500
    fontVariantNumeric: "tabular-nums"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
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
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  button-primary-pressed:
    backgroundColor: "{colors.ink-muted}"
  button-ghost:
    backgroundColor: "transparent"
    borderColor: "{colors.rule-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
---

# Design System: Relay

## Overview

**Creative North Star: "The Load Ledger"**

Relay is not a running app with cross-training bolted on; it is the register where every discipline an athlete practises — course, renfo, padel, basket — posts to the same account, and the interface exists to arbitrate between them. The world it borrows from is the technical register: a machinist's job card, a commissaire's exchange-zone sheet, a lab logbook. Ruled lines, one column grid, figures set in a tabular mono, nothing decorative that isn't also structural.

The name is the thesis. A relay is a handover: Tuesday's basket match hands its fatigue to Wednesday's tempo, and the plan is the sequence of those handovers, not a list of runs. The app's job is to say what the previous leg left behind.

**What this world replaces, deliberately.** The previous identity (Mosa, "Night-Trail Waymarking") read the plan as a route through terrain, with contour hairlines and a blaze-orange waymarker. That metaphor said *journey*; this product's problem is *arbitrage*. The map is gone: no contours, no pins, no trail, no blaze. Nothing from that system survives except the spacing rhythm and the discipline about accessible contrast.

**Key Characteristics:**
- Two appearances, both first-class: **Graphite** (soft anthracite, never pure black) and **Sable** (very light sand, never pure white). Chosen by the system, overridable by the athlete.
- Colour never means brand. It means training load, and only that: three signal inks with one meaning each, plus one error ink.
- Structure comes from hairline rules and tonal steps, never from cast shadows or a wall of same-size cards.
- Figures are set in Azeret Mono with tabular numerals so columns of numbers align down a week; sentences stay on the platform's own face.

## Colors

Restrained strategy: a neutral ground carries the entire surface, and saturated colour is spent exclusively on training-load state.

### Named Rules

**The Signal Is Never A Command.** Go, Prudence and Récup describe the athlete's state — they are read-outs. A button, a link, a selected tab or any other "act here" affordance is therefore **never** filled with a signal ink; the primary action is a neutral high-contrast fill (Ink on Graphite, near-black on Sable). This is the rule that keeps the palette honest: the moment a CTA is green, "green" stops meaning "this is today's key session" and starts meaning "click me". It also means a screen can carry three signals at once without competing with its own action.

**One Meaning Per Ink.** Each signal is defined by what it says about load, not by where it looks good. Reusing Prudence because a card "needed a warm accent" is the failure this rule names.

### Signal inks

| Ink | Graphite | Sable | Means, and only this |
|---|---|---|---|
| **Go** | `#4FB286` | `#23694A` | The session that carries the week's stimulus — today's key workout, a completed quality session, a green light to train hard. |
| **Prudence** | `#D9A23F` | `#7A5509` | Accumulated fatigue, surcharge risk, a session the engine has downgraded. Caution, never failure. |
| **Récup** | `#6E9CCB` | `#2F5B87` | Deliberate ease: recovery days, deload weeks, rest. A quiet colour for a day that is *supposed* to be quiet. |
| **Alerte** | `#E4776A` | `#A63C31` | Errors and destructive actions only. Never a fourth load state. |

A missed session is **not** Alerte. Skipping a run is a fact the plan adapts to; drawing it in the error colour tells the athlete they failed at something the product exists to absorb. Missed sessions are drawn in Rule.

### Neutrals

| Token | Graphite | Sable | Role |
|---|---|---|---|
| `surface` | `#16181A` | `#F2EEE6` | The ground. Soft anthracite / very light sand — no pure black, no pure white. |
| `raised` | `#1D2023` | `#FBF9F5` | Cards, sheets, fields. One tonal step, in the direction the appearance implies. |
| `inset` | `#24282C` | `#E5DFD2` | Selected and pressed surfaces, chart tracks. |
| `rule` | `#33383E` | `#CBC1AC` | The hairline. The system's one structural line — matched across appearances so a divider never reads a step fainter in one of them. |
| `rule-strong` | `#6B747D` | `#857D6C` | Borders that carry state or an affordance (fields, ghost buttons) — ≥3:1 on every ground, per WCAG 1.4.11. |
| `ink` | `#E9E7E3` | `#1B1D1F` | Primary text, and the fill of the primary button. Warm off-white / warm near-black. |
| `ink-muted` | `#9BA1A7` | `#5A5F64` | Secondary text, labels, placeholders. AA on all three grounds. |

Every text colour listed clears 4.5:1 on `surface`, `raised` **and** `inset` in both appearances — verified, not assumed. Secondary text is never a lighter grey improvised at the call site.

### The intensity ramp

Training zones Z1→Z5 are the one place colour encodes a scale rather than a state, and the scale runs between two signals that already exist: from Récup at Z1 to Go at Z5.

- Graphite: `#6E9CCB → #66ACC5 → #5EBCBF → #56B9A4 → #4FB286`
- Sable: `#2F5B87 → #2C6980 → #297678 → #267161 → #23694A`

The ends are not *near* Récup and Go, they **are** Récup and Go — the steps are interpolated between that appearance's own two signal tokens, so the rule the ramp states is literally the ramp.

Two hues, sequential, never a rainbow — and it never passes through Prudence, because a hard session is not a warning. Colour on the ramp is always paired with the zone number or a bar height; it never carries the value alone.

## Typography

**Body:** System — SF Pro on iOS, Roboto on Android, system-ui on web. Dynamic Type and platform conventions stay intact.
**Signage and figures:** Azeret Mono (500). A low-contrast geometric mono with the squared-off, drawn-to-a-grid character of machine lettering — the register's own hand.

Two jobs, one face:

- **Labels** — uppercase, 0.06em tracking. Section kickers, column heads, stat names. Short signage, never a sentence.
- **Figures** — tabular numerals. Every number the athlete is meant to compare: durations, distances, loads, paces, form values, percentages. Tabular is the functional reason the mono is here at all: a week of loads stacked in a column must align on the decimal, and a proportional face makes "112" narrower than "998".

### Hierarchy

Six steps, and only six. A screen that wants a size between two of them wants a different layout.

- **Title** (system, 600, 28/34) — screen titles. One per screen, and only one.
- **Subtitle** (system, 600, 20/26) — the sentence a block leads with; a card's heading.
- **Body** (system, 400, 16/22, ≤70ch on web) — everything read as prose.
- **Action** (system, 600, 16/22) — button labels and tappable card titles. Body's size at Action's weight, never its own size.
- **Caption** (system, 400, 13/18) — helper text, metadata, the line explaining what a figure means.
- **Label** (Azeret Mono, 500, 12/16, +0.06em, uppercase) — signage.
- **Figure** (Azeret Mono, 500, tabular, sized at the call site from 13 to 32) — numbers under comparison.

**Every size follows the reader.** All seven steps go through `typeSize()`, which emits points on native — where the OS multiplies them by the reader's text-size setting — and **rem** on web, where a number compiles to `px` and `px` ignores the browser's own text preference entirely. A raw number in a `fontSize` is a size that will not grow for someone who needs it to, and the web build *is* the product here.

Growing text is a layout problem as much as a type one. Three places earn special handling at large sizes: the ledger's seven day-columns drop to two-letter days past ~1.4×, rows that pack a name beside its figures wrap instead of squeezing the name, and the tab bar grows with its labels up to a clamp (`useClampedFontScale`) — navigation pinned to the bottom of every screen cannot take a third of the phone. Everything else survives on min-heights and wrapping. Verified at 200%, which is the bar WCAG 1.4.4 sets.

### Named Rules

**The Measurement Rule.** Azeret Mono appears where something is measured, counted or labelled as a column head. It never sets a sentence, and it is never reached for to make a block look technical — the mono is a tabular tool, not a costume.

**A figure never appears alone.** Every number carries a Label naming it and, where the number is a judgement, a plain-French line stating the conclusion. "Forme +14" is a reading; "Frais — bon jour pour une séance intense" is what the athlete came for. Nothing measured yet reads "—", never "0": nothing measured and nothing achieved are different statements.

## Layout

**Three blocks per screen, at most.** The brief this system was built from is explicit: an athlete opening the app is arbitrating, not browsing. Accueil answers *what do I do today*, *what has this week already cost me*, *what should I move* — and stops. A fourth block on a home screen means one of the three wasn't doing its job.

**The rule, not the card, carries structure.** Blocks are separated by a 1px Rule hairline and vertical rhythm, not by giving every group a raised box with a radius. A raised surface is earned by something that is genuinely a distinct object (a session, a field, a sheet), not by a heading with text under it. Nested cards do not exist in this system.

Spacing scale: half 2 · one 4 · two 8 · three 16 · four 24 · five 32 · six 64. More space above a heading than below it, everywhere.

**One alignment axis.** On a wide screen the header, every block, the ledger and the tab bar start and end on the same two vertical lines. A bar stretched edge to edge while its neighbours sit in the column reads as broken even when each piece is fine on its own.

**Three width caps, one per kind of screen.** Forms and dialogs cap at **560**; reading and list surfaces stay single-column at **800**; ledger/dashboard surfaces cap at **1040** and split into two columns at ≥720px. Below the breakpoint everything stacks.

**Side by side means the same height.** Two columns end on one line; a block that stops short of its neighbour reads as a layout that gave up. Each absorbs its leftover height in kind — the ledger's columns grow, a trend line grows into its plot — never as a strip of empty padding under the content.

## Elevation & Depth

Flat by default: depth is the `surface → raised → inset` tonal step. No cast shadows anywhere in the app, in either appearance — a soft drop shadow under every card is the surface habit this world replaces with a hairline. Sheets and modals are the sole exception and take a real shadow with an offset and a soft blur, because they genuinely float above the page.

## Shapes

Moderate corners: `6` / `10` / `14`. Nothing is pill-shaped; the one true circle is the avatar, which is a portrait frame and reads wrong at any other radius. Rounded rectangles are drawn with a hairline border rather than a fill wherever the object is a container rather than a control.

## Components

### Buttons
- **Primary:** Ink fill, Surface label, Action weight, `md` radius, full width at the bottom of the screen. Pressed → Ink Muted. Never a signal ink (The Signal Is Never A Command).
- **Ghost:** transparent, 1px Rule Strong border, Ink label. Pressed → Inset fill.
- **Disabled:** Inset fill, Ink Muted label, no press feedback.
- **One primary per screen.** Everything else actionable shares one compact ghost row. Stacking full-width buttons makes them all look equally important and buries the one that matters.

### Touch targets
Every control reserves **44×44 in the layout** — real padding or a transparent frame, never `hitSlop`, which is inert on react-native-web and the web build *is* the product (an installed PWA).

### The Ledger (the signature component)
Seven day-columns on one shared baseline, one per day of the current week. Each day stacks its disciplines as segments whose height is that session's load, so a Tuesday with a basket match and a Wednesday with a tempo are compared on the same axis — which is the product's whole argument made into a drawing. Planned load is drawn as a hairline outline, realised load as a fill. Today's column carries a Raised lane the width of the bars; nothing else is highlighted.

**The day-state marks never rest on colour.** Go and Récup ticks differ in length as well as hue, and a legend names both whenever one is drawn — a green mark with nothing to decode it is a colour-only signal, which is the one thing this system's own colour rule cannot excuse.

**Cross-training is never subordinated.** Same width, same baseline, same treatment as a run — a different segment tone and a named sport. It is load, not noise. Collapsing padel and basket into a single "autres" segment is the one thing this component may never do.

**The ledger states its conclusion in words.** Above it: the surcharge verdict in plain French ("Charge modérée — le match de mardi pèse encore"). The drawing shows the shape; the sentence gives the size and the direction, so the magnitude never rests on an axis the reader can't see.

### Arbitrage (the block that closes Accueil)
One suggestion, its reason, and one action. "Décale le renfo jambes à demain — le match d'hier soir laisse la charge haute." The reason is not optional: an adjustment the athlete can't audit is an adjustment they will override, and every suggestion the engine makes is deterministic and explainable (`plan_adaptation`). Never more than one suggestion at a time — a list of suggestions is a to-do list, not an arbitration.

### Session rows
Every session carries **two redundant cues**: a sport glyph and a sport-aware name. Runs are named by their training type (Footing, Tempo, Sortie longue) because that is the meaningful distinction between two runs; everything else is named by its sport, because "Cross-training" hides exactly what distinguishes a basket session from a padel one.

### Chips / segmented controls
Selected is an **outline plus weight**, never a signal fill: 1.5px Rule Strong border, Ink label, Action weight, on the Inset ground. Selection never rests on colour alone, and carries `accessibilityState`.

### Inputs / fields
Raised fill, 1px Rule Strong border, Ink text, Ink Muted placeholder. Focus shifts the border to Ink at 1.5px — neutral, because focus is chrome and not a signal. Error shifts it to Alerte with an Alerte caption naming the problem and the way out, never a generic "invalide".

### Charts
- **Bars from a zero baseline, always.** A bar states its value through its height, so the baseline cannot start anywhere else. The ledger and the volume chart are bars.
- **Lines may be scaled to their data.** A line makes no claim about height, so the 90-day fitness curve gets a fitted window with a floor on the zoom — a couple of points of drift must keep looking like drift, never a mountain range.
- Chart marks stay in Ink Muted and Rule with the endpoint in Ink, unless the mark's job is to state a load state, which is the one case a signal ink is correct in a chart.

### Navigation
Native tab navigation (Accueil / Séances / Activités) once onboarding completes; no tab bar during onboarding, which is a linear sequence rather than a set of destinations. The tab bar's active state is Ink with heavier weight — not a signal ink.

### Appearance switching
Graphite and Sable follow the system by default, with an explicit override in Réglages (Système / Clair / Sombre). The scene decides the default rather than a house preference: this app is read at 6h before a run in a dark room, and again at 22h after a match — the system's own choice is the only honest answer, so neither appearance is a "real" theme with the other as a fallback. Every token resolves per appearance; a component that hard-codes a hex is a bug.

### The mark
**Relay — "Tous tes sports comptent."** Two bars on one baseline: the first ends, the second picks up where it left off and continues past it, with the exchange drawn as the gap between them. A relay handover, and the product's argument in two strokes — one discipline's effort passing into the next, one continuous line of load rather than a headline plus some noise.

Two bars and not a baton or a runner: the mark has to survive at 16px in a browser tab, and a figurative silhouette does not. The wordmark is set in Azeret Mono with wide tracking — the app's own signage face, rather than a display face the type system would then have to justify.

## Do's and Don'ts

### Do:
- **Do** keep every signal ink to its one meaning, and keep them off buttons (The Signal Is Never A Command).
- **Do** carry structure on hairlines and tonal steps; a card is earned by being an object.
- **Do** set every comparable number in Azeret Mono with tabular figures, and name it with a Label.
- **Do** design and test both appearances. Neither is the fallback.

### Don't:
- **Don't** bring back the map: no contour lines, no waypoint pins, no trail metaphor, no blaze orange.
- **Don't** put a drop shadow under a card, or nest a card inside a card.
- **Don't** draw a missed session in Alerte, or fill a CTA with Go.
- **Don't** add a fourth block to Accueil. If something new must be seen daily, it displaces one of the three.

# Design System Master — Relay « The Load Ledger »

> **LOGIC:** When building a specific screen, first check `design-system/relay-load-ledger/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. Otherwise, follow the rules below.
>
> **Source of truth in code:** [`mobile/src/constants/theme.ts`](../../mobile/src/constants/theme.ts) (tokens),
> [`mobile/src/hooks/use-theme.ts`](../../mobile/src/hooks/use-theme.ts) (appearance resolution),
> [`mobile/src/components/themed-text.tsx`](../../mobile/src/components/themed-text.tsx) (type scale),
> project `DESIGN.md` (rationale). If this file and the code ever disagree, **the code wins** — update this file.

**Project:** Relay — hybrid training orchestrator (course + renfo + sports co)
**Platform:** React Native / Expo (installed as an iOS **PWA**). **No Tailwind, no shadcn, no CSS.** Style via `makeStyles` + tokens.
**Appearances:** **Two, both first-class** — Graphite (soft anthracite) and Sable (very light sand). Neither is a fallback. Follows the OS by default, overridable in Réglages.
**Metaphor:** a technical register — ruled lines, one column grid, tabular figures, colour spent only on training-load state.

---

## Global Rules

### Colour comes from `useTheme()`, never from a module constant

A hex in a module-level `StyleSheet` resolves for exactly one appearance. Layout still belongs in a stylesheet, so the project uses a palette-aware factory:

```ts
const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.raised } }));

function Card() {
  const styles = useStyles();          // layout + colour, per appearance
  const theme = useTheme();            // palette at the call site (SVG fills, icon tints)
  return <View style={styles.card} />;
}
```

`makeStyles` caches one sheet per appearance — cheap enough for a list of a hundred rows.

### Palette (from `theme.ts` — use the token, never a raw hex in a component)

| Token | Graphite | Sable | Role |
|------|-----|-----|------|
| `surface` | `#16181A` | `#F2EEE6` | The ground. No pure black, no pure white. |
| `raised` | `#1D2023` | `#FBF9F5` | Cards, fields, the ledger's today lane. |
| `inset` | `#24282C` | `#E5DFD2` | Selected / pressed surfaces. |
| `rule` | `#33383E` | `#CBC1AC` | The hairline. Matched across appearances (~1.5:1 on its ground in both). |
| `ruleStrong` | `#6B747D` | `#857D6C` | Borders carrying state or an affordance (≥3:1, WCAG 1.4.11). |
| `ink` | `#E9E7E3` | `#1B1D1F` | Primary text **and** the primary button's fill. |
| `inkMuted` | `#9BA1A7` | `#5A5F64` | Secondary text, labels, realised ledger bars. |
| `inkPressed` | `#C4C1BC` | `#43484D` | Primary button, pressed. |
| `go` | `#4FB286` | `#23694A` | The session carrying the week's stimulus. |
| `prudence` | `#D9A23F` | `#7A5509` | Accumulated fatigue, surcharge, a downgraded session. |
| `recup` | `#6E9CCB` | `#2F5B87` | Deliberate ease: recovery, deload, rest. |
| `alerte` | `#E4776A` | `#A63C31` | Errors and destructive actions **only**. |
| `*Wash` | — | — | Low-alpha ground for a signal (`goWash`, `prudenceWash`, …). |

Every text token clears **4.5:1 on `surface`, `raised` and `inset`** in both appearances. Verified, not assumed — re-check before changing one.

**The Signal Is Never A Command.** `go` / `prudence` / `recup` describe the athlete's state. A button, link, selected tab or any "act here" affordance is **never** filled with one; the primary action is neutral `ink`. The moment a CTA is green, green stops meaning "today's key session".

**One Meaning Per Ink.** Never reuse a signal because a block "needed a warm accent". A missed session is `rule`, never `alerte`: skipping a run is a fact the plan absorbs, not an error.

**Intensity ramp** (`ZoneRamp` in `theme.ts`, read via `useZoneRamp()`): Z1→Z5 is interpolated between that appearance's own Récup and Go, so Z1 *is* Récup and Z5 *is* Go — two hues, sequential, never through Prudence, because a hard session is not a warning. Always paired with the zone number or a bar height.

### Typography (from `themed-text.tsx` — use `<ThemedText type=…>`, don't hand-set sizes)

| `type` | Size / line-height / weight | Font | Use |
|--------|------------------------------|------|-----|
| `title` | 28 / 34 / 600 | system | Screen title. One per screen. |
| `subtitle` | 20 / 26 / 600 | system | The sentence a block leads with |
| `default` | 16 / 22 / 400 | system | Body |
| `link` | 16 / 22 / 600 | system | Button label, tappable row title |
| `small` | 13 / 18 / 400 | system | Helper, metadata |
| `label` | 12 / 16 / mono | **Azeret Mono**, UPPERCASE, +0.06em | Kickers, column heads, stat names |
| `figure` | 20 / 26 / mono, tabular | **Azeret Mono** | Every number under comparison |

- **Body/headings = the platform system font.** The only project face is Azeret Mono, and it carries exactly two jobs: signage `label` and tabular `figure`.
- **The Measurement Rule:** mono never sets a sentence, and is never reached for to make a block look technical. Tabular figures are the functional reason it exists — a column of loads has to align.
- **A figure never appears alone:** a `label` names it, and where it is a judgement a plain-French line states the conclusion. Nothing measured yet reads `—`, never `0`.
- Base body is 16px (avoids iOS zoom). Don't go below 13px for meaningful text.
- **Never write a raw `fontSize`/`lineHeight` number** — go through `typeSize()`. It stays a point size on native (the OS scales it) and becomes `rem` on web, where a number compiles to `px` and stops following the browser's text-size preference. `<ThemedText>` already does this; only inline overrides need care.
- Layout that holds text scales with `useFontScale()` / `useClampedFontScale()` (`hooks/use-font-scale.ts`). Prefer `minWidth`/`minHeight` and `flexWrap` over fixed dimensions; reach for the hook only where a real number is unavoidable (the tab bar's height, the ledger's day labels). Check dense screens at 200%.

### Spacing (`Spacing`, 4px rhythm) & radius (`Rounded`)

`half 2 · one 4 · two 8 · three 16 · four 24 · five 32 · six 64` — blocks separated by `five`, list gaps `three`, inline gaps `two`.
`Rounded.sm 6` (chips, fields) · `Rounded.md 10` (buttons, cards) · `Rounded.lg 14`. Nothing pill-shaped; the avatar is the one true circle.
Layout: bottom scroll padding via `useTabScrollPadding()`. Three width caps:
- **`MaxFormWidth 560`** — forms & dialogs (login, garmin-connect, plan-setup, add-activity, injury-report, fitness-profile, settings).
- **`MaxContentWidth 800`** — reading/list screens (activités, historique, détail, forme).
- **`MaxContentWidthWide 1040`** — Accueil and Séances, two columns above `WideBreakpoint 720` (`useIsWide()`).

Don't hand-roll a width check — use the hook.

### Structure = rules and tone, never shadows or a wall of cards

**No drop shadows anywhere** (sheets and modals excepted). Depth is the `surface → raised → inset` step, and blocks are separated by a 1px `rule` hairline plus vertical rhythm. **A card is earned by being an object** (a field, a sheet, a settings group); a heading with text under it is not one. **Nested cards do not exist.**

**Three blocks per screen, at most** — the rule Accueil is built on. A fourth block means one of the three isn't doing its job.

---

## Component Specs (React Native)

- **Button** (`button.tsx`): `minHeight 52`, `Rounded.md`. `primary` = `ink` fill + `surface` label, pressed → `inkPressed`. `ghost` = transparent + `ruleStrong` border, pressed → `inset`. Disabled = `inset` fill + `inkMuted` label. **One primary per screen**; everything else shares one compact ghost row.
- **The Ledger** (`week-ledger.tsx` + `lib/week-ledger.ts`): the signature. Seven day-columns on one shared baseline, unit = **minutes** — the one quantity that exists for a planned session and a finished one, a tempo and a basket match, without estimating anything into existence. Realised = filled `inkMuted`; still-planned = dashed `ruleStrong` outline. Today = a `raised` lane the width of the bars. Colour appears **only** on the state tick under a column — and never alone: Go and Récup ticks differ in length too, and a legend names both whenever one is drawn. Cross-training is never folded into an "autres" segment, and never gets a colour legend — sport is carried by the glyph and by the totals line.
- **Today block** (`today-block.tsx`): Accueil's lead. The session named at `subtitle`, its duration as a `figure`, its target line underneath. The Go tick appears only when the plan marked the session key. A server adjustment shows its reason **verbatim**.
- **Arbitrage block** (`arbitrage-block.tsx`): one suggestion, its reason, one action — never a list. Suggestions come from the server's own downgrade rules or from facts on the page (high fatigue + a session today + an empty tomorrow). When there's nothing to arbitrate, it says so.
- **Session row** (`plan-view.tsx`): a row on a rule, not a card. Fixed day column, key tick, sport glyph, sport-aware name, `figure` meta, intensity notches, chevron.
- **Chip** (`chip.tsx` — use the shared component, don't redefine it per screen): `minHeight 44`, `Rounded.sm`. **Rest = outline only** (transparent + `rule`); **selected = `inset` + 1.5px `ruleStrong` + `link` weight**. Never a signal fill. `variant="dashed"` is the plan-setup "variable day" (paired with an `≈` prefix — shape and label, never colour). `fill` shares the row equally so the 7 weekdays fit on one line.
- **Intensity** (`intensity-notch.tsx`): four rising notches tinted from the zone ramp, always with the level in words beside them. Replaces the lightning bolts — gym-poster shorthand this product does not speak in.
- **Icons** (`icon.tsx`, `sport-icon.tsx`, `ledger-glyph.tsx`): in-house **SVG stroke set**, `strokeWidth 1.75`, 24px grid. **No emoji, no icon font.** The `tab-*` glyphs come from Relay's own vocabulary (bars on a baseline, a week, a logbook).
- **Sport identity** (`sport-icon.tsx` + `sessionTitle()` in `plan-format.ts`): every session shows a sport glyph **and** a sport-aware name — runs keep their training type (Footing, Tempo), every other sport is named by its sport. Use `sessionTitle()` at **every** site that names a session; don't reach for `SESSION_LABELS[type]`.
- **Leg stepper** (`leg-stepper.tsx`): onboarding progress as four segments of one baseline, with `NN / 04` and the leg's name. Neutral — progress is not a load state.
- **Charts**: bars from a zero baseline (ledger, volume); a line may be scaled to its own data (the 90-day fitness curve, with a floor on the zoom). Every chart states its conclusion in words above it, and exposes itself as one `accessibilityRole="image"` with a full label — a tree of bare `View`s announces nothing.
- **Empty states** (`empty-state.tsx`): the ledger glyph, a title, one line of why-it-matters, the single next action. Not a bordered card — nothing is contained yet.
- **Top bar** (`top-bar.tsx`): avatar (→ Réglages) then name + week range, left-aligned, collapsing on scroll. No wordmark — the tab bar says where you are.
- **Tab bar**: stroke icon + 12px label, height `62 + safe-area bottom`, active tint `ink` **and** bold label (never tint alone — WCAG 1.4.1). Capped at `MaxContentWidthWide` and centred.

---

## Interaction & Motion (native, not web)

- **Press feedback is mandatory** on every tappable surface. Custom `Pressable`s use `pressable(style)` (`lib/pressable.ts`). There is **no hover** and no `cursor` on this platform.
- **Touch targets ≥ 44×44 in the layout itself** — padding or explicit dimensions, never `hitSlop`. **`hitSlop` does nothing on react-native-web**, and this app ships as an installed iOS PWA. When the visual must stay small, wrap it in a transparent 44pt frame.
- Keep transitions ~150–300ms if animating; respect reduced motion. The app is mostly static — acceptable.

## Accessibility

- `accessibilityLabel` on every icon-only control and tappable row.
- **Never encode meaning by colour alone** — zones carry a number, chips carry weight and `accessibilityState`, the ledger's day states are named in the chart's own description.
- Both appearances are tested, not just one.
- Respect the bottom safe-area inset; keep targets clear of the home indicator.

---

## Anti-Patterns (do NOT use)

- ❌ A **signal ink on a button, link or selected control** (breaks The Signal Is Never A Command).
- ❌ **Raw hex** in components, or colour in a module-level `StyleSheet` — use `makeStyles` / `useTheme()`.
- ❌ **Drop shadows / elevation**, or a **card nested in a card**.
- ❌ Reviving the old world: contour hairlines, waypoint pins, a trail metaphor, blaze orange.
- ❌ **A missed session in `alerte`**, or a fourth block on Accueil.
- ❌ **Emoji or icon fonts** as icons — use the SVG `Icon` set.
- ❌ **Tailwind / shadcn / CSS / hover / cursor** patterns — this is React Native.
- ❌ **Mono for body text** — mono is `label` and `figure` only.
- ❌ Tappable surface with **no press feedback** or a **< 44px** target.

---

## Pre-Delivery Checklist (App UI — iOS PWA / RN)

- [ ] Colour resolves through `makeStyles` / `useTheme()`; **checked in Graphite and Sable**
- [ ] Signal inks only on read-outs; the primary action is `ink`
- [ ] Text via `<ThemedText type=…>`; every comparable number is a `figure`; every figure has a `label`
- [ ] Structure carried by hairlines and tone (no shadows, no card-in-card)
- [ ] Every tappable uses `pressable()`; targets ≥ 44px **in layout** (not `hitSlop` — inert on web/PWA)
- [ ] Icons from the SVG set — no emoji, no glyphs
- [ ] `accessibilityLabel` on icon-only controls and tappable rows; charts expose one atomic label; no colour-only meaning
- [ ] Safe-area respected; scroll padding clears the tab bar; no horizontal scroll at 375px
- [ ] Accueil still has exactly three blocks

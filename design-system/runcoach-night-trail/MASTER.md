# Design System Master — RunCoach « Night-Trail »

> **LOGIC:** When building a specific screen, first check `design-system/runcoach-night-trail/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. Otherwise, follow the rules below.
>
> **Source of truth in code:** [`mobile/src/constants/theme.ts`](../../mobile/src/constants/theme.ts) (tokens),
> [`mobile/src/components/themed-text.tsx`](../../mobile/src/components/themed-text.tsx) (type scale),
> project `DESIGN.md` (rationale). If this file and the code ever disagree, **the code wins** — update this file.

**Project:** RunCoach — solo AI running coach
**Platform:** React Native / Expo (installed as an iOS **PWA**). **No Tailwind, no shadcn, no CSS.** Style via `StyleSheet` + tokens.
**Theme:** **Dark only** — deliberate (read at 6am before a run), not a placeholder for a future light mode. Do not add a light theme.
**Metaphor:** night-time trail waymarking — dark ground, sienna contour hairlines, a single blaze-orange accent.

---

## Global Rules

### Color palette (from `theme.ts` — use the token, never a raw hex in a component)

| Token | Hex | Role |
|------|-----|------|
| `background` | `#14140F` | App ground (near-black, warm) |
| `backgroundElement` | `#1F2018` | Cards / surfaces (one step lighter = elevation) |
| `backgroundSelected` | `#28291F` | Selected / pressed surface |
| `text` | `#F1ECDD` | Primary text (warm off-white) |
| `textSecondary` | `#A79F8C` | Secondary text / labels (AA on both grounds ≈ 6.4–7.3:1) |
| `contour` | `#8A6F47` | Sienna hairlines, borders, icon strokes |
| `contourFaint` | `#8A6F4733` | Subtle dividers (contour @ 20%) |
| `blaze` | `#E8792C` | **THE accent** — primary CTA, active state, current week |
| `blazeDeep` | `#C05F1B` | Pressed state of blaze surfaces |
| `hydro` | `#2FA8A0` | Teal — informational (deload, "manual", easing) |
| `flare` | `#E5484D` | Danger / error only |

**One Blaze Rule:** `blaze` is the *only* saturated accent. Use it for a single primary emphasis per view (one CTA, the active tab, the current week). Everything else is ground + contour + text tones. Never introduce a second bright hue.

**Intensity thermal ramp** (training zones Z1→Z5, see `plan-format.ts`): `#6B5A3E → #8A6F47 → #B5722F → #D66A28 → #E8792C`. This ramp is the *only* place color encodes data, and it always heats *toward* blaze (never a rainbow). Always pair the color with text/shape (zone number, bolt count) — never color alone.

### Typography (from `themed-text.tsx` — use `<ThemedText type=…>`, don't hand-set sizes)

| `type` | Size / line-height / weight | Font | Use |
|--------|------------------------------|------|-----|
| `title` | 28 / 34 / 600 | system | Screen title |
| `subtitle` | 20 / 26 / 500 | system | Card / section heading, big stat value |
| `default` | 16 / 22 / 400 | system | Body |
| `link` | 16 / 22 / 600 | system | Button label |
| `small` | 13 / 18 / 400 | system | Secondary / helper |
| `waypointLabel` | 12 / 16 / mono | **IBM Plex Mono**, UPPERCASE, +letterspacing | Kickers, tags, stat labels, tab labels |

- **Body/headings = the platform system font** (project convention). The **only** custom face is IBM Plex Mono, reserved for `waypointLabel` (signage). Don't use mono for body.
- Base body is 16px (avoids iOS zoom). Don't go below 13px for meaningful text.

### Spacing (`Spacing`, 4px rhythm) & radius (`Rounded`)

`half 2 · one 4 · two 8 · three 16 · four 24 · five 32 · six 64` — cards pad `four`, list gaps `three`, inline gaps `two`.
`Rounded.sm 8` (chips, pills) · `Rounded.md 14` (cards, buttons) · `Rounded.lg 20` (avatar).
Layout: bottom scroll padding `BottomTabInset + Spacing.four`. Three width caps, one per kind of screen:
- **`MaxFormWidth 560`** — forms & dialogs (login, garmin-connect, plan-setup, add-activity, injury-report, fitness-profile, settings).
- **`MaxContentWidth 800`** — reading/list screens (activités, historique, détail de séance).
- **`MaxContentWidthWide 1000`** — dashboards (Accueil, Séances), which wrap their summary cards in `<CardColumns>`: two columns at `WideBreakpoint 720` (`useIsWide()`), stacked below.

Don't hand-roll a width check — use the hook and the component.

### Depth = tone, not shadow

**No drop shadows.** Elevation is expressed by surface lightness (`background` → `backgroundElement` → `backgroundSelected`) and `contourFaint` hairlines. Don't add `shadow*` / `elevation`.

---

## Component Specs (React Native)

- **Button** (`components/button.tsx`): `minHeight 52`, `Rounded.md`. `primary` = `blaze` bg + `background`-colored `link` label, pressed → `blazeDeep`. `ghost` = transparent + `contour` border, pressed → `backgroundElement`. Loading shows `ActivityIndicator`, disabled = `contourFaint` bg. One primary per screen; secondary actions are `ghost`.
- **Card**: `backgroundElement`, `Rounded.md`, padding `four`, gap `two`. Accent variant = left border 2px `blaze` (today) or `flare` (replan).
- **List row card** (a session in the week list): padding `three`, gap `one`, and **one line carries the whole row** — glyph + name, then its numbers pushed right. No labelled stats block: "Durée"/"Difficulté" above a duration and a bolt count cost a third of the card's height to name what already reads as itself. The breakdown belongs on the detail screen.
- **Row / list item**: hairline separators via `borderColor: contourFaint`; chevron-right icon trailing when navigable.
- **Chip / segmented** (`chip.tsx` — use the shared component, don't redefine it per screen): `minHeight 44`, `Rounded.sm`, `contour` border. **Selected = outline, not fill**: 1.5px accent border + accent text + `link` weight on `backgroundSelected`. A form shows a dozen chips at once, so filling each with `blaze` buried the primary CTA — the one blaze *fill* per screen belongs to the CTA. `tone="hydro"` marks the plan-setup "variable" day (paired with an `≈` prefix, never color alone). `disabled` = not choosable but still showing its state (the day a session already sits on); `fill` = share the row equally so a fixed set (the 7 weekdays) fits on one line.
- **Icons** (`components/icon.tsx` + `difficulty-bolts.tsx`): in-house **SVG stroke set**, `strokeWidth 1.75`, on a 24px grid (`chevron-*`, `arrow-left`, `tab-*`). Difficulty = lightning bolts, ring = `react-native-svg`. **No emoji, no icon font.** The `tab-*` glyphs come from the Night-Trail vocabulary (waypoint pin over a contour, week grid, logbook) rather than a generic icon pack.
- **Screen crest** (`screen-crest.tsx`): the signature — two contour lines bleeding off the **top-right of every screen**, behind the header, at 7–10% opacity. Drop `<ScreenCrest />` as the **first child of the screen's content column** (so it shares the alignment axis and renders under everything). Don't rebuild it per screen, don't raise the opacity, and don't put it behind data or a list. It clips its own bleed — never give it negative offsets on the parent, that adds horizontal scroll.
- **Sport identity** (`sport-icon.tsx` + `sessionTitle()` in `plan-format.ts`): every session shows a sport glyph **and** a sport-aware name — runs keep their training type (Footing, Tempo), every other sport is named by the sport (Basket, Padel, Vélo, Renforcement). Never the glyph alone. `OTHER` gets the neutral waypoint mark and keeps its type label. Use `sessionTitle()` at **every** site that names a session; don't reach for `SESSION_LABELS[type]` directly.
- **Readiness hero** (`readiness-hero.tsx`): Accueil's lead card — plain-language form verdict first, `Forme ±N · Mot` as a supporting line, today's session below a hairline as the tappable next move. The verdict comes from `formBand()` (`lib/fitness-format.ts`) — the **single** source; never restate it in another card on the same screen.
- **Load breakdown** (`week-sport-strip.tsx`): "Ta charge cette semaine" — one row per sport logged, identical `contour` bars for running and cross-training alike (the product thesis, made literal). Not a second accent, not a rainbow.
- **Card columns** (`card-columns.tsx`): the responsive wrapper described above. Distributes children by index parity; falls back to one column when there's a single card.
- **Top bar** (`top-bar.tsx`): initials avatar (→ Settings) absolutely left, wordmark centered, optional week-range subtitle.
- **Tab bar**: stroke icon + 12px label, height `62 + safe-area bottom`, active tint `blaze` **and** bold label (never tint alone — WCAG 1.4.1). Icons are decorative; the label is the accessible name. Capped at `MaxContentWidthWide` and centred, so on desktop the tabs sit on the **same axis as the content column** instead of spreading edge to edge under a centred layout; below the cap it's edge to edge as usual.

---

## Interaction & Motion (native, not web)

- **Press feedback is mandatory** on every tappable surface. Custom `Pressable`s use the shared `pressable(style)` helper (`lib/pressable.ts`) → opacity dip on press. There is **no hover** and no `cursor` on this platform — don't port web hover patterns.
- **Touch targets ≥ 44×44**; add `hitSlop={8}` to anything visually smaller (avatar, arrows, small chevrons, stepper nodes).
- Keep transitions ~150–300ms if animating; respect reduced-motion. Currently the app is mostly static — that's acceptable.

## Accessibility

- `accessibilityLabel` on every icon-only / glyph-only control and on tappable cards.
- Never encode meaning by color alone (zones = color **+** number/bolts).
- Respect the bottom safe-area inset (`SafeAreaProvider` is mounted at root); keep tap targets clear of the home indicator.

---

## Anti-Patterns (do NOT use)

- ❌ A **second bright accent** beside `blaze` (breaks the One Blaze Rule).
- ❌ **Light backgrounds / white cards** — the app is dark-only.
- ❌ **Raw hex** in components — import from `theme.ts`.
- ❌ **Drop shadows / elevation** — use surface tone + hairlines.
- ❌ **Emoji or icon fonts** as icons — use the SVG `Icon` set.
- ❌ **Tailwind / shadcn / CSS / hover / cursor** patterns — this is React Native.
- ❌ **Mono font for body** — mono is signage (`waypointLabel`) only.
- ❌ Tappable surface with **no press feedback** or **< 44px** target.

---

## Pre-Delivery Checklist (App UI — iOS PWA / RN)

- [ ] Colors come from `theme.ts` tokens; only `blaze` as accent (One Blaze Rule)
- [ ] Text via `<ThemedText type=…>`; body ≥ 13px; mono only for `waypointLabel`
- [ ] Surfaces use tone + `contourFaint` hairlines (no shadows)
- [ ] Every tappable uses `pressable()` feedback; targets ≥ 44px (`hitSlop` if smaller)
- [ ] Icons from the SVG `Icon` set / bolts / svg — no emoji, no glyphs
- [ ] `accessibilityLabel` on icon-only controls & tappable cards; no color-only meaning
- [ ] Safe-area respected; scroll padding clears the tab bar; no horizontal scroll at 375px
- [ ] One primary (`blaze`) action per screen; secondary actions are `ghost`

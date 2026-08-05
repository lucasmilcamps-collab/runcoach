/**
 * Relay design tokens — see DESIGN.md at the project root for the full system
 * ("The Load Ledger").
 *
 * Two appearances, both first-class: Graphite (soft anthracite) and Sable (very
 * light sand). Neither is a fallback for the other — the app is read at 6am in a
 * dark bedroom and again at 22h after a match, so the system's own choice is the
 * only honest default, with an explicit override in Réglages.
 *
 * Components never import a palette directly: they call `useTheme()`, which
 * resolves the active appearance. Layout stays in `StyleSheet.create`; colour
 * moves to the call site.
 */

import '@/global.css';

import { Platform } from 'react-native';

/** The size the web build treats as 1rem — the browser's own default, and the
 * base of the type scale. */
const ROOT_FONT_SIZE = 16;

/**
 * A type size that follows the reader's own text-size setting.
 *
 * The two platforms need different things and only one of them was working.
 * On native, React Native's `Text` already multiplies a point size by the OS
 * setting, so the number passes through untouched. On web it did not: this app
 * ships as an installed PWA, react-native-web compiles a numeric `fontSize`
 * straight to `px`, and px ignores the browser's text-size preference entirely
 * — so an athlete who had set larger text got the same 13px caption as everyone
 * else. Only page zoom moved it.
 *
 * react-native-web appends `px` to numbers and passes strings through as-is, so
 * emitting `rem` is what makes the web build honour the preference. The cast is
 * the cost: React Native's own style types only admit numbers, because on
 * native only numbers are valid.
 *
 * Use it for every font size and line height in the app — a raw number is a
 * size that will not grow for someone who needs it to.
 */
export function typeSize(points: number): number {
  return Platform.OS === 'web' ? (remSize(points) as unknown as number) : points;
}

/** The rem form of a point size. Split out from `typeSize` so the conversion
 * itself is testable — a wrong divisor would rescale the entire app silently. */
export function remSize(points: number): string {
  return `${points / ROOT_FONT_SIZE}rem`;
}

export type Appearance = 'graphite' | 'sable';

/**
 * Graphite — the dark appearance.
 *
 * Every text token below clears 4.5:1 on `surface`, `raised` AND `inset`, and
 * `ruleStrong` clears 3:1 on all three (WCAG 1.4.11: it carries field and
 * ghost-button borders, which are affordances rather than decoration).
 */
const graphite = {
  surface: '#16181A',
  raised: '#1D2023',
  inset: '#24282C',
  rule: '#33383E',
  ruleStrong: '#6B747D',
  ink: '#E9E7E3',
  inkMuted: '#9BA1A7',
  /** Primary button, pressed. Dimmer than the Ink fill, still legible. */
  inkPressed: '#C4C1BC',

  // --- Signal inks. One meaning each; never a button fill (DESIGN.md, The
  // Signal Is Never A Command). ---
  /** Today's key session, a completed quality session, a green light. */
  go: '#4FB286',
  /** Accumulated fatigue, surcharge risk, a downgraded session. */
  prudence: '#D9A23F',
  /** Deliberate ease: recovery days, deload weeks, rest. */
  recup: '#6E9CCB',
  /** Errors and destructive actions only — never a fourth load state. */
  alerte: '#E4776A',

  // Tinted grounds for a signal, e.g. the strip behind a surcharge verdict.
  // Explicit per appearance rather than an alpha applied at the call site, so
  // the same badge doesn't come out muddy on one ground and screaming on the
  // other.
  goWash: '#4FB2862E',
  prudenceWash: '#D9A23F2E',
  recupWash: '#6E9CCB2E',
  alerteWash: '#E4776A2E',
} as const;

/** Sable — the light appearance. Very light sand, never pure white. */
const sable = {
  surface: '#F2EEE6',
  raised: '#FBF9F5',
  inset: '#E5DFD2',
  rule: '#CBC1AC',
  ruleStrong: '#857D6C',
  ink: '#1B1D1F',
  inkMuted: '#5A5F64',
  inkPressed: '#43484D',

  go: '#23694A',
  prudence: '#7A5509',
  recup: '#2F5B87',
  alerte: '#A63C31',

  goWash: '#23694A1F',
  prudenceWash: '#7A55091F',
  recupWash: '#2F5B871F',
  alerteWash: '#A63C311F',
} as const;

/** Widened on purpose: the two palettes must be interchangeable, so the type is
 * the *shape* of a palette, not the literal hexes one of them happens to hold. */
export type Palette = { readonly [K in keyof typeof graphite]: string };
export type ThemeColor = keyof Palette;

export const Palettes: Record<Appearance, Palette> = { graphite, sable };

/**
 * The intensity ramp, Z1 → Z5. The one place colour encodes a scale rather than
 * a state, and it runs between two signals that already exist: Récup at Z1 to Go
 * at Z5. Two hues, never a rainbow, and it never passes through Prudence — a
 * hard session is not a warning (DESIGN.md).
 */
export const ZoneRamp: Record<Appearance, readonly [string, string, string, string, string]> = {
  // Interpolated in HSL between this appearance's own Récup and Go, so Z1 *is*
  // Récup and Z5 *is* Go rather than approximately them. The hand-picked ramp
  // that preceded this overshot past Go at Z5 and came back on a yellower
  // green — true enough to eyeball in Graphite, 20° off in Sable, which is the
  // kind of drift only a test catches.
  graphite: ['#6E9CCB', '#66ACC5', '#5EBCBF', '#56B9A4', '#4FB286'],
  sable: ['#2F5B87', '#2C6980', '#297678', '#267161', '#23694A'],
};

/**
 * Body text stays on the platform's own system font so Dynamic Type and native
 * conventions survive; Azeret Mono is the only project face, and it carries the
 * two jobs DESIGN.md gives it — uppercase signage labels, and tabular figures.
 */
export const Fonts = Platform.select({
  default: { mono: 'AzeretMono_500Medium' },
  web: { mono: 'var(--font-mono)' },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Moderate corners — nothing pill-shaped; the avatar is the one true circle. */
export const Rounded = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/** Tab bar height without the safe-area inset — mirrors `(tabs)/_layout`.
 * Screens shouldn't use this directly: `useTabScrollPadding()` adds the real
 * inset, which a per-platform constant can't know. */
export const TabBarHeight = 62;

/** Reading-width cap (single column) — keeps line length in HIG/Material
 * bounds on wide web/tablet. Used by list/reading screens. */
export const MaxContentWidth = 800;

/** Narrower cap for form and dialog screens (login, plan setup, add activity…).
 * A field or a full-width button stretched to 800px reads as unfinished on
 * desktop; forms want a column you can scan without moving your eyes. */
export const MaxFormWidth = 560;

/** Wider cap for ledger/dashboard screens that lay their blocks out in two
 * columns on desktop/tablet, so wide web no longer strands one narrow strip
 * flanked by dead space. */
export const MaxContentWidthWide = 1040;

/** Width at/above which a screen is treated as "wide" (tablet landscape /
 * desktop web): dashboards switch to a two-column layout. */
export const WideBreakpoint = 720;

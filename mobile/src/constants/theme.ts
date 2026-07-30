/**
 * RunCoach design tokens — see DESIGN.md at the project root for the full
 * system (Night-Trail Waymarking). Dark is the only theme: this is a project
 * convention (read at 6am before a run), not a placeholder for a future toggle.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  background: '#14140F',
  backgroundElement: '#1F2018',
  backgroundSelected: '#28291F',
  text: '#F1ECDD',
  textSecondary: '#A79F8C',
  contour: '#8A6F47',
  contourFaint: '#8A6F4733',
  blaze: '#E8792C',
  blazeDeep: '#C05F1B',
  hydro: '#2FA8A0',
  // Lightened from #E5484D, which only cleared AA on the base ground (4.72:1)
  // and failed on every card (4.20:1) and selected surface (3.76:1) — where
  // error text actually lives. This value mirrors blaze's contrast almost
  // exactly on all three grounds (6.34 / 5.63 / 5.05), so the two semantic
  // accents now carry the same perceptual weight.
  flare: '#F26D71',
} as const;

export type ThemeColor = keyof typeof Colors;

/** Body text always stays on the platform's own system font (DESIGN.md); only
 * the mono signage face is a project token. */
export const Fonts = Platform.select({
  default: { mono: 'IBMPlexMono_500Medium' },
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

export const Rounded = {
  sm: 8,
  md: 14,
  lg: 20,
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

/** Wider cap for dashboard screens that lay their cards out in two columns on
 * desktop/tablet (see `CardColumns`), so wide web no longer strands one narrow
 * strip flanked by dead space. */
export const MaxContentWidthWide = 1000;

/** Width at/above which a screen is treated as "wide" (tablet landscape /
 * desktop web): dashboards switch to a two-column card layout. */
export const WideBreakpoint = 720;

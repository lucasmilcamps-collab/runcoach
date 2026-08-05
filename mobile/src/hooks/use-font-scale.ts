import { PixelRatio, Platform, useWindowDimensions } from 'react-native';

/** The size the web build treats as 1rem — mirrors `typeSize` in `theme.ts`. */
const ROOT_FONT_SIZE = 16;

/**
 * How much bigger the reader has asked their text to be, as a multiplier.
 *
 * Text itself needs no help — the OS scales it on native, and `typeSize`'s rem
 * values do it on web. This is for the handful of *layout* values that hold
 * text and would otherwise clip it: the ledger's seven day-columns, the tab
 * bar's height. A `44` that stays `44` while the label inside it doubles is a
 * clipped label.
 *
 * `useWindowDimensions` is called for its subscription, not its value: a
 * browser zoom arrives as a resize, and that is when the root size moves. The
 * reading itself is taken fresh each render rather than memoised, so it can
 * never be a stale cache React decided to drop.
 */
export function useFontScale(): number {
  useWindowDimensions();

  if (Platform.OS !== 'web') return PixelRatio.getFontScale();
  if (typeof document === 'undefined') return 1;

  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? root / ROOT_FONT_SIZE : 1;
}

/**
 * The same multiplier, clamped — for chrome that must grow with the text but
 * cannot grow without limit.
 *
 * The tab bar is the case this exists for: it is the app's navigation, it is
 * pinned to the bottom of every screen, and at 3× an unclamped bar would take
 * a third of a phone. Platforms make the same trade — iOS tab bars stop
 * growing and offer the large-content viewer instead.
 */
export function useClampedFontScale(max = 1.6): number {
  return Math.min(Math.max(useFontScale(), 1), max);
}

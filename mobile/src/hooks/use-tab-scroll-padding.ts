import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useClampedFontScale } from '@/hooks/use-font-scale';

import { Spacing, TabBarHeight } from '@/constants/theme';

/**
 * Bottom padding a tab screen's scroll content needs so its last card clears
 * the tab bar.
 *
 * Replaces a `Platform.select({ ios, android })` constant that had no `web`
 * key and so resolved to 0 on the installed PWA — the tab bar is drawn over
 * the content, so the last 52pt of every tab screen sat underneath it. Reading
 * the real safe-area inset also makes this correct on a notched phone instead
 * of a guessed-per-platform number.
 */
export function useTabScrollPadding(): number {
  const insets = useSafeAreaInsets();
  // Same multiplier the bar itself uses: if the two drift apart, the last row
  // of every tab screen ends up underneath the bar at large text sizes.
  const fontScale = useClampedFontScale();
  return TabBarHeight * fontScale + insets.bottom + Spacing.four;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  return TabBarHeight + insets.bottom + Spacing.four;
}

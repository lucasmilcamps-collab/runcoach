import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';

/** Avatar diameter — also drives the top bar's row height. */
export const AVATAR = 52;
import { getMe, initialsFromEmail } from '@/lib/api/auth';
import { pressable } from '@/lib/pressable';

/**
 * Round initials button (top-left of the main screens) that opens Settings —
 * the Campus-style entry point that replaces the Réglages tab.
 */
export function AvatarButton() {
  const { data } = useQuery({ queryKey: ['me'], queryFn: getMe, staleTime: Infinity });
  // No placeholder glyph while /me loads: a lone '·' reads as a broken
  // avatar. The empty ring is a calmer, honest loading state.
  const initials = initialsFromEmail(data?.email);

  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Réglages"
      style={pressable(styles.avatar)}>
      <ThemedText type="waypointLabel" themeColor="text" style={styles.initials}>
        {initials}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    // Well past the 44pt minimum: this is the only way into Settings, and at
    // 44 it read as an afterthought beside the wordmark. Circular, not the
    // Rounded.lg squircle, which stops looking round as the box grows.
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1,
    borderColor: Colors.contour,
    backgroundColor: Colors.backgroundElement,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 15,
    letterSpacing: 0.5,
  },
});

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded } from '@/constants/theme';
import { getMe, initialsFromEmail } from '@/lib/api/auth';
import { pressable } from '@/lib/pressable';

/**
 * Round initials button (top-left of the main screens) that opens Settings —
 * the Campus-style entry point that replaces the Réglages tab.
 */
export function AvatarButton() {
  const { data } = useQuery({ queryKey: ['me'], queryFn: getMe, staleTime: Infinity });
  const initials = initialsFromEmail(data?.email) || '·';

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
    // 44pt, not 40 + hitSlop: hitSlop is inert on react-native-web (PWA).
    width: 44,
    height: 44,
    borderRadius: Rounded.lg,
    borderWidth: 1,
    borderColor: Colors.contour,
    backgroundColor: Colors.backgroundElement,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 13,
    letterSpacing: 0.5,
  },
});

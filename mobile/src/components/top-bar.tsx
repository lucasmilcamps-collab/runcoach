import { StyleSheet, View } from 'react-native';

import { AvatarButton } from '@/components/avatar-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * Campus-style header: initials avatar on the left (→ Settings), a centered
 * wordmark, and an optional subtitle line (e.g. the current week range).
 * The avatar is absolutely positioned so the wordmark stays truly centered.
 */
export function TopBar({ title = 'RUNCOACH', subtitle }: { title?: string; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.left}>
          <AvatarButton />
        </View>
        <ThemedText type="waypointLabel" themeColor="text" style={styles.title}>
          {title}
        </ThemedText>
      </View>
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  row: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  left: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  title: {
    fontSize: 15,
    letterSpacing: 1.5,
  },
  subtitle: {
    textAlign: 'center',
  },
});

import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopoGlyph } from '@/components/topo-glyph';
import { Spacing } from '@/constants/theme';

/**
 * A trailhead sign for empty screens: the topographic glyph, a title, a line of
 * why-it-matters, and the single next action. Deliberately not a bordered card —
 * it's centered signage on the ground, the app's invitation to the first step.
 */
export function EmptyState({
  title,
  description,
  pin,
  children,
}: {
  title: string;
  description: string;
  pin?: 'summit' | 'edge';
  children?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <TopoGlyph size={96} pin={pin} />
      <View style={styles.text}>
        <ThemedText type="subtitle" style={styles.center}>
          {title}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          {description}
        </ThemedText>
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.five,
  },
  text: {
    gap: Spacing.two,
    maxWidth: 360,
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    maxWidth: 360,
    gap: Spacing.two,
  },
});

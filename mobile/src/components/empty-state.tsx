import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { LedgerGlyph } from '@/components/ledger-glyph';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * What an empty screen says: the shape it will take once there is something in
 * it, a title, a line of why-it-matters, and the single next action.
 *
 * Deliberately not a bordered card — nothing is contained here yet, so a box
 * around the invitation would be a container drawn around an absence.
 */
export function EmptyState({
  title,
  description,
  variant,
  children,
}: {
  title: string;
  description: string;
  variant?: 'ledger' | 'handover';
  children?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <LedgerGlyph size={104} variant={variant} />
      <View style={styles.text}>
        <ThemedText type="subtitle" style={styles.center}>
          {title}
        </ThemedText>
        <ThemedText type="default" themeColor="inkMuted" style={styles.center}>
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
    maxWidth: 380,
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    maxWidth: 380,
    gap: Spacing.two,
  },
});

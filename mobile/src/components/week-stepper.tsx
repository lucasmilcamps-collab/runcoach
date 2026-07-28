import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';

/** Horizontal week tracker (Campus "Programme en cours"): past weeks filled,
 * the current one highlighted, future ones faint. Tapping a node calls onPick. */
export function WeekStepper({
  weeksTotal,
  weekCurrent,
  onPick,
}: {
  weeksTotal: number;
  weekCurrent: number | null;
  onPick?: (weekIndex: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const weeks = Array.from({ length: weeksTotal }, (_, i) => i + 1);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.track}>
      {weeks.map((w, i) => {
        const state = weekCurrent == null ? 'todo' : w < weekCurrent ? 'done' : w === weekCurrent ? 'current' : 'todo';
        return (
          <View key={w} style={styles.item}>
            {i > 0 ? (
              <View
                style={[styles.connector, (state === 'done' || state === 'current') && styles.connectorDone]}
              />
            ) : null}
            <Pressable
              onPress={() => onPick?.(w)}
              accessibilityRole="button"
              accessibilityLabel={`Semaine ${w}`}
              hitSlop={8}
              style={pressable([
                styles.node,
                state === 'done' && styles.nodeDone,
                state === 'current' && styles.nodeCurrent,
              ])}>
              <ThemedText
                type="waypointLabel"
                themeColor={state === 'todo' ? 'textSecondary' : 'background'}
                style={styles.nodeLabel}>
                {w}
              </ThemedText>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const NODE = 28;

const styles = StyleSheet.create({
  track: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connector: {
    width: Spacing.four,
    height: 2,
    backgroundColor: Colors.contourFaint,
  },
  connectorDone: {
    backgroundColor: Colors.blaze,
  },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 1,
    borderColor: Colors.contour,
    backgroundColor: Colors.backgroundElement,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDone: {
    backgroundColor: Colors.contour,
    borderColor: Colors.contour,
  },
  nodeCurrent: {
    backgroundColor: Colors.blaze,
    borderColor: Colors.blaze,
  },
  nodeLabel: {
    fontSize: 11,
  },
});

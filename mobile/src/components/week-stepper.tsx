import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useIsWide } from '@/hooks/use-breakpoint';
import { pressable } from '@/lib/pressable';

/** Horizontal week tracker (Campus "Programme en cours"): past weeks filled,
 * the current one highlighted, future ones faint. Tapping a node calls onPick.
 *
 * On a wide viewport the trail stretches to fill its container (the connectors
 * flex), so it reads as one continuous path across the dashboard instead of a
 * short scrollable stub with the last week clipped off. On phones it stays a
 * horizontal scroller, which is the only way a 12-week plan fits. */
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
  const wide = useIsWide();
  const weeks = Array.from({ length: weeksTotal }, (_, i) => i + 1);

  const nodes = (
    <>
      {weeks.map((w, i) => {
        const state = weekCurrent == null ? 'todo' : w < weekCurrent ? 'done' : w === weekCurrent ? 'current' : 'todo';
        return (
          // Only the items that carry a connector may flex: week 1 has none, so
          // letting it take an equal share would push the first gap wider than
          // all the others and break the trail's rhythm.
          <View key={w} style={[styles.item, wide && i > 0 && styles.itemWide]}>
            {i > 0 ? (
              <View
                style={[
                  styles.connector,
                  wide && styles.connectorWide,
                  (state === 'done' || state === 'current') && styles.connectorDone,
                ]}
              />
            ) : null}
            <Pressable
              onPress={() => onPick?.(w)}
              accessibilityRole="button"
              accessibilityLabel={`Semaine ${w}${
                state === 'current' ? ', en cours' : state === 'done' ? ', terminée' : ''
              }`}
              accessibilityState={{ selected: state === 'current' }}
              style={pressable(styles.nodeTouch)}>
              {/* The dot stays 28pt; the 44pt target is the transparent frame
                  around it. hitSlop would have been the lighter fix, but it
                  does nothing on react-native-web and this app ships as an
                  installed PWA. */}
              <View
                style={[
                  styles.node,
                  state === 'done' && styles.nodeDone,
                  state === 'current' && styles.nodeCurrent,
                ]}>
                <ThemedText
                  type="waypointLabel"
                  themeColor={state === 'todo' ? 'textSecondary' : 'background'}>
                  {w}
                </ThemedText>
              </View>
            </Pressable>
          </View>
        );
      })}
    </>
  );

  if (wide) return <View style={styles.trackWide}>{nodes}</View>;

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.track}>
      {nodes}
    </ScrollView>
  );
}

const NODE = 28;
// Minimum comfortable target — the dot is smaller, the touch frame is not.
const TOUCH = 44;

const styles = StyleSheet.create({
  track: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  trackWide: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemWide: {
    // Each week takes an equal share of the row, so the trail spans the full
    // dashboard width instead of clipping its last node.
    flex: 1,
  },
  connector: {
    width: Spacing.four,
    height: 2,
    backgroundColor: Colors.contourFaint,
  },
  connectorWide: {
    flex: 1,
    width: undefined,
  },
  connectorDone: {
    // Completed path reads in parchment-muted, not blaze — blaze is reserved
    // for the single current-week marker (the One Blaze Rule).
    backgroundColor: Colors.textSecondary,
  },
  nodeTouch: {
    width: TOUCH,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
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
    // Parchment-muted fill (per DESIGN.md) — also lifts the dark node number to
    // ~7:1 contrast, where the previous contour fill sat at a failing 3.9:1.
    backgroundColor: Colors.textSecondary,
    borderColor: Colors.textSecondary,
  },
  nodeCurrent: {
    backgroundColor: Colors.blaze,
    borderColor: Colors.blaze,
  },
});

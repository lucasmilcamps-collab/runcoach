import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { WeekProgress } from '@/lib/week-progress';

/** Campus-style progress header: Activités done/target · a km ring · Semaines
 * current/total. Uses the plan's realized-vs-planned week data. */
export function WeekProgressCard({
  progress,
  weekCurrent,
  weeksTotal,
}: {
  progress: WeekProgress;
  weekCurrent: number | null;
  weeksTotal: number | null;
}) {
  // The current plan week can carry no distance target (sessions without a
  // pace range → estimateDistanceKm returns 0). A km ring would then read
  // "0 / 0 km" and never fill. Track what we actually have a goal for instead:
  // km when there's a km target, else session completion, else — no plan target
  // at all — just the realized volume as a summary (never a 0/0 goal).
  const hasKmTarget = progress.target.km > 0;
  const hasSessionTarget = progress.target.count > 0;

  let leftLabel: string;
  let leftValue: string;
  let ringTop: string;
  let ringBottom: string;
  let fraction: number;

  if (hasKmTarget) {
    leftLabel = 'Activités';
    leftValue = `${progress.done.count}/${progress.target.count}`;
    ringTop = frNumber(progress.done.km);
    ringBottom = `/ ${frNumber(progress.target.km)} km`;
    fraction = progress.done.km / progress.target.km;
  } else if (hasSessionTarget) {
    // Move realized distance to the left stat so the ring's session count isn't
    // duplicated by the "Activités" stat.
    leftLabel = 'Distance';
    leftValue = `${frNumber(progress.done.km)} km`;
    ringTop = `${progress.done.count}`;
    ringBottom = `/ ${progress.target.count} séances`;
    fraction = progress.done.count / progress.target.count;
  } else {
    leftLabel = 'Activités';
    leftValue = `${progress.done.count}`;
    ringTop = frNumber(progress.done.km);
    ringBottom = 'km cette semaine';
    fraction = 0;
  }

  return (
    <View style={styles.card}>
      <Stat label={leftLabel} value={leftValue} />
      <Ring fraction={fraction} top={ringTop} bottom={ringBottom} />
      <Stat
        label="Semaines"
        value={weekCurrent != null && weeksTotal != null ? `${weekCurrent}/${weeksTotal}` : '—'}
        align="flex-end"
      />
    </View>
  );
}

function frNumber(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ',');
}

function Stat({
  label,
  value,
  align = 'flex-start',
}: {
  label: string;
  value: string;
  align?: 'flex-start' | 'flex-end';
}) {
  return (
    <View style={[styles.stat, { alignItems: align }]}>
      <ThemedText type="subtitle">{value}</ThemedText>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function Ring({ fraction, top, bottom }: { fraction: number; top: string; bottom: string }) {
  const size = 116;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = c * (1 - clamped);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={Colors.contourFaint}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={Colors.blaze}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <ThemedText type="title">{top}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {bottom}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
    gap: Spacing.half,
  },
  ringCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

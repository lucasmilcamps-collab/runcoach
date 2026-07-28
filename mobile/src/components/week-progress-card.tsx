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
  const fraction = progress.target.km > 0 ? progress.done.km / progress.target.km : 0;

  return (
    <View style={styles.card}>
      <Stat label="Activités" value={`${progress.done.count}/${progress.target.count}`} />
      <Ring
        fraction={fraction}
        top={frNumber(progress.done.km)}
        bottom={`/ ${frNumber(progress.target.km)} km`}
      />
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

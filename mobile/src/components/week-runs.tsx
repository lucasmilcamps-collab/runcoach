import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { PlanSession, PlanWeek } from '@/lib/api/plans';
import {
  DAY_LABELS,
  estimateDistanceKm,
  formatDuration,
  frKm,
  sessionTitle,
  sortSessionsByDay,
} from '@/lib/plan-format';
import { pressable } from '@/lib/pressable';

/**
 * The week's runs, listed under the week trail on Accueil.
 *
 * The trail said *where* you are in the plan and the hero said what to do
 * today; between the two, "what does this week actually ask of me?" had no
 * answer short of opening Séances. Three lines settle it.
 *
 * **Runs only.** Elsewhere the app is emphatic that cross-training is load and
 * belongs beside running — that's what "Ta charge cette semaine" is for. This
 * list answers a narrower question, the one a running plan is built around, and
 * mixing padel into it would blur both. The two live side by side saying
 * different things.
 */
export function WeekRuns({ week }: { week: PlanWeek }) {
  // Numbering counts through every session of the week, not just the runs, so a
  // row that opens as "Séance 3/4" says the same thing here as on Séances.
  const ordered = sortSessionsByDay(week.sessions);
  const total = ordered.filter((s) => s.type !== 'rest' && s.slot === 'primary').length;
  let counter = 0;
  const runs = ordered.flatMap((session) => {
    const isPrimary = session.type !== 'rest' && session.slot === 'primary';
    const position = isPrimary ? (counter += 1) : 0;
    const isRun = session.sport === 'RUN' && session.type !== 'rest';
    return isRun ? [{ session, position }] : [];
  });

  if (runs.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Tes runs cette semaine
        </ThemedText>
        {/* A deload week looks like a bad week without this — fewer, shorter
            runs, and no way to tell "planned recovery" from "falling behind". */}
        {week.is_deload ? (
          <View style={styles.deload}>
            <ThemedText type="waypointLabel" themeColor="textSecondary">
              Décharge
            </ThemedText>
          </View>
        ) : null}
      </View>
      {runs.map(({ session, position }, index) => (
        <RunRow
          key={`${session.day}-${session.slot}-${index}`}
          session={session}
          weekNumber={week.index}
          position={position}
          total={total}
        />
      ))}
    </View>
  );
}

function RunRow({
  session,
  weekNumber,
  position,
  total,
}: {
  session: PlanSession;
  weekNumber: number;
  position: number;
  total: number;
}) {
  const distanceKm = estimateDistanceKm(session.duration_min, session.pace_range);
  // Plans are prescribed in minutes; the distance is an estimate off the target
  // pace, so it only shows when there is a pace to derive it from.
  const meta =
    distanceKm != null
      ? `${formatDuration(session.duration_min)} · ${frKm(distanceKm)} km`
      : formatDuration(session.duration_min);

  function open() {
    router.push({
      pathname: '/session-detail',
      params: {
        s: JSON.stringify({
          session,
          weekNumber,
          position,
          total,
          isKey: session.priority === 'key',
        }),
      },
    });
  }

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${DAY_LABELS[session.day]}, ${sessionTitle(session)}, ${meta}${
        session.skipped ? ', sautée' : ''
      }`}
      style={pressable([styles.row, session.skipped && styles.rowSkipped])}>
      <ThemedText type="waypointLabel" themeColor="textSecondary" style={styles.day}>
        {DAY_LABELS[session.day]}
      </ThemedText>
      <ThemedText type="default" style={styles.name} numberOfLines={1}>
        {sessionTitle(session)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {meta}
      </ThemedText>
      <Icon name="chevron-right" size={20} color={Colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  deload: {
    backgroundColor: Colors.contourFaint,
    borderRadius: Rounded.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  rowSkipped: { opacity: 0.55 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    // 44pt for real — hitSlop doesn't apply on web, and this ships as a PWA.
    minHeight: 44,
    // Rule on top of each row, never below: it separates the header from the
    // first run and each run from the next, and the card's own edge closes the
    // list without a trailing line hanging under it.
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  day: {
    width: 32,
  },
  name: {
    flex: 1,
  },
});

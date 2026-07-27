import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { Plan, PlanSession, PlanWeek } from '@/lib/api/plans';
import { DAY_LABELS, PHASE_LABELS, SESSION_LABELS, formatDuration } from '@/lib/plan-format';

const KEY_TYPES = new Set<PlanSession['type']>(['tempo', 'threshold', 'intervals', 'long_run']);

/** Read-only rendering of a plan (goal + phases → weeks → expandable sessions).
 * Shared by the Plan tab and the version-history detail screen. */
export function PlanView({ plan }: { plan: Plan }) {
  return (
    <View style={styles.planBody}>
      <View style={styles.card}>
        <ThemedText type="subtitle">{plan.goal.description}</ThemedText>
        {plan.goal.race_date ? (
          <ThemedText type="small" themeColor="textSecondary">
            Objectif le {plan.goal.race_date}
          </ThemedText>
        ) : null}
      </View>

      {plan.phases.map((phase, pi) => (
        <View key={`${phase.name}-${pi}`} style={styles.phase}>
          <ThemedText type="waypointLabel" themeColor="blaze">
            {PHASE_LABELS[phase.name]}
          </ThemedText>
          {phase.weeks.map((week) => (
            <WeekCard key={week.index} week={week} />
          ))}
        </View>
      ))}
    </View>
  );
}

function WeekCard({ week }: { week: PlanWeek }) {
  const total = week.sessions.filter((s) => s.type !== 'rest').length;
  let counter = 0;
  return (
    <View style={styles.card}>
      <View style={styles.weekHeader}>
        <ThemedText type="default">Semaine {week.index}</ThemedText>
        {week.is_deload ? (
          <ThemedText type="waypointLabel" themeColor="hydro">
            Deload
          </ThemedText>
        ) : (
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Charge {Math.round(week.target_load)}
          </ThemedText>
        )}
      </View>
      {week.sessions.map((session, si) => {
        const position = session.type !== 'rest' ? (counter += 1) : 0;
        return (
          <SessionRow
            key={si}
            session={session}
            weekNumber={week.index}
            position={position}
            total={total}
          />
        );
      })}
    </View>
  );
}

function SessionRow({
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
  const navigable = session.type !== 'rest';
  const isKey = KEY_TYPES.has(session.type);

  function open() {
    if (!navigable) return;
    router.push({
      pathname: '/session-detail',
      params: { s: JSON.stringify({ session, weekNumber, position, total, isKey }) },
    });
  }

  return (
    <Pressable
      style={styles.sessionRow}
      disabled={!navigable}
      onPress={open}
      accessibilityRole={navigable ? 'button' : undefined}>
      <ThemedText type="waypointLabel" themeColor="textSecondary" style={styles.sessionDay}>
        {DAY_LABELS[session.day]}
      </ThemedText>
      <View style={styles.sessionMain}>
        <View style={styles.sessionTitleRow}>
          <View style={styles.sessionTitleLeft}>
            <ThemedText type="default">
              {SESSION_LABELS[session.type]}
              {navigable ? '  ›' : ''}
            </ThemedText>
            {isKey ? (
              <ThemedText type="waypointLabel" themeColor="blaze">
                Clé
              </ThemedText>
            ) : null}
          </View>
          {navigable ? (
            <ThemedText type="waypointLabel" themeColor="textSecondary">
              {formatDuration(session.duration_min)}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {session.rationale}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  planBody: { gap: Spacing.four },
  phase: { gap: Spacing.two },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  sessionRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  sessionDay: { width: 32, paddingTop: Spacing.half },
  sessionMain: { flex: 1, gap: Spacing.half },
  sessionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});

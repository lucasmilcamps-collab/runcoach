import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { Plan, PlanSession, PlanWeek } from '@/lib/api/plans';
import { DAY_LABELS, PHASE_LABELS, SESSION_LABELS, formatDuration } from '@/lib/plan-format';

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
      {week.sessions.map((session, si) => (
        <SessionRow key={si} session={session} />
      ))}
    </View>
  );
}

function SessionRow({ session }: { session: PlanSession }) {
  const [open, setOpen] = useState(false);
  const hasDetail =
    session.structure.length > 0 || session.pace_range !== null || session.hr_zone !== null;

  return (
    <View style={styles.sessionRow}>
      <ThemedText type="waypointLabel" themeColor="textSecondary" style={styles.sessionDay}>
        {DAY_LABELS[session.day]}
      </ThemedText>
      <Pressable
        style={styles.sessionMain}
        disabled={!hasDetail}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole={hasDetail ? 'button' : undefined}>
        <View style={styles.sessionTitleRow}>
          <ThemedText type="default">
            {SESSION_LABELS[session.type]}
            {hasDetail ? (open ? '  ▾' : '  ▸') : ''}
          </ThemedText>
          {session.type !== 'rest' ? (
            <ThemedText type="waypointLabel" themeColor="textSecondary">
              {formatDuration(session.duration_min)}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {session.rationale}
        </ThemedText>

        {open ? (
          <View style={styles.sessionDetail}>
            {session.structure.map((block, bi) => (
              <View key={bi} style={styles.blockRow}>
                <ThemedText type="small">{block.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDuration(block.duration_min)}
                </ThemedText>
              </View>
            ))}
            {session.pace_range ? (
              <ThemedText type="small" themeColor="textSecondary">
                Allure {session.pace_range.min_per_km_low}–{session.pace_range.min_per_km_high} /km
              </ThemedText>
            ) : null}
            {session.hr_zone ? (
              <ThemedText type="small" themeColor="textSecondary">
                Zone cardiaque {session.hr_zone}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </View>
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
  sessionDetail: {
    gap: Spacing.half,
    paddingTop: Spacing.two,
    marginTop: Spacing.one,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  blockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

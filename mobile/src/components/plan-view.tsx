import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { Plan, PlanPhase, PlanSession, PlanWeek } from '@/lib/api/plans';
import { DAY_LABELS, PHASE_LABELS, SESSION_LABELS, formatDuration } from '@/lib/plan-format';

const KEY_TYPES = new Set<PlanSession['type']>(['tempo', 'threshold', 'intervals', 'long_run']);

type FlatWeek = { week: PlanWeek; phase: PlanPhase['name'] };

/** All weeks across phases, in calendar order, each tagged with its phase. */
function flattenWeeks(plan: Plan): FlatWeek[] {
  const out: FlatWeek[] = [];
  for (const phase of plan.phases) {
    for (const week of phase.weeks) out.push({ week, phase: phase.name });
  }
  return out.sort((a, b) => a.week.index - b.week.index);
}

/** Read-only rendering of a full plan (goal + phases → weeks → sessions), all
 * weeks stacked. Used by the version-history detail screen. */
export function PlanView({ plan }: { plan: Plan }) {
  return (
    <View style={styles.planBody}>
      <GoalCard plan={plan} />

      {plan.phases.map((phase, pi) => (
        <View key={`${phase.name}-${pi}`} style={styles.phase}>
          <ThemedText type="waypointLabel" themeColor="blaze">
            {PHASE_LABELS[phase.name]}
          </ThemedText>
          {phase.weeks.map((week) => (
            <View key={week.index} style={styles.card}>
              <View style={styles.weekHeader}>
                <ThemedText type="default">Semaine {week.index}</ThemedText>
                <WeekLoad week={week} />
              </View>
              <WeekSessions week={week} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** One week at a time, opened on the real current week (from plan progress),
 * with ‹ › navigation across the whole plan. Used by the Plan tab. */
export function PlanWeekPager({ plan, currentWeek }: { plan: Plan; currentWeek: number | null }) {
  const weeks = useMemo(() => flattenWeeks(plan), [plan]);
  const [selected, setSelected] = useState(0);

  // Jump to the real current week once progress resolves (and whenever the plan
  // changes). currentWeek is stable after load, so manual navigation sticks.
  useEffect(() => {
    const idx = weeks.findIndex((w) => w.week.index === currentWeek);
    setSelected(idx >= 0 ? idx : 0);
  }, [currentWeek, weeks]);

  if (weeks.length === 0) return null;
  const clamped = Math.min(Math.max(selected, 0), weeks.length - 1);
  const { week, phase } = weeks[clamped];
  const isCurrent = week.index === currentWeek;
  const atFirst = clamped === 0;
  const atLast = clamped === weeks.length - 1;

  return (
    <View style={styles.planBody}>
      <GoalCard plan={plan} />

      <View style={styles.pager}>
        <NavArrow dir="prev" disabled={atFirst} onPress={() => setSelected(clamped - 1)} />
        <View style={styles.pagerCenter}>
          <ThemedText type="waypointLabel" themeColor="blaze">
            {PHASE_LABELS[phase]}
          </ThemedText>
          <ThemedText type="subtitle">
            Semaine {week.index} <ThemedText themeColor="textSecondary">/ {weeks.length}</ThemedText>
          </ThemedText>
          <View style={styles.pagerMeta}>
            {isCurrent ? (
              <View style={styles.currentTag}>
                <View style={styles.currentDot} />
                <ThemedText type="waypointLabel" themeColor="blaze">
                  En cours
                </ThemedText>
              </View>
            ) : null}
            <WeekLoad week={week} />
          </View>
        </View>
        <NavArrow dir="next" disabled={atLast} onPress={() => setSelected(clamped + 1)} />
      </View>

      <View style={styles.card}>
        <WeekSessions week={week} />
      </View>
    </View>
  );
}

function GoalCard({ plan }: { plan: Plan }) {
  return (
    <View style={styles.card}>
      <ThemedText type="subtitle">{plan.goal.description}</ThemedText>
      {plan.goal.race_date ? (
        <ThemedText type="small" themeColor="textSecondary">
          Objectif le {plan.goal.race_date}
        </ThemedText>
      ) : null}
    </View>
  );
}

function WeekLoad({ week }: { week: PlanWeek }) {
  return week.is_deload ? (
    <ThemedText type="waypointLabel" themeColor="hydro">
      Deload
    </ThemedText>
  ) : (
    <ThemedText type="waypointLabel" themeColor="textSecondary">
      Charge {Math.round(week.target_load)}
    </ThemedText>
  );
}

function NavArrow({
  dir,
  disabled,
  onPress,
}: {
  dir: 'prev' | 'next';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={dir === 'prev' ? 'Semaine précédente' : 'Semaine suivante'}
      hitSlop={8}
      style={[styles.navArrow, disabled && styles.navArrowDisabled]}>
      <ThemedText type="subtitle" themeColor={disabled ? 'textSecondary' : 'text'}>
        {dir === 'prev' ? '‹' : '›'}
      </ThemedText>
    </Pressable>
  );
}

function WeekSessions({ week }: { week: PlanWeek }) {
  const total = week.sessions.filter((s) => s.type !== 'rest').length;
  let counter = 0;
  return (
    <>
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
    </>
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

  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  pagerCenter: { flex: 1, alignItems: 'center', gap: Spacing.half },
  pagerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.half,
  },
  currentTag: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  currentDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.blaze },
  navArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.contour,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowDisabled: { borderColor: Colors.contourFaint, opacity: 0.5 },

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

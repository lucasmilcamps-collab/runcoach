import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DifficultyBolts } from '@/components/difficulty-bolts';
import { Icon } from '@/components/icon';
import { SportIcon } from '@/components/sport-icon';
import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import type { Plan, PlanPhase, PlanSession, PlanWeek } from '@/lib/api/plans';
import {
  DAY_LABELS,
  PHASE_LABELS,
  estimateDistanceKm,
  formatDuration,
  sessionDifficulty,
  sessionTitle,
  sortSessionsByDay,
} from '@/lib/plan-format';

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
            <View key={week.index} style={styles.weekBlock}>
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
 * with ‹ › navigation across the whole plan. Used by the Séances tab. */
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

      <WeekSessions week={week} />
    </View>
  );
}

function GoalCard({ plan }: { plan: Plan }) {
  return (
    <View style={styles.goalCard}>
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
      style={pressable([styles.navArrow, disabled && styles.navArrowDisabled])}>
      <Icon
        name={dir === 'prev' ? 'chevron-left' : 'chevron-right'}
        size={24}
        color={disabled ? Colors.textSecondary : Colors.text}
      />
    </Pressable>
  );
}

function WeekSessions({ week }: { week: PlanWeek }) {
  // The generator doesn't emit sessions in calendar order, so sort before
  // rendering — this also makes "Séance n/N" count through the week in order.
  const ordered = sortSessionsByDay(week.sessions);
  // Addons (e.g. a strength block) share a day and aren't numbered as sessions.
  const total = ordered.filter((s) => s.type !== 'rest' && s.slot === 'primary').length;
  let counter = 0;
  return (
    <View style={styles.sessionList}>
      {ordered.map((session, si) => {
        const isPrimary = session.type !== 'rest' && session.slot === 'primary';
        const position = isPrimary ? (counter += 1) : 0;
        return (
          <SessionCard
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

function frKm(km: number): string {
  return km.toFixed(1).replace('.', ',');
}

function SessionCard({
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
  const isKey = session.priority === 'key';
  const isAddon = session.slot === 'addon';

  if (session.type === 'rest') {
    return (
      <View style={styles.restCard}>
        <ThemedText type="waypointLabel" themeColor="textSecondary" style={styles.restDay}>
          {DAY_LABELS[session.day]}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          Repos
        </ThemedText>
      </View>
    );
  }

  const distanceKm = estimateDistanceKm(session.duration_min, session.pace_range);
  const difficulty = sessionDifficulty(session.type);
  const meta =
    distanceKm != null
      ? `${formatDuration(session.duration_min)} · ${frKm(distanceKm)} km`
      : formatDuration(session.duration_min);

  function open() {
    router.push({
      pathname: '/session-detail',
      params: { s: JSON.stringify({ session, weekNumber, position, total, isKey }) },
    });
  }

  return (
    <Pressable
      style={pressable(styles.sessionCard)}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${sessionTitle(session)}, ${meta}, séance ${position} sur ${total}`}>
      <View style={styles.sessionHead}>
        <View style={styles.sessionHeadLeft}>
          {isKey && !isAddon ? (
            <View style={styles.keyPill}>
              <ThemedText type="waypointLabel" themeColor="blaze">
                Clé
              </ThemedText>
            </View>
          ) : null}
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {DAY_LABELS[session.day]}
            {isAddon ? ' · Complément' : ` · Séance ${position}/${total}`}
          </ThemedText>
        </View>
        <Icon name="chevron-right" size={20} color={Colors.textSecondary} />
      </View>

      {/* One line carries the whole session: glyph + sport-aware name (the two
          cues that let a week be scanned for "which of these are runs?"), then
          its numbers. A labelled stats block underneath cost a third of the
          card's height to say "Durée" and "Difficulté" above values that
          already read as a duration and an intensity — the card is a list row,
          the detail screen is where the breakdown belongs. */}
      <View style={styles.sessionTitleRow}>
        <SportIcon sport={session.sport} size={20} />
        <ThemedText type="link" numberOfLines={1} style={styles.sessionName}>
          {sessionTitle(session)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {meta}
        </ThemedText>
        <DifficultyBolts level={difficulty} />
      </View>

      {session.rationale ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {session.rationale}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  planBody: { gap: Spacing.four },
  phase: { gap: Spacing.two },
  weekBlock: { gap: Spacing.two },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  goalCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.two,
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

  sessionList: { gap: Spacing.two },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  // Takes the leftover width so the numbers stay pinned right and a long name
  // truncates instead of pushing them off the row.
  sessionName: { flex: 1 },
  sessionCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  sessionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  keyPill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: '#E8792C66',
    backgroundColor: '#E8792C1f',
  },

  restCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Rounded.md,
    borderWidth: 1,
    borderColor: Colors.contourFaint,
  },
  restDay: { width: 32 },
});

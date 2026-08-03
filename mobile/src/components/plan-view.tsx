import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icon';
import { IntensityNotch } from '@/components/intensity-notch';
import { SportIcon } from '@/components/sport-icon';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pressable } from '@/lib/pressable';
import { makeStyles } from '@/lib/themed-styles';
import type { Plan, PlanPhase, PlanSession, PlanWeek } from '@/lib/api/plans';
import {
  DAY_LABELS,
  PHASE_LABELS,
  estimateDistanceKm,
  formatDuration,
  frKm,
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
  const styles = useStyles();

  return (
    <View style={styles.planBody}>
      <GoalBlock plan={plan} />

      {plan.phases.map((phase, pi) => (
        <View key={`${phase.name}-${pi}`} style={styles.phase}>
          <ThemedText type="label" themeColor="inkMuted">
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
  const styles = useStyles();
  const theme = useTheme();
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

  return (
    <View style={styles.planBody}>
      <View style={styles.pager}>
        <NavArrow dir="prev" disabled={clamped === 0} onPress={() => setSelected(clamped - 1)} />
        <View style={styles.pagerCenter}>
          <ThemedText type="label" themeColor="inkMuted">
            {PHASE_LABELS[phase]}
            {isCurrent ? ' · en cours' : ''}
          </ThemedText>
          <View style={styles.pagerTitle}>
            <ThemedText type="figure" style={styles.weekNumber}>
              {week.index}
            </ThemedText>
            <ThemedText type="small" themeColor="inkMuted">
              / {weeks.length} semaines
            </ThemedText>
          </View>
          <WeekLoad week={week} />
        </View>
        <NavArrow
          dir="next"
          disabled={clamped === weeks.length - 1}
          onPress={() => setSelected(clamped + 1)}
        />
      </View>

      {/* The week's own baseline: the pager sits above the rule, the sessions
          hang under it, so a week reads as one block rather than a header
          floating over a list. */}
      <View style={[styles.rule, { backgroundColor: theme.ruleStrong }]} />

      <WeekSessions week={week} />
    </View>
  );
}

function GoalBlock({ plan }: { plan: Plan }) {
  const styles = useStyles();

  return (
    <View style={styles.goal}>
      <ThemedText type="label" themeColor="inkMuted">
        Objectif
      </ThemedText>
      <ThemedText type="subtitle">{plan.goal.description}</ThemedText>
      {plan.goal.race_date ? (
        <ThemedText type="small" themeColor="inkMuted">
          Le {plan.goal.race_date}
        </ThemedText>
      ) : null}
    </View>
  );
}

function WeekLoad({ week }: { week: PlanWeek }) {
  const theme = useTheme();

  // Décharge is a Récup state: the week is *supposed* to be light, and reading
  // it as falling behind is exactly the misreading this label exists to stop.
  return week.is_deload ? (
    <ThemedText type="label" style={{ color: theme.recup }}>
      Décharge
    </ThemedText>
  ) : (
    <ThemedText type="label" themeColor="inkMuted">
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
  const styles = useStyles();
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={dir === 'prev' ? 'Semaine précédente' : 'Semaine suivante'}
      style={pressable([styles.navArrow, disabled && styles.navArrowDisabled])}>
      <Icon
        name={dir === 'prev' ? 'chevron-left' : 'chevron-right'}
        size={22}
        color={disabled ? theme.inkMuted : theme.ink}
      />
    </Pressable>
  );
}

function WeekSessions({ week }: { week: PlanWeek }) {
  const styles = useStyles();
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

/**
 * One session, as a row on a rule rather than a card.
 *
 * A week is a table of days, and boxing each day in its own rounded rectangle
 * made twelve objects out of one list (DESIGN.md: a card is earned by being an
 * object). The day sits in a fixed left column so the week reads down a single
 * axis, and every row carries both cues that let it be scanned — the sport glyph
 * and the sport-aware name.
 */
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
  const styles = useStyles();
  const theme = useTheme();
  const isKey = session.priority === 'key';
  const isAddon = session.slot === 'addon';

  if (session.type === 'rest') {
    return (
      <View style={styles.row}>
        <ThemedText type="label" themeColor="inkMuted" style={styles.day}>
          {DAY_LABELS[session.day]}
        </ThemedText>
        <View style={[styles.tick, { backgroundColor: theme.recup }]} />
        <ThemedText type="default" themeColor="inkMuted" style={styles.name}>
          Repos
        </ThemedText>
      </View>
    );
  }

  const distanceKm = estimateDistanceKm(session.duration_min, session.pace_range);
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
      style={pressable([styles.row, session.skipped && styles.rowSkipped])}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${sessionTitle(session)}, ${DAY_LABELS[session.day]}, ${meta}${
        isAddon ? ', complément' : `, séance ${position} sur ${total}`
      }${isKey ? ', séance clé' : ''}${session.skipped ? ', sautée' : ''}`}>
      <ThemedText type="label" themeColor="inkMuted" style={styles.day}>
        {DAY_LABELS[session.day]}
      </ThemedText>
      {/* Key is a load state — the session carrying the week's stimulus — so it
          gets the Go ink. Optional gets nothing: the absence of the tick is the
          statement, and a second colour would make "not key" look like a warning. */}
      <View
        style={[styles.tick, { backgroundColor: isKey ? theme.go : 'transparent' }]}
      />
      <SportIcon sport={session.sport} size={20} />
      <View style={styles.nameBlock}>
        <ThemedText type="link" numberOfLines={1}>
          {sessionTitle(session)}
          {session.skipped ? ' · sautée' : ''}
        </ThemedText>
        {session.rationale ? (
          <ThemedText type="small" themeColor="inkMuted" numberOfLines={1}>
            {session.rationale}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="figure" themeColor="inkMuted" style={styles.meta}>
        {meta}
      </ThemedText>
      <IntensityNotch level={sessionDifficulty(session.type)} />
      <Icon name="chevron-right" size={18} color={theme.inkMuted} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  planBody: { gap: Spacing.four },
  phase: { gap: Spacing.two },
  weekBlock: { gap: Spacing.two },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rule: {
    height: 1,
    backgroundColor: t.rule,
  },

  goal: { gap: Spacing.one },

  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  pagerCenter: { flex: 1, alignItems: 'center', gap: Spacing.half },
  pagerTitle: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  weekNumber: { fontSize: 28, lineHeight: 34 },

  navArrow: {
    width: 44,
    height: 44,
    borderRadius: Rounded.md,
    borderWidth: 1,
    borderColor: t.ruleStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowDisabled: { borderColor: t.rule, opacity: 0.5 },

  sessionList: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 56,
    paddingVertical: Spacing.two,
    // Rule on top of each row, never below: the list closes on its container's
    // own edge instead of leaving a line hanging under the last item.
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  // A skipped session stays in the week — hiding it would hide the decision —
  // but recedes: it is no longer something to act on.
  rowSkipped: { opacity: 0.5 },
  day: { width: 34 },
  tick: { width: 3, height: 22, borderRadius: 2 },
  nameBlock: { flex: 1, gap: Spacing.half },
  name: { flex: 1 },
  meta: { fontSize: 13, lineHeight: 18 },
}));

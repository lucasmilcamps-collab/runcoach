import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { moveSession, type PlanWeek, type TodaySession, type Weekday } from '@/lib/api/plans';
import { DAY_LABELS, sessionTitle, sortSessionsByDay } from '@/lib/plan-format';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';
import { makeStyles } from '@/lib/themed-styles';
import type { OverloadVerdict } from '@/lib/week-ledger';

const WEEKDAYS: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

type Suggestion =
  | { kind: 'adjusted'; sentence: string; reason: string }
  | { kind: 'move'; sentence: string; reason: string; from: Weekday; to: Weekday }
  | { kind: 'none'; sentence: string };

/**
 * The third and last block of Accueil: one arbitration, its reason, and one
 * action.
 *
 * Never a list. A list of suggestions is a to-do list, and a to-do list is
 * exactly what an athlete juggling three sports does not need another of — the
 * product's job is to make the single call that is actually in question today.
 *
 * Every suggestion here is deterministic and auditable: either it comes from the
 * server's own downgrade rules (`plan_adaptation`, which always states why), or
 * it is a move this screen can justify from data on the page — high fatigue,
 * a session today, an empty day tomorrow. Nothing is invented to fill the block;
 * when there is nothing to arbitrate it says so.
 */
export function ArbitrageBlock({
  today,
  week,
  weekIndex,
  overload,
}: {
  today: TodaySession | undefined;
  week: PlanWeek | null;
  weekIndex: number | null;
  overload: OverloadVerdict | null;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const move = useMutation({
    mutationFn: ({ from, to }: { from: Weekday; to: Weekday }) =>
      moveSession(weekIndex!, from, to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.plan() });
      queryClient.invalidateQueries({ queryKey: qk.planToday() });
    },
  });

  const suggestion = buildSuggestion(today, week, overload);

  return (
    <View style={styles.block}>
      <ThemedText type="label" themeColor="inkMuted">
        Arbitrage
      </ThemedText>
      <ThemedText type="default">{suggestion.sentence}</ThemedText>

      {suggestion.kind !== 'none' ? (
        <ThemedText type="small" themeColor="inkMuted">
          {suggestion.reason}
        </ThemedText>
      ) : null}

      {suggestion.kind === 'move' ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => move.mutate({ from: suggestion.from, to: suggestion.to })}
            disabled={move.isPending || weekIndex == null}
            accessibilityRole="button"
            accessibilityState={{ disabled: move.isPending, busy: move.isPending }}
            accessibilityLabel={`Décaler la séance de ${DAY_LABELS[suggestion.from]} à ${DAY_LABELS[suggestion.to]}`}
            style={pressable(styles.action)}>
            <ThemedText type="link">
              {move.isPending ? 'Décalage…' : 'Décaler'}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => router.push('/plan')}
            accessibilityRole="button"
            accessibilityLabel="Ouvrir la semaine dans Séances"
            style={pressable(styles.action)}>
            <ThemedText type="link" themeColor="inkMuted">
              Voir la semaine
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {move.isError ? (
        <ThemedText type="small" themeColor="alerte">
          Le décalage n’a pas pu être enregistré. Vérifie ta connexion et réessaie.
        </ThemedText>
      ) : null}
      {move.isSuccess ? (
        <ThemedText type="small" style={{ color: theme.go }}>
          Séance décalée. La semaine est à jour.
        </ThemedText>
      ) : null}
    </View>
  );
}

function buildSuggestion(
  today: TodaySession | undefined,
  week: PlanWeek | null,
  overload: OverloadVerdict | null,
): Suggestion {
  const adjustment = today?.adjustment;
  if (adjustment?.adjusted) {
    return {
      kind: 'adjusted',
      sentence: 'La séance du jour a déjà été allégée.',
      reason: adjustment.reason,
    };
  }

  const session = today?.sessions[0];
  if (overload?.level === 'high' && session && week) {
    const from = session.day;
    const to = WEEKDAYS[(WEEKDAYS.indexOf(from) + 1) % 7];
    // Only offer the move onto a day the plan has actually left free —
    // suggesting a session be piled onto tomorrow's long run would be the
    // opposite of arbitrage.
    const tomorrowIsFree = !week.sessions.some(
      (s) => s.day === to && s.type !== 'rest' && !s.skipped,
    );
    if (tomorrowIsFree) {
      return {
        kind: 'move',
        sentence: `Décale ${sessionTitle(session).toLowerCase()} à ${DAY_LABELS[to].toLowerCase()}.`,
        reason: overload.sentence,
        from,
        to,
      };
    }
  }

  if (week) {
    const remaining = sortSessionsByDay(week.sessions).filter(
      (s) => s.type !== 'rest' && !s.skipped,
    ).length;
    return {
      kind: 'none',
      sentence:
        remaining > 0
          ? 'Rien à arbitrer : la semaine tient telle qu’elle est.'
          : 'Semaine terminée. Rien à replacer.',
    };
  }

  return { kind: 'none', sentence: 'Rien à arbitrer pour l’instant.' };
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: t.ruleStrong,
  },
}));

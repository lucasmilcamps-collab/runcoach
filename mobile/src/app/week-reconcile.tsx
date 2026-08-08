import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setSessionLink, skipSession } from '@/lib/api/plans';
import {
  confirmAllSuggested,
  getReconciliation,
  skipAllPending,
  type PendingSession,
} from '@/lib/api/reconcile';
import { activityLabel } from '@/lib/activity-labels';
import { DAY_LABELS, formatDuration, frKm, sessionTitle } from '@/lib/plan-format';
import { qk } from '@/lib/query-keys';
import { makeStyles } from '@/lib/themed-styles';

/**
 * Settling the weeks that have gone by: every session either linked to an
 * activity or declared not done.
 *
 * Why it blocks the app rather than sitting in a corner: an unsettled session is
 * already counted as missed by the adherence numbers, and that feeds the replan
 * suggestion. Left alone, the plan reacts to something the athlete never said.
 *
 * The two bulk actions are what make a blocking screen fair. A week actually run
 * settles in one tap, a week that went badly in one tap — nobody should have to
 * answer six questions on a Monday morning to reach their plan.
 */
export default function WeekReconcileScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: qk.reconcile(), queryFn: getReconciliation });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: qk.reconcile() });
    // The plan carries `completed`, so the week list's tick comes from it.
    queryClient.invalidateQueries({ queryKey: qk.plan() });
    queryClient.invalidateQueries({ queryKey: qk.planProgress() });
    queryClient.invalidateQueries({ queryKey: qk.planOverview.all() });
    queryClient.invalidateQueries({ queryKey: qk.weeklyReview() });
  }

  const confirmOne = useMutation({
    mutationFn: (row: PendingSession) =>
      setSessionLink(row.week_index, row.day, row.suggested_activity!.id, row.slot),
    onSuccess: refresh,
  });
  const skipOne = useMutation({
    mutationFn: (row: PendingSession) =>
      skipSession(row.week_index, row.day, row.slot, true),
    onSuccess: refresh,
  });
  const confirmAll = useMutation({ mutationFn: confirmAllSuggested, onSuccess: refresh });
  const skipAll = useMutation({ mutationFn: skipAllPending, onSuccess: refresh });

  const busy =
    confirmOne.isPending || skipOne.isPending || confirmAll.isPending || skipAll.isPending;
  const rows = query.data?.sessions ?? [];
  const suggested = rows.filter((r) => r.suggested_activity != null).length;

  // The way out, and it has to live here: the tabs layout is what redirects in,
  // so once it unmounts nobody is left watching for the queue to empty. Without
  // this the athlete settles the last session and stays on an empty screen.
  if (query.data && !query.data.has_pending) return <Redirect href="/dashboard" />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="label" themeColor="inkMuted">
              Semaine à solder
            </ThemedText>
            <ThemedText type="title">Qu’as-tu fait ?</ThemedText>
            <ThemedText type="default" themeColor="inkMuted">
              Ces séances sont passées sans que tu dises ce qu’elles sont devenues. Tant qu’elles
              restent en suspens, ton plan les compte comme manquées.
            </ThemedText>
          </View>

          {query.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.ruleStrong} />
            </View>
          ) : query.isError ? (
            <ThemedText type="default" themeColor="alerte">
              Impossible de charger ta semaine. Réessaie.
            </ThemedText>
          ) : (
            <View style={styles.list}>
              {rows.map((row) => (
                <PendingRow
                  key={`${row.week_index}-${row.day}-${row.slot}`}
                  row={row}
                  disabled={busy}
                  onConfirm={() => confirmOne.mutate(row)}
                  onSkip={() => skipOne.mutate(row)}
                />
              ))}
            </View>
          )}

          {rows.length > 0 ? (
            <View style={styles.bulk}>
              {suggested > 0 ? (
                <Button
                  label={`Tout valider (${suggested})`}
                  loading={confirmAll.isPending}
                  disabled={busy}
                  onPress={() => confirmAll.mutate()}
                />
              ) : null}
              <Button
                label="Tout marquer non fait"
                variant="ghost"
                loading={skipAll.isPending}
                disabled={busy}
                onPress={() => skipAll.mutate()}
              />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function PendingRow({
  row,
  disabled,
  onConfirm,
  onSkip,
}: {
  row: PendingSession;
  disabled: boolean;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const styles = useStyles();
  const activity = row.suggested_activity;

  return (
    <View style={styles.row}>
      <ThemedText type="label" themeColor="inkMuted">
        {DAY_LABELS[row.day]} · {formatDuration(row.duration_min)} prévues
      </ThemedText>
      <ThemedText type="default">{sessionTitle(row)}</ThemedText>

      {/* The suggestion names the activity rather than just offering a button:
          confirming blind is how a session ends up validated by someone else's
          warm-up. */}
      {activity ? (
        <>
          <ThemedText type="small" themeColor="inkMuted">
            Trouvé ce jour-là : {activityLabel(activity)} ·{' '}
            {formatDuration(Math.round(activity.duration_s / 60))}
            {activity.distance_m ? ` · ${frKm(activity.distance_m / 1000)} km` : ''}
          </ThemedText>
          <View style={styles.actions}>
            <Button label="C’était ça" disabled={disabled} onPress={onConfirm} />
            <Button label="Pas faite" variant="ghost" disabled={disabled} onPress={onSkip} />
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          <Button label="Pas faite" variant="ghost" disabled={disabled} onPress={onSkip} />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  safeArea: { flex: 1, backgroundColor: t.surface, paddingHorizontal: Spacing.four },
  container: { flex: 1, width: '100%', alignSelf: 'center', maxWidth: 720 },
  scroll: { gap: Spacing.four, paddingBottom: Spacing.six },
  header: { gap: Spacing.two, paddingTop: Spacing.four },
  centered: { paddingVertical: Spacing.six, alignItems: 'center' },
  list: { gap: Spacing.three },
  // Neutral surfaces throughout: colour means training load (DESIGN.md), and
  // "done / not done" is not a load state.
  row: {
    backgroundColor: t.raised,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: t.rule,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  bulk: { gap: Spacing.two },
}));

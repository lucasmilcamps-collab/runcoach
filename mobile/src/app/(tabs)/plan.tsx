import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CardColumns } from '@/components/card-columns';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { PlanWeekPager } from '@/components/plan-view';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { WeeklyOverview } from '@/components/weekly-overview';
import { BottomTabInset, Colors, MaxContentWidthWide, Rounded, Spacing } from '@/constants/theme';
import { listActivities } from '@/lib/api/activities';
import { ApiError } from '@/lib/api/client';
import {
  createPlan,
  getCurrentPlan,
  getPlanProgress,
  getTodaySession,
  PlanProgress,
  PlanRequest,
  PlanResponse,
  RecoverySummary,
  TodaySession,
} from '@/lib/api/plans';
import { SESSION_LABELS, formatDuration } from '@/lib/plan-format';
import { pressable } from '@/lib/pressable';
import { useAuthStore } from '@/lib/stores/auth-store';
import { computeWeekProgress, currentWeekRangeLabel, findWeek } from '@/lib/week-progress';

function formatSleep(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h} h` : `${h} h ${m.toString().padStart(2, '0')}`;
}

/** Overnight recovery readings behind today's adjustment — transparency for why
 * a session was kept or lightened. Only shows metrics Garmin actually provided. */
function RecoveryStats({ recovery }: { recovery: RecoverySummary }) {
  const items: { key: string; label: string; value: string; hint?: string }[] = [];
  if (recovery.hrv != null) {
    items.push({
      key: 'hrv',
      label: 'HRV',
      value: `${Math.round(recovery.hrv)} ms`,
      hint: recovery.hrv_baseline != null ? `base ${Math.round(recovery.hrv_baseline)}` : undefined,
    });
  }
  if (recovery.resting_hr != null) {
    items.push({
      key: 'rhr',
      label: 'FC repos',
      value: `${Math.round(recovery.resting_hr)} bpm`,
      hint:
        recovery.resting_hr_baseline != null
          ? `base ${Math.round(recovery.resting_hr_baseline)}`
          : undefined,
    });
  }
  if (recovery.sleep_hours != null) {
    items.push({ key: 'sleep', label: 'Sommeil', value: formatSleep(recovery.sleep_hours) });
  }
  if (recovery.body_battery != null) {
    items.push({ key: 'bb', label: 'Body Battery', value: `${recovery.body_battery}` });
  }
  if (items.length === 0) return null;

  return (
    <View style={styles.recoveryRow}>
      {items.map((it) => (
        <View key={it.key} style={styles.recoveryStat}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {it.label}
          </ThemedText>
          <ThemedText type="default">{it.value}</ThemedText>
          {it.hint ? (
            <ThemedText type="small" themeColor="textSecondary">
              {it.hint}
            </ThemedText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export default function PlanScreen() {
  const query = useQuery({
    queryKey: ['plan'],
    queryFn: getCurrentPlan,
    retry: false,
  });
  const todayQuery = useQuery({
    queryKey: ['plan-today'],
    queryFn: getTodaySession,
    retry: false,
  });
  const progressQuery = useQuery({
    queryKey: ['plan-progress'],
    queryFn: getPlanProgress,
    retry: false,
  });
  const garminConnected = useAuthStore((s) => s.garminConnected);
  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: listActivities,
    enabled: garminConnected,
  });
  const queryClient = useQueryClient();

  const replanMutation = useMutation({
    mutationFn: (request: PlanRequest) => createPlan(request),
    onSuccess: (data) => {
      queryClient.setQueryData(['plan'], data);
      queryClient.invalidateQueries({ queryKey: ['plan-today'] });
      queryClient.invalidateQueries({ queryKey: ['plan-progress'] });
    },
  });

  const noPlan = query.error instanceof ApiError && query.error.status === 404;
  const currentRequest = query.data?.request ?? null;
  const ready = query.data?.status === 'ready';

  const plan = query.data?.plan ?? null;
  const weekCurrent = progressQuery.data?.week_current ?? null;
  const weekProgress = computeWeekProgress(
    activitiesQuery.data ?? [],
    findWeek(plan, weekCurrent),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <TopBar title="SÉANCES" subtitle={ready ? currentWeekRangeLabel() : undefined} />

          {ready ? (
            <View style={styles.historyRow}>
              <Pressable
                onPress={() => router.push('/plan-history')}
                accessibilityRole="button"
                accessibilityLabel="Historique des versions du plan"
                hitSlop={8}
                style={pressable(styles.historyLink)}>
                <ThemedText type="waypointLabel" themeColor="blaze">
                  Historique
                </ThemedText>
                <Icon name="chevron-right" size={16} color={Colors.blaze} />
              </Pressable>
            </View>
          ) : null}

          {progressQuery.data?.replan_suggested && currentRequest ? (
            <ReplanBanner
              progress={progressQuery.data}
              onReplan={() => replanMutation.mutate(currentRequest)}
              isReplanning={replanMutation.isPending}
            />
          ) : null}

          {todayQuery.data?.has_plan ? <TodayCard today={todayQuery.data} /> : null}

          {/* Weekly overview + chrono forecast pair up on wide viewports. */}
          {ready ? (
            <CardColumns>
              {[
                <WeeklyOverview key="overview" progress={weekProgress} />,
                query.data?.estimated_time_min != null ? (
                  <ForecastCard
                    key="forecast"
                    estimated={query.data.estimated_time_min}
                    projected={query.data.projected_time_min}
                  />
                ) : null,
              ].filter(Boolean)}
            </CardColumns>
          ) : null}

          {ready && query.data?.feasibility_warning ? (
            <View style={styles.warnBanner}>
              <ThemedText type="waypointLabel" themeColor="flare">
                Objectif ambitieux
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {query.data.feasibility_warning}
              </ThemedText>
            </View>
          ) : null}

          {query.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={Colors.contour} />
            </View>
          ) : noPlan ? (
            <EmptyPlan />
          ) : query.isError ? (
            <ThemedText type="default" themeColor="flare">
              Impossible de charger votre plan. Réessayez.
            </ThemedText>
          ) : query.data ? (
            <PlanBody response={query.data} currentWeek={progressQuery.data?.week_current ?? null} />
          ) : null}

          {query.data?.status === 'ready' ? <PlanActions /> : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function PlanActions() {
  return (
    <View style={styles.actions}>
      <Button
        label="Modifier l’objectif"
        variant="ghost"
        style={styles.actionBtn}
        onPress={() => router.push('/plan-setup')}
      />
      <Button
        label="Signaler une gêne"
        variant="ghost"
        style={styles.actionBtn}
        onPress={() => router.push('/injury-report')}
      />
    </View>
  );
}

function ReplanBanner({
  progress,
  onReplan,
  isReplanning,
}: {
  progress: PlanProgress;
  onReplan: () => void;
  isReplanning: boolean;
}) {
  return (
    <View style={styles.replanBanner}>
      <ThemedText type="waypointLabel" themeColor="flare">
        Plan à réajuster
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {progress.replan_reason ?? 'Ton plan mérite un réajustement.'} Régénérer les semaines
        restantes à partir de ta forme actuelle ?
      </ThemedText>
      <Button
        label="Régénérer un plan adapté"
        variant="ghost"
        loading={isReplanning}
        onPress={onReplan}
      />
    </View>
  );
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

function ForecastCard({ estimated, projected }: { estimated: number; projected: number | null }) {
  const improves = projected != null && projected < estimated;
  return (
    <View style={styles.forecastCard}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Prévision de chrono
      </ThemedText>
      <View style={styles.forecastRow}>
        <View style={styles.forecastCol}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Actuel estimé
          </ThemedText>
          <ThemedText type="subtitle">{fmtTime(estimated)}</ThemedText>
        </View>
        <Icon name="chevron-right" size={20} color={Colors.textSecondary} />
        <View style={styles.forecastCol}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Fin de plan
          </ThemedText>
          <ThemedText type="subtitle" themeColor={improves ? 'blaze' : 'text'}>
            {projected != null ? fmtTime(projected) : '—'}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

function TodayCard({ today }: { today: TodaySession }) {
  const weekTag = today.week_index ? ` · Semaine ${today.week_index}` : '';

  if (!today.has_session) {
    return (
      <View style={styles.todayCard}>
        <ThemedText type="waypointLabel" themeColor="blaze">
          Aujourd’hui{weekTag}
        </ThemedText>
        <ThemedText type="default">{today.message ?? 'Repos aujourd’hui.'}</ThemedText>
        {today.recovery ? <RecoveryStats recovery={today.recovery} /> : null}
      </View>
    );
  }

  const adj = today.adjustment;
  const primary = today.sessions[0] ?? null;
  const addons = today.sessions.slice(1);
  const shownType = adj?.adjusted ? adj.suggested_type : (primary?.type ?? 'easy');

  return (
    <View style={styles.todayCard}>
      <ThemedText type="waypointLabel" themeColor="blaze">
        Aujourd’hui{weekTag}
      </ThemedText>
      <View style={styles.todayTitleRow}>
        <ThemedText type="subtitle">{SESSION_LABELS[shownType]}</ThemedText>
        {primary ? (
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {formatDuration(primary.duration_min)}
          </ThemedText>
        ) : null}
      </View>
      {addons.map((s, i) => (
        <ThemedText key={i} type="small" themeColor="textSecondary">
          + {SESSION_LABELS[s.type]} · {formatDuration(s.duration_min)}
        </ThemedText>
      ))}
      {adj?.adjusted ? (
        <ThemedText type="small" themeColor="textSecondary">
          Prévu : {SESSION_LABELS[adj.original_type]}
        </ThemedText>
      ) : null}
      {adj ? (
        <ThemedText type="small" themeColor={adj.adjusted ? 'hydro' : 'textSecondary'}>
          {adj.reason}
        </ThemedText>
      ) : null}
      {today.recovery ? <RecoveryStats recovery={today.recovery} /> : null}
    </View>
  );
}

function EmptyPlan() {
  return (
    <EmptyState
      title="Aucun plan pour l’instant"
      description="Créez un plan course à pied qui s’adapte à votre forme réelle et intègre vos autres sports comme charge d’entraînement."
      pin="summit">
      <Button label="Créer mon plan" onPress={() => router.push('/plan-setup')} />
    </EmptyState>
  );
}

function PlanBody({
  response,
  currentWeek,
}: {
  response: PlanResponse;
  currentWeek: number | null;
}) {
  if (response.status === 'failed') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" themeColor="flare">
          La génération a échoué.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {response.error_message ?? 'Réessayez dans quelques instants.'}
        </ThemedText>
      </View>
    );
  }
  if (!response.plan) return null;
  return <PlanWeekPager plan={response.plan} currentWeek={currentWeek} />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
  },
  container: {
    flex: 1,
    maxWidth: MaxContentWidthWide,
    alignSelf: 'center',
    width: '100%',
  },
  scrollContent: {
    gap: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  actionBtn: { flex: 1 },
  todayCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.two,
    borderLeftWidth: 2,
    borderLeftColor: Colors.blaze,
  },
  replanBanner: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
    borderLeftWidth: 2,
    borderLeftColor: Colors.flare,
  },
  warnBanner: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.one,
    borderLeftWidth: 2,
    borderLeftColor: Colors.flare,
  },
  forecastCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  forecastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  forecastCol: { gap: Spacing.half, alignItems: 'center', flex: 1 },
  todayTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recoveryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
    paddingTop: Spacing.three,
    marginTop: Spacing.one,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  recoveryStat: {
    gap: Spacing.half,
  },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.two,
  },
});

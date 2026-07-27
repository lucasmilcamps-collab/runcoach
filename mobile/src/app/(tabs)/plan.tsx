import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api/client';
import {
  createPlan,
  getCurrentPlan,
  getPlanProgress,
  getTodaySession,
  PlanPhase,
  PlanProgress,
  PlanRequest,
  PlanResponse,
  PlanSession,
  PlanWeek,
  RecoverySummary,
  TodaySession,
  Weekday,
} from '@/lib/api/plans';

const PHASE_LABELS: Record<PlanPhase['name'], string> = {
  base: 'Base',
  build: 'Développement',
  peak: 'Pic',
  taper: 'Affûtage',
};

const SESSION_LABELS: Record<PlanSession['type'], string> = {
  easy: 'Footing',
  long_run: 'Sortie longue',
  tempo: 'Tempo',
  threshold: 'Seuil',
  intervals: 'Fractionné',
  recovery: 'Récupération',
  cross_training: 'Cross-training',
  rest: 'Repos',
};

const DAY_LABELS: Record<Weekday, string> = {
  MONDAY: 'Lun',
  TUESDAY: 'Mar',
  WEDNESDAY: 'Mer',
  THURSDAY: 'Jeu',
  FRIDAY: 'Ven',
  SATURDAY: 'Sam',
  SUNDAY: 'Dim',
};

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest}`;
}

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">Mon plan</ThemedText>
          </View>

          {progressQuery.data?.replan_suggested && currentRequest ? (
            <ReplanBanner
              progress={progressQuery.data}
              onReplan={() => replanMutation.mutate(currentRequest)}
              isReplanning={replanMutation.isPending}
            />
          ) : null}

          {todayQuery.data?.has_plan ? <TodayCard today={todayQuery.data} /> : null}

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
            <PlanBody response={query.data} />
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {query.data?.status === 'ready' ? (
            <>
              <Button
                label="Modifier mon objectif"
                variant="ghost"
                onPress={() => router.push('/plan-setup')}
              />
              <Button
                label="Signaler une blessure / gêne"
                variant="ghost"
                onPress={() => router.push('/injury-report')}
              />
            </>
          ) : (
            <Button
              label="Créer mon plan"
              variant="ghost"
              onPress={() => router.push('/plan-setup')}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
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
  const shownType = adj?.adjusted ? adj.suggested_type : (today.session?.type ?? 'easy');

  return (
    <View style={styles.todayCard}>
      <ThemedText type="waypointLabel" themeColor="blaze">
        Aujourd’hui{weekTag}
      </ThemedText>
      <View style={styles.todayTitleRow}>
        <ThemedText type="subtitle">{SESSION_LABELS[shownType]}</ThemedText>
        {today.session ? (
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {formatDuration(today.session.duration_min)}
          </ThemedText>
        ) : null}
      </View>
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
    <View style={styles.card}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Aucun plan
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Créez un plan d’entraînement qui s’adapte à votre forme et intègre votre cross-training
        comme charge.
      </ThemedText>
    </View>
  );
}

function PlanBody({ response }: { response: PlanResponse }) {
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
  const { plan } = response;

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
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
  },
  container: {
    flex: 1,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  scrollContent: {
    gap: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  header: { gap: Spacing.two },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  footer: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  planBody: { gap: Spacing.four },
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

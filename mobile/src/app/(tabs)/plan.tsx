import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api/client';
import {
  getCurrentPlan,
  getTodaySession,
  PlanPhase,
  PlanResponse,
  PlanSession,
  PlanWeek,
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

  const noPlan = query.error instanceof ApiError && query.error.status === 404;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">Mon plan</ThemedText>
          </View>

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
          <Button
            label={query.data?.status === 'ready' ? 'Modifier / régénérer' : 'Créer mon plan'}
            variant="ghost"
            onPress={() => router.push('/plan-setup')}
          />
        </View>
      </View>
    </SafeAreaView>
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
        <View key={si} style={styles.sessionRow}>
          <ThemedText type="waypointLabel" themeColor="textSecondary" style={styles.sessionDay}>
            {DAY_LABELS[session.day]}
          </ThemedText>
          <View style={styles.sessionMain}>
            <View style={styles.sessionTitleRow}>
              <ThemedText type="default">{SESSION_LABELS[session.type]}</ThemedText>
              {session.type !== 'rest' ? (
                <ThemedText type="waypointLabel" themeColor="textSecondary">
                  {formatDuration(session.duration_min)}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {session.rationale}
            </ThemedText>
          </View>
        </View>
      ))}
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
  todayTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
});

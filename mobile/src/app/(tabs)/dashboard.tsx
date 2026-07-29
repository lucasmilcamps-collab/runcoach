import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncingCard } from '@/components/activity-list';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { FitnessCard } from '@/components/fitness-card';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { WeekProgressCard } from '@/components/week-progress-card';
import { WeekSportStrip } from '@/components/week-sport-strip';
import { WeekStepper } from '@/components/week-stepper';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { listActivities } from '@/lib/api/activities';
import { getFitness } from '@/lib/api/fitness';
import { getCurrentPlan, getPlanProgress } from '@/lib/api/plans';
import { pressable } from '@/lib/pressable';
import { registerServiceWorker } from '@/lib/push';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useGarminSync } from '@/lib/use-garmin-sync';
import { computeWeekProgress, currentWeekRangeLabel, findWeek } from '@/lib/week-progress';

export default function DashboardScreen() {
  const garminConnected = useAuthStore((state) => state.garminConnected);
  const { isSyncing, errorMessage } = useGarminSync();

  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: listActivities,
    enabled: garminConnected,
  });
  const fitnessQuery = useQuery({
    queryKey: ['fitness'],
    queryFn: getFitness,
    enabled: garminConnected,
  });
  const planQuery = useQuery({ queryKey: ['plan'], queryFn: getCurrentPlan, retry: false });
  const progressQuery = useQuery({
    queryKey: ['plan-progress'],
    queryFn: getPlanProgress,
    retry: false,
  });

  // Register the Web Push service worker on web (no-op on native / unsupported).
  useEffect(() => {
    registerServiceWorker();
  }, []);

  const activities = activitiesQuery.data ?? [];
  const hasActivities = activities.length > 0;
  const firstImport = isSyncing && !hasActivities;
  const backgroundSyncing = isSyncing && hasActivities;

  const plan = planQuery.data?.status === 'ready' ? (planQuery.data.plan ?? null) : null;
  const weekCurrent = progressQuery.data?.week_current ?? null;
  const weeksTotal = progressQuery.data?.weeks_total ?? null;
  const hasPlan = plan != null;
  const weekProgress = computeWeekProgress(activities, findWeek(plan, weekCurrent));

  // Surface (rather than silently swallow) a failed data load, with a retry.
  // Each query owns its own retry so tapping only refetches what actually broke.
  const dataError =
    activitiesQuery.isError ||
    fitnessQuery.isError ||
    planQuery.isError ||
    progressQuery.isError;
  const retryData = () => {
    if (activitiesQuery.isError) activitiesQuery.refetch();
    if (fitnessQuery.isError) fitnessQuery.refetch();
    if (planQuery.isError) planQuery.refetch();
    if (progressQuery.isError) progressQuery.refetch();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TopBar title="RUNCOACH" subtitle={currentWeekRangeLabel()} />
            {errorMessage ? (
              <ThemedText type="small" themeColor="flare" style={styles.centerText}>
                {errorMessage}
              </ThemedText>
            ) : null}
            {backgroundSyncing ? (
              <View style={styles.syncChip}>
                <ActivityIndicator size="small" color={Colors.blaze} />
                <ThemedText type="small" themeColor="textSecondary">
                  Synchronisation Garmin…
                </ThemedText>
              </View>
            ) : null}
            {dataError ? (
              <Pressable
                onPress={retryData}
                accessibilityRole="button"
                accessibilityLabel="Réessayer de charger vos données"
                style={pressable(styles.retryRow)}>
                <ThemedText type="small" themeColor="flare" style={styles.centerText}>
                  Impossible de charger vos données. Appuyez pour réessayer.
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {hasPlan ? (
            <WeekProgressCard
              progress={weekProgress}
              weekCurrent={weekCurrent}
              weeksTotal={weeksTotal}
            />
          ) : null}

          {weekProgress.sports.length > 0 ? (
            <WeekSportStrip sports={weekProgress.sports} />
          ) : null}

          {hasPlan && weeksTotal ? (
            <View style={styles.program}>
              <ThemedText type="waypointLabel" themeColor="textSecondary">
                Programme en cours
              </ThemedText>
              <WeekStepper
                weeksTotal={weeksTotal}
                weekCurrent={weekCurrent}
                onPick={() => router.push('/plan')}
              />
            </View>
          ) : null}

          {firstImport ? <SyncingCard /> : null}

          {!garminConnected ? (
            <EmptyState
              title="Reliez votre Garmin"
              description="RunCoach lit vos activités, votre fréquence cardiaque, votre sommeil et votre récupération pour calculer votre forme et adapter votre plan."
              pin="summit">
              <Button label="Connecter Garmin" onPress={() => router.push('/garmin-connect')} />
              <Button
                label="Ajouter une séance à la main"
                variant="ghost"
                onPress={() => router.push('/add-activity')}
              />
            </EmptyState>
          ) : null}

          {garminConnected && !firstImport ? (
            <FitnessCard fitness={fitnessQuery.data} isLoading={fitnessQuery.isLoading} />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
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
    gap: Spacing.five,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  centerText: {
    textAlign: 'center',
  },
  program: {
    gap: Spacing.two,
  },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
    justifyContent: 'center',
  },
  retryRow: {
    paddingVertical: Spacing.two,
  },
});

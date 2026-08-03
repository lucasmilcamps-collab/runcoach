import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncingCard } from '@/components/activity-list';
import { ArbitrageBlock } from '@/components/arbitrage-block';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { TodayBlock } from '@/components/today-block';
import { TopBar } from '@/components/top-bar';
import { WeekLedgerCard } from '@/components/week-ledger';
import { MaxContentWidthWide, Spacing } from '@/constants/theme';
import { useCompactHeader } from '@/hooks/use-compact-header';
import { useIsWide } from '@/hooks/use-breakpoint';
import { useTabScrollPadding } from '@/hooks/use-tab-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { listActivities } from '@/lib/api/activities';
import { getFitness } from '@/lib/api/fitness';
import { getCurrentPlan, getPlanProgress, getTodaySession } from '@/lib/api/plans';
import { formBand, signed } from '@/lib/fitness-format';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/lib/stores/auth-store';
import { makeStyles } from '@/lib/themed-styles';
import { useGarminSync } from '@/lib/use-garmin-sync';
import { buildWeekLedger, overloadVerdict } from '@/lib/week-ledger';
import { currentWeekRangeLabel, findWeek } from '@/lib/week-progress';

/**
 * Accueil — three blocks, and deliberately no fourth (DESIGN.md).
 *
 *   1. Aujourd'hui  — what to do.
 *   2. La semaine   — what it has already cost, every discipline on one baseline.
 *   3. Arbitrage    — the one call actually in question today.
 *
 * Everything that used to sit here as a fourth and fifth card (the fitness
 * curve, the week ring, the sport strip) either folded into the ledger or moved
 * one tap behind it. An athlete opening this screen is arbitrating, not
 * browsing; a home screen that lists everything it knows makes them do the
 * triage the product exists to do for them.
 */
export default function DashboardScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const wide = useIsWide();
  const bottomPad = useTabScrollPadding();
  const { compact, onScroll } = useCompactHeader();
  const garminConnected = useAuthStore((state) => state.garminConnected);
  const { isSyncing, errorMessage } = useGarminSync();

  const activitiesQuery = useQuery({
    queryKey: qk.activities(),
    queryFn: listActivities,
    enabled: garminConnected,
  });
  const fitnessQuery = useQuery({
    queryKey: qk.fitness(),
    queryFn: getFitness,
    enabled: garminConnected,
  });
  const planQuery = useQuery({ queryKey: qk.plan(), queryFn: getCurrentPlan });
  const progressQuery = useQuery({ queryKey: qk.planProgress(), queryFn: getPlanProgress });
  const todayQuery = useQuery({ queryKey: qk.planToday(), queryFn: getTodaySession });

  const activities = activitiesQuery.data ?? [];
  const hasActivities = activities.length > 0;
  const firstImport = isSyncing && !hasActivities;
  const backgroundSyncing = isSyncing && hasActivities;

  const plan = planQuery.data?.status === 'ready' ? (planQuery.data.plan ?? null) : null;
  const weekCurrent = progressQuery.data?.week_current ?? null;
  const currentWeek = findWeek(plan, weekCurrent);

  const fitness = fitnessQuery.data;
  const hasForm = !!fitness?.has_profile && (fitness?.series.length ?? 0) > 0;
  const ledger = buildWeekLedger(activities, currentWeek);
  const verdict = garminConnected
    ? overloadVerdict(hasForm ? fitness!.tsb : null, activities)
    : null;

  // Surface (rather than silently swallow) a failed data load, with a retry.
  // Each query owns its own retry so tapping only refetches what actually broke.
  const dataError =
    activitiesQuery.isError || fitnessQuery.isError || planQuery.isError || progressQuery.isError;
  const retryData = () => {
    if (activitiesQuery.isError) activitiesQuery.refetch();
    if (fitnessQuery.isError) fitnessQuery.refetch();
    if (planQuery.isError) planQuery.refetch();
    if (progressQuery.isError) progressQuery.refetch();
  };

  const todayBlock = <TodayBlock today={todayQuery.data} />;

  const weekBlock = (
    <View style={styles.weekBlock}>
      <WeekLedgerCard ledger={ledger} verdict={verdict} />
      {/* The summary answers "how heavy was the week"; the figures behind it —
          caisse de fond, fatigue, the 90-day curve — are one tap away rather
          than a fourth block competing for the same glance. */}
      <Pressable
        onPress={() => router.push('/fitness')}
        accessibilityRole="button"
        accessibilityLabel="Voir le détail de la forme et de la charge"
        style={pressable(styles.detailRow)}>
        <ThemedText type="small" themeColor="inkMuted">
          {hasForm ? `Forme ${signed(fitness!.tsb)} · ${formBand(fitness!.tsb).word}` : 'Forme'}
        </ThemedText>
        <View style={styles.detailLink}>
          <ThemedText type="small" themeColor="ink">
            Détail
          </ThemedText>
          <Icon name="chevron-right" size={16} color={theme.inkMuted} />
        </View>
      </Pressable>
    </View>
  );

  const arbitrageBlock = (
    <ArbitrageBlock
      today={todayQuery.data}
      week={currentWeek}
      weekIndex={weekCurrent}
      overload={verdict}
    />
  );

  const hasContent = garminConnected && !firstImport;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Outside the ScrollView: the header stays put and the body scrolls
            under it. Pinning by layout rather than by position:sticky keeps it
            identical on native and on the installed PWA. */}
        <TopBar subtitle={currentWeekRangeLabel()} compact={compact} />
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <View style={styles.notices}>
            {/* The blocks below read today's session, which the service worker
                will serve from cache when there's no network — so its age is
                stated before them, not after. */}
            <OfflineBanner />
            {errorMessage ? (
              <ThemedText type="small" themeColor="alerte">
                {errorMessage}
              </ThemedText>
            ) : null}
            {backgroundSyncing ? (
              <View style={styles.syncRow}>
                <ActivityIndicator size="small" color={theme.inkMuted} />
                <ThemedText type="small" themeColor="inkMuted">
                  Synchronisation Garmin…
                </ThemedText>
              </View>
            ) : null}
            {dataError ? (
              <Pressable
                onPress={retryData}
                accessibilityRole="button"
                accessibilityLabel="Réessayer de charger tes données"
                style={pressable(styles.retryRow)}>
                <ThemedText type="small" themeColor="alerte">
                  Impossible de charger tes données. Appuie pour réessayer.
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {hasContent ? (
            wide ? (
              // Two columns divided by one full-height rule, so both sides end
              // on the same line instead of one trailing off short.
              <View style={styles.columns}>
                <View style={styles.column}>
                  {todayBlock}
                  <View style={styles.rule} />
                  {arbitrageBlock}
                </View>
                <View style={styles.columnRule} />
                <View style={styles.column}>{weekBlock}</View>
              </View>
            ) : (
              <View style={styles.stack}>
                {todayBlock}
                <View style={styles.rule} />
                {weekBlock}
                <View style={styles.rule} />
                {arbitrageBlock}
              </View>
            )
          ) : null}

          {firstImport ? <SyncingCard /> : null}

          {!garminConnected ? (
            <EmptyState
              title="Relie ta montre"
              description="Relay lit tes activités, ta fréquence cardiaque, ton sommeil et ta récupération — puis arbitre la semaine entre la course, le renfo et tes sports co."
              variant="ledger">
              <Button label="Connecter Garmin" onPress={() => router.push('/garmin-connect')} />
              <Button
                label="Ajouter une séance à la main"
                variant="ghost"
                onPress={() => router.push('/add-activity')}
              />
            </EmptyState>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
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
    paddingTop: Spacing.three,
  },
  notices: {
    gap: Spacing.two,
  },
  stack: {
    gap: Spacing.five,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.five,
  },
  column: {
    flex: 1,
    gap: Spacing.five,
  },
  columnRule: {
    width: 1,
    backgroundColor: t.rule,
  },
  rule: {
    height: 1,
    backgroundColor: t.rule,
  },
  weekBlock: {
    gap: Spacing.three,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  detailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  retryRow: {
    paddingVertical: Spacing.two,
  },
}));

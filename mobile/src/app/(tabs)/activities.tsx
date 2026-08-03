import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityList, SyncingCard } from '@/components/activity-list';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';
import { listActivities } from '@/lib/api/activities';
import { useCompactHeader } from '@/hooks/use-compact-header';
import { useTabScrollPadding } from '@/hooks/use-tab-scroll-padding';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useGarminSync } from '@/lib/use-garmin-sync';

export default function ActivitiesScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const bottomPad = useTabScrollPadding();
  const { compact, onScroll } = useCompactHeader();
  const garminConnected = useAuthStore((s) => s.garminConnected);
  const { sync, isSyncing, errorMessage } = useGarminSync();

  const activitiesQuery = useQuery({
    queryKey: qk.activities(),
    queryFn: listActivities,
    enabled: garminConnected,
  });

  const activities = activitiesQuery.data ?? [];
  const hasActivities = activities.length > 0;
  const backgroundSyncing = isSyncing && hasActivities;

  const count = activities.length;
  const subtitle = hasActivities
    ? `${count} activité${count > 1 ? 's' : ''} synchronisée${count > 1 ? 's' : ''}`
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <TopBar subtitle={subtitle} compact={compact} />
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            {errorMessage ? (
              <ThemedText type="small" themeColor="alerte" style={styles.centerText}>
                {errorMessage}
              </ThemedText>
            ) : null}
            {backgroundSyncing ? (
              <View style={styles.syncChip}>
                <ActivityIndicator size="small" color={theme.ink} />
                <ThemedText type="small" themeColor="inkMuted">
                  Synchronisation Garmin…
                </ThemedText>
              </View>
            ) : null}
          </View>

          {isSyncing && !hasActivities ? <SyncingCard /> : null}

          {!garminConnected ? (
            <EmptyState
              title="Relie ta montre"
              description="Connecte Garmin pour importer tes activités, ou enregistre une séance à la main."
              variant="ledger">
              <Button label="Connecter Garmin" onPress={() => router.push('/garmin-connect')} />
              <Button
                label="Ajouter une séance à la main"
                variant="ghost"
                onPress={() => router.push('/add-activity')}
              />
            </EmptyState>
          ) : null}

          {garminConnected && !hasActivities && !isSyncing ? (
            <EmptyState
              title="Aucune activité pour l’instant"
              description="Lancez une synchronisation pour importer jusqu’à 90 jours d’historique Garmin, ou enregistrez une séance à la main."
              variant="handover">
              <Button label="Synchroniser Garmin" loading={isSyncing} onPress={sync} />
              <Button
                label="Ajouter une séance"
                variant="ghost"
                onPress={() => router.push('/add-activity')}
              />
            </EmptyState>
          ) : null}

          {hasActivities ? <ActivityList activities={activities} /> : null}

          {hasActivities ? (
            <View style={styles.actions}>
              <Button
                label="Synchroniser Garmin"
                variant="ghost"
                style={styles.actionBtn}
                loading={isSyncing}
                onPress={sync}
              />
              <Button
                label="Ajouter une séance"
                variant="ghost"
                style={styles.actionBtn}
                onPress={() => router.push('/add-activity')}
              />
            </View>
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
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  scrollContent: {
    gap: Spacing.four,
    paddingTop: Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  centerText: {
    textAlign: 'center',
  },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  actionBtn: { flex: 1 },
}));

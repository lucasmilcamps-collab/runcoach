import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityList, SyncingCard } from '@/components/activity-list';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { listActivities } from '@/lib/api/activities';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useGarminSync } from '@/lib/use-garmin-sync';

export default function ActivitiesScreen() {
  const garminConnected = useAuthStore((s) => s.garminConnected);
  const { sync, isSyncing, errorMessage } = useGarminSync();

  const activitiesQuery = useQuery({
    queryKey: ['activities'],
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
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TopBar title="ACTIVITÉS" subtitle={subtitle} />
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
          </View>

          {isSyncing && !hasActivities ? <SyncingCard /> : null}

          {!garminConnected ? (
            <EmptyState
              title="Reliez votre Garmin"
              description="Connectez Garmin pour importer vos activités, ou enregistrez une séance à la main."
              pin="summit">
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
              pin="edge">
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
    paddingBottom: BottomTabInset + Spacing.four,
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
    borderTopColor: Colors.contourFaint,
  },
  actionBtn: { flex: 1 },
});

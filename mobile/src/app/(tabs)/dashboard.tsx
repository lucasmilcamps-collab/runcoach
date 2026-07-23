import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { activityLabel } from '@/lib/activity-labels';
import { Activity, listActivities } from '@/lib/api/activities';
import { ApiError } from '@/lib/api/client';
import { syncGarmin } from '@/lib/api/garmin';
import { useAuthStore } from '@/lib/stores/auth-store';

function formatDuration(durationS: number): string {
  const minutes = Math.round(durationS / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(
    new Date(isoString)
  );
}

export default function DashboardScreen() {
  const garminConnected = useAuthStore((state) => state.garminConnected);
  const { sync } = useLocalSearchParams<{ sync?: string }>();
  const queryClient = useQueryClient();
  const autoSyncedRef = useRef(false);

  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: listActivities,
    enabled: garminConnected,
  });

  const syncMutation = useMutation({
    mutationFn: syncGarmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  // Auto-run one sync when arriving straight from a fresh Garmin connect.
  // The ref guards against re-firing on re-render; the server throttles
  // anything more frequent than its cooldown anyway.
  useEffect(() => {
    if (sync === '1' && garminConnected && !autoSyncedRef.current) {
      autoSyncedRef.current = true;
      syncMutation.mutate();
    }
  }, [sync, garminConnected, syncMutation]);

  const activities = activitiesQuery.data ?? [];
  const isSyncing = syncMutation.isPending;
  const syncResult = syncMutation.data;

  const syncErrorMessage = (() => {
    if (syncMutation.error instanceof ApiError) {
      if (syncMutation.error.code === 'GARMIN_UPSTREAM_ERROR') {
        return 'Garmin limite temporairement les connexions. Réessayez dans quelques minutes.';
      }
      return syncMutation.error.message;
    }
    if (syncResult?.status === 'failed') {
      return syncResult.error_message ?? 'La synchronisation a échoué.';
    }
    if (syncMutation.isError) {
      return 'Impossible de contacter le serveur. Réessayez.';
    }
    return undefined;
  })();

  const headline = (() => {
    if (!garminConnected) {
      return 'Aucune donnée pour l’instant : connectez Garmin pour que votre charge d’entraînement et votre récupération apparaissent ici.';
    }
    if (isSyncing) {
      return 'Synchronisation Garmin en cours (jusqu’à 90 jours d’historique)…';
    }
    if (syncErrorMessage) {
      return syncErrorMessage;
    }
    if (activities.length > 0) {
      return `${activities.length} activité${activities.length > 1 ? 's' : ''} synchronisée${activities.length > 1 ? 's' : ''}.`;
    }
    return 'Garmin est connecté, aucune activité pour l’instant.';
  })();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">Votre tableau de bord</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              {headline}
            </ThemedText>
          </View>

          {isSyncing ? (
            <SyncingCard />
          ) : activities.length > 0 ? (
            <ActivityList activities={activities} />
          ) : (
            <FlatContour />
          )}
        </ScrollView>

        <View style={styles.footer}>
          {!garminConnected ? (
            <Button
              label="Connecter Garmin"
              variant="ghost"
              onPress={() => router.push('/garmin-connect')}
            />
          ) : (
            <Button
              label="Synchroniser Garmin"
              variant="ghost"
              loading={isSyncing}
              onPress={() => syncMutation.mutate()}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function SyncingCard() {
  return (
    <View style={[styles.contourCard, styles.syncingCard]}>
      <ActivityIndicator color={Colors.blaze} />
      <ThemedText type="small" themeColor="textSecondary">
        Ça peut prendre quelques minutes la première fois.
      </ThemedText>
    </View>
  );
}

function ActivityList({ activities }: { activities: Activity[] }) {
  return (
    <View style={styles.activityList}>
      {activities.map((activity, index) => (
        <View
          key={activity.id}
          style={[styles.activityRow, index === activities.length - 1 && styles.activityRowLast]}>
          <View style={styles.activityRowMain}>
            <ThemedText type="default">{activityLabel(activity)}</ThemedText>
            <ThemedText type="waypointLabel" themeColor="textSecondary">
              {formatDate(activity.start_time)}
            </ThemedText>
          </View>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {formatDuration(activity.duration_s)}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function FlatContour() {
  return (
    <View style={styles.contourCard}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Charge — 7 derniers jours
      </ThemedText>
      <View style={styles.contourLineWrapper}>
        <View style={styles.contourLine} />
        <View style={styles.contourDot} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Aucune charge enregistrée pour l'instant.
      </ThemedText>
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
    gap: Spacing.five,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  footer: {
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  contourCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 14,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  syncingCard: {
    alignItems: 'center',
  },
  contourLineWrapper: {
    height: 48,
    justifyContent: 'center',
    width: '100%',
  },
  contourLine: {
    height: 1,
    backgroundColor: Colors.contour,
  },
  contourDot: {
    position: 'absolute',
    left: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textSecondary,
  },
  activityList: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 14,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.contourFaint,
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityRowMain: {
    gap: Spacing.half,
  },
});

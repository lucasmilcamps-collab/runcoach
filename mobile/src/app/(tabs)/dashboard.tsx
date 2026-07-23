import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { Activity, listActivities } from '@/lib/api/activities';
import { getJob } from '@/lib/api/jobs';
import { useAuthStore } from '@/lib/stores/auth-store';

const SPORT_LABELS: Record<Activity['sport'], string> = {
  RUN: 'Course à pied',
  PADEL: 'Padel',
  BASKETBALL: 'Basket',
  BIKE: 'Vélo',
  STRENGTH: 'Renfo',
  OTHER: 'Autre',
};

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
  const { syncJobId } = useLocalSearchParams<{ syncJobId?: string }>();
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ['job', syncJobId],
    queryFn: () => getJob(syncJobId as string),
    enabled: !!syncJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : 2000;
    },
  });

  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: listActivities,
    enabled: garminConnected,
  });

  useEffect(() => {
    if (jobQuery.data?.status === 'done') {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    }
  }, [jobQuery.data?.status, queryClient]);

  const isSyncing = jobQuery.data?.status === 'pending' || jobQuery.data?.status === 'running';
  const syncFailed = jobQuery.data?.status === 'failed';
  const activities = activitiesQuery.data ?? [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.header}>
          <ThemedText type="title">Votre tableau de bord</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {!garminConnected
              ? 'Aucune donnée pour l’instant : connectez Garmin pour que votre charge d’entraînement et votre récupération apparaissent ici.'
              : isSyncing
                ? 'Synchronisation Garmin en cours (jusqu’à 90 jours d’historique)…'
                : syncFailed
                  ? (jobQuery.data?.error_message ?? 'La synchronisation a échoué.')
                  : activities.length > 0
                    ? `${activities.length} activité${activities.length > 1 ? 's' : ''} synchronisée${activities.length > 1 ? 's' : ''}.`
                    : 'Garmin est connecté, aucune activité synchronisée pour l’instant.'}
          </ThemedText>
        </View>

        {isSyncing ? (
          <SyncingCard />
        ) : activities.length > 0 ? (
          <ActivityList activities={activities} />
        ) : (
          <FlatContour />
        )}

        {!garminConnected && (
          <Button label="Connecter Garmin" variant="ghost" onPress={() => router.push('/garmin-connect')} />
        )}
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
            <ThemedText type="default">{SPORT_LABELS[activity.sport]}</ThemedText>
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
  content: {
    flex: 1,
    gap: Spacing.five,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
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

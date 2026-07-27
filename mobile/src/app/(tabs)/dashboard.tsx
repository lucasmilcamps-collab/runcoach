import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { FitnessCard } from '@/components/fitness-card';
import { NotificationsCard } from '@/components/notifications-card';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { activityLabel } from '@/lib/activity-labels';
import { Activity, deleteActivity, listActivities } from '@/lib/api/activities';
import { ApiError } from '@/lib/api/client';
import { getFitness } from '@/lib/api/fitness';
import { syncGarmin } from '@/lib/api/garmin';
import { registerServiceWorker } from '@/lib/push';
import { useAuthStore } from '@/lib/stores/auth-store';

function formatDuration(durationS: number): string {
  const minutes = Math.round(durationS / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

function formatDistance(distanceM: number): string {
  return `${(distanceM / 1000).toFixed(2)} km`;
}

function formatPace(durationS: number, distanceM: number): string {
  const secPerKm = durationS / (distanceM / 1000);
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, '0')} /km`;
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

  const fitnessQuery = useQuery({
    queryKey: ['fitness'],
    queryFn: getFitness,
    enabled: garminConnected,
  });

  const syncMutation = useMutation({
    mutationFn: syncGarmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['fitness'] });
    },
  });

  // Register the Web Push service worker on web (no-op on native / unsupported).
  useEffect(() => {
    registerServiceWorker();
  }, []);

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

  const showConnectEmpty = !isSyncing && !garminConnected;
  const showNoActivitiesEmpty = !isSyncing && garminConnected && activities.length === 0;
  const showEmpty = showConnectEmpty || showNoActivitiesEmpty;
  const showContent = garminConnected && activities.length > 0 && !isSyncing;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">Votre tableau de bord</ThemedText>
            {!showEmpty || syncErrorMessage ? (
              <ThemedText type="default" themeColor={syncErrorMessage ? 'flare' : 'textSecondary'}>
                {headline}
              </ThemedText>
            ) : null}
          </View>

          {isSyncing ? <SyncingCard /> : null}

          {showConnectEmpty ? (
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

          {showNoActivitiesEmpty ? (
            <EmptyState
              title="Aucune activité pour l’instant"
              description="Lancez une synchronisation pour importer jusqu’à 90 jours d’historique Garmin, ou enregistrez une séance à la main."
              pin="edge">
              <Button
                label="Synchroniser Garmin"
                loading={isSyncing}
                onPress={() => syncMutation.mutate()}
              />
              <Button
                label="Ajouter une séance"
                variant="ghost"
                onPress={() => router.push('/add-activity')}
              />
            </EmptyState>
          ) : null}

          {showContent ? (
            <>
              <FitnessCard fitness={fitnessQuery.data} isLoading={fitnessQuery.isLoading} />
              <ActivityList activities={activities} />
            </>
          ) : null}

          <NotificationsCard />
        </ScrollView>

        {showContent ? (
          <View style={styles.footer}>
            <Button
              label="Synchroniser Garmin"
              variant="ghost"
              loading={isSyncing}
              onPress={() => syncMutation.mutate()}
            />
            <Button
              label="Ajouter une séance"
              variant="ghost"
              onPress={() => router.push('/add-activity')}
            />
          </View>
        ) : null}
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
        <ActivityRow
          key={activity.id}
          activity={activity}
          isLast={index === activities.length - 1}
        />
      ))}
    </View>
  );
}

function ActivityRow({ activity, isLast }: { activity: Activity; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const hasDistance = activity.distance_m != null && activity.distance_m > 0;
  const hasDetail =
    activity.manual || hasDistance || activity.avg_hr != null || activity.max_hr != null;

  const deleteMutation = useMutation({
    mutationFn: () => deleteActivity(activity.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['fitness'] });
    },
  });

  return (
    <Pressable
      disabled={!hasDetail}
      onPress={() => setOpen((v) => !v)}
      accessibilityRole={hasDetail ? 'button' : undefined}
      style={[styles.activityRow, isLast && styles.activityRowLast]}>
      <View style={styles.activityRowTop}>
        <View style={styles.activityRowMain}>
          <View style={styles.activityLabelRow}>
            <ThemedText type="default">
              {activityLabel(activity)}
              {hasDetail ? (open ? '  ▾' : '  ▸') : ''}
            </ThemedText>
            {activity.manual ? (
              <ThemedText type="waypointLabel" themeColor="hydro">
                Manuel
              </ThemedText>
            ) : null}
          </View>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {formatDate(activity.start_time)}
          </ThemedText>
        </View>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          {formatDuration(activity.duration_s)}
        </ThemedText>
      </View>

      {open ? (
        <View style={styles.activityDetail}>
          {hasDistance ? (
            <Detail label="Distance" value={formatDistance(activity.distance_m as number)} />
          ) : null}
          {hasDistance ? (
            <Detail
              label="Allure"
              value={formatPace(activity.duration_s, activity.distance_m as number)}
            />
          ) : null}
          {activity.avg_hr != null ? (
            <Detail label="FC moyenne" value={`${activity.avg_hr} bpm`} />
          ) : null}
          {activity.max_hr != null ? (
            <Detail label="FC max" value={`${activity.max_hr} bpm`} />
          ) : null}
          {activity.rpe != null ? (
            <Detail label="Effort (RPE)" value={`${activity.rpe}/10`} />
          ) : null}
          {activity.note ? <Detail label="Note" value={activity.note} /> : null}
          {activity.manual ? (
            <Pressable
              onPress={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              accessibilityRole="button"
              style={styles.deleteButton}>
              <ThemedText type="waypointLabel" themeColor="flare">
                {deleteMutation.isPending ? 'Suppression…' : 'Supprimer cette séance'}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
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
    gap: Spacing.two,
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
  activityList: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 14,
  },
  activityRow: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.contourFaint,
  },
  activityRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityRowMain: {
    gap: Spacing.half,
  },
  activityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  deleteButton: {
    paddingTop: Spacing.two,
    alignSelf: 'flex-start',
  },
  activityDetail: {
    gap: Spacing.half,
    paddingTop: Spacing.two,
    marginTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

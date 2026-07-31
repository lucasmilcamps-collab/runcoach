import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { BackButton } from '@/components/back-button';
import { Icon } from '@/components/icon';
import { ScreenCrest } from '@/components/screen-crest';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { activityLabel } from '@/lib/activity-labels';
import { Activity, listActivities } from '@/lib/api/activities';
import { setSessionLink } from '@/lib/api/plans';
import type { PlanSession, Weekday } from '@/lib/api/plans';
import { pressable } from '@/lib/pressable';

const WINDOW_DAYS = 10;

function dayDiff(iso: string, ref: string): number {
  const a = new Date(iso).getTime();
  const b = new Date(ref).getTime();
  return Math.round((a - b) / 86_400_000);
}

function frDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
}

function frDuration(durationS: number): string {
  const min = Math.round(durationS / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest}`;
}

function frDistance(distanceM: number | null): string | null {
  if (distanceM == null || distanceM <= 0) return null;
  return `${(distanceM / 1000).toFixed(1).replace('.', ',')} km`;
}

export default function LinkActivityScreen() {
  const params = useLocalSearchParams<{
    week?: string;
    day?: string;
    slot?: string;
    sessionDate?: string;
  }>();
  const weekIndex = Number(params.week);
  const day = params.day as Weekday | undefined;
  const slot = (params.slot === 'addon' ? 'addon' : 'primary') as PlanSession['slot'];
  const sessionDate = params.sessionDate;

  const queryClient = useQueryClient();
  const activitiesQuery = useQuery({ queryKey: ['activities'], queryFn: listActivities });

  const mutation = useMutation({
    mutationFn: (activityId: string) =>
      setSessionLink(weekIndex, day as Weekday, activityId, slot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-link', weekIndex, day, slot] });
      queryClient.invalidateQueries({ queryKey: ['plan-progress'] });
      router.back();
    },
  });

  const all = activitiesQuery.data ?? [];
  // Activities recorded near the session's planned date, closest first.
  const candidates = sessionDate
    ? all
        .filter((a) => Math.abs(dayDiff(a.start_time, sessionDate)) <= WINDOW_DAYS)
        .sort(
          (x, y) =>
            Math.abs(dayDiff(x.start_time, sessionDate)) -
            Math.abs(dayDiff(y.start_time, sessionDate)),
        )
    : all;

  const invalid = !weekIndex || !day;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScreenCrest />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <BackButton />

          <View style={styles.header}>
            <ThemedText type="waypointLabel" themeColor="textSecondary">
              Valider la séance
            </ThemedText>
            <ThemedText type="title">Lier une activité</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Choisis l’activité de ta montre qui correspond à cette séance.
            </ThemedText>
          </View>

          {invalid ? (
            <ThemedText type="default" themeColor="flare">
              Séance introuvable.
            </ThemedText>
          ) : activitiesQuery.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={Colors.contour} />
            </View>
          ) : candidates.length === 0 ? (
            <EmptyState
              title="Aucune activité à proximité"
              description="Aucune activité enregistrée autour de cette date. Synchronise Garmin, ou saisis la séance à la main."
              pin="edge">
              <Button label="Saisir à la main" onPress={() => router.replace('/add-activity')} />
            </EmptyState>
          ) : (
            <View style={styles.list}>
              {candidates.map((a) => (
                <ActivityOption
                  key={a.id}
                  activity={a}
                  sessionDate={sessionDate}
                  disabled={mutation.isPending}
                  pending={mutation.isPending && mutation.variables === a.id}
                  onPress={() => mutation.mutate(a.id)}
                />
              ))}
            </View>
          )}

          {!invalid && candidates.length > 0 ? (
            <Button
              label="Aucune ne correspond ? Saisir à la main"
              variant="ghost"
              disabled={mutation.isPending}
              onPress={() => router.replace('/add-activity')}
            />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function ActivityOption({
  activity,
  sessionDate,
  disabled,
  pending,
  onPress,
}: {
  activity: Activity;
  sessionDate?: string;
  disabled: boolean;
  pending: boolean;
  onPress: () => void;
}) {
  const distance = frDistance(activity.distance_m);
  const offset = sessionDate ? dayDiff(activity.start_time, sessionDate) : 0;
  const offsetLabel =
    sessionDate && offset !== 0 ? `${offset > 0 ? '+' : ''}${offset} j vs prévu` : 'Jour prévu';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Lier ${activityLabel(activity)} du ${frDate(activity.start_time)}`}
      style={pressable(styles.option)}>
      <View style={styles.optionMain}>
        <View style={styles.optionTop}>
          <ThemedText type="default">{activityLabel(activity)}</ThemedText>
          {activity.manual ? (
            <ThemedText type="waypointLabel" themeColor="hydro">
              Manuel
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {frDate(activity.start_time)} · {frDuration(activity.duration_s)}
          {distance ? ` · ${distance}` : ''}
        </ThemedText>
        <ThemedText type="waypointLabel" themeColor={offset === 0 ? 'blaze' : 'textSecondary'}>
          {offsetLabel}
        </ThemedText>
      </View>
      {pending ? (
        <ActivityIndicator size="small" color={Colors.blaze} />
      ) : (
        <Icon name="chevron-right" size={20} color={Colors.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.four },
  container: { flex: 1, maxWidth: MaxContentWidth, alignSelf: 'center', width: '100%' },
  scroll: { gap: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.six },
  header: { gap: Spacing.two },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  list: { gap: Spacing.three },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
  },
  optionMain: { flex: 1, gap: Spacing.half },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});

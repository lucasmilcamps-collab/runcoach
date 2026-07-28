import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { activityLabel } from '@/lib/activity-labels';
import { Activity, deleteActivity } from '@/lib/api/activities';
import { pressable } from '@/lib/pressable';

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
    new Date(isoString),
  );
}

/** First-import placeholder shown while a sync runs and there's no data yet. */
export function SyncingCard() {
  return (
    <View style={styles.syncingCard}>
      <ActivityIndicator color={Colors.blaze} />
      <ThemedText type="small" themeColor="textSecondary">
        Ça peut prendre quelques minutes la première fois.
      </ThemedText>
    </View>
  );
}

export function ActivityList({ activities }: { activities: Activity[] }) {
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
      style={pressable([styles.activityRow, isLast && styles.activityRowLast])}>
      <View style={styles.activityRowTop}>
        <View style={styles.activityRowMain}>
          <View style={styles.activityLabelRow}>
            <ThemedText type="default">{activityLabel(activity)}</ThemedText>
            {hasDetail ? (
              <Icon
                name={open ? 'chevron-down' : 'chevron-right'}
                size={16}
                color={Colors.textSecondary}
              />
            ) : null}
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
          {activity.max_hr != null ? <Detail label="FC max" value={`${activity.max_hr} bpm`} /> : null}
          {activity.rpe != null ? <Detail label="Effort (RPE)" value={`${activity.rpe}/10`} /> : null}
          {activity.note ? <Detail label="Note" value={activity.note} /> : null}
          {activity.manual ? (
            <Pressable
              onPress={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel="Supprimer cette séance"
              style={pressable(styles.deleteButton)}>
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
  syncingCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'center',
  },
  activityList: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
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

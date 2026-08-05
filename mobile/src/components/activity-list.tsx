import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SportIcon } from '@/components/sport-icon';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing, typeSize } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { activityLabel } from '@/lib/activity-labels';
import { Activity, deleteActivity } from '@/lib/api/activities';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';
import { makeStyles } from '@/lib/themed-styles';

function formatDuration(durationS: number): string {
  const minutes = Math.round(durationS / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest.toString().padStart(2, '0')}`;
}

function formatDistance(distanceM: number): string {
  return `${(distanceM / 1000).toFixed(2).replace('.', ',')} km`;
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
  const styles = useStyles();
  const theme = useTheme();

  return (
    <View style={styles.syncingCard}>
      <ActivityIndicator color={theme.inkMuted} />
      <ThemedText type="small" themeColor="inkMuted">
        Ça peut prendre quelques minutes la première fois.
      </ThemedText>
    </View>
  );
}

/**
 * The log: one row per activity, divided by rules.
 *
 * A logbook, not a stack of cards — every row is the same kind of thing, and
 * boxing each one made a list of forty objects out of a single table.
 */
export function ActivityList({ activities }: { activities: Activity[] }) {
  const styles = useStyles();

  return (
    <View style={styles.activityList}>
      {activities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </View>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const styles = useStyles();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const hasDistance = activity.distance_m != null && activity.distance_m > 0;
  const hasDetail =
    activity.manual || hasDistance || activity.avg_hr != null || activity.max_hr != null;

  const deleteMutation = useMutation({
    mutationFn: () => deleteActivity(activity.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.activities() });
      queryClient.invalidateQueries({ queryKey: qk.fitness() });
    },
  });

  return (
    <Pressable
      disabled={!hasDetail}
      onPress={() => setOpen((v) => !v)}
      accessibilityRole={hasDetail ? 'button' : undefined}
      accessibilityState={hasDetail ? { expanded: open } : undefined}
      style={pressable(styles.activityRow)}>
      <View style={styles.activityRowTop}>
        {/* The glyph is what lets a log of forty entries be scanned for "which
            of these were runs?" — the sport is named beside it, so it is a
            scanning aid rather than the label. */}
        <SportIcon sport={activity.sport} size={20} />
        <View style={styles.activityRowMain}>
          <View style={styles.activityLabelRow}>
            <ThemedText type="default" numberOfLines={1}>
              {activityLabel(activity)}
            </ThemedText>
            {activity.manual ? (
              <ThemedText type="label" themeColor="inkMuted">
                Manuel
              </ThemedText>
            ) : null}
          </View>
          <ThemedText type="label" themeColor="inkMuted">
            {formatDate(activity.start_time)}
          </ThemedText>
        </View>
        <ThemedText type="figure" style={styles.duration}>
          {formatDuration(activity.duration_s)}
        </ThemedText>
        {hasDetail ? (
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} color={theme.inkMuted} />
        ) : null}
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
              accessibilityLabel="Supprimer cette séance"
              style={pressable(styles.deleteButton)}>
              <ThemedText type="link" themeColor="alerte">
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
  const styles = useStyles();

  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" themeColor="inkMuted">
        {label}
      </ThemedText>
      <ThemedText type="figure" style={styles.detailValue}>
        {value}
      </ThemedText>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  syncingCard: {
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'center',
  },
  activityList: {
    borderBottomWidth: 1,
    borderBottomColor: t.rule,
  },
  activityRow: {
    paddingVertical: Spacing.three,
    // Rule on top of every row: the list closes on its container's own bottom
    // edge instead of leaving a line hanging under the last entry.
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  activityRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
  },
  activityRowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  activityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  duration: {
    fontSize: typeSize(15),
    lineHeight: typeSize(20),
  },
  deleteButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  activityDetail: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
    marginTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: Spacing.three,
  },
  detailValue: {
    fontSize: typeSize(13),
    lineHeight: typeSize(18),
  },
}));

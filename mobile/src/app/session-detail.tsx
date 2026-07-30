import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { G, Path } from 'react-native-svg';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ScreenCrest } from '@/components/screen-crest';
import { SportIcon } from '@/components/sport-icon';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { activityLabel } from '@/lib/activity-labels';
import type { Activity } from '@/lib/api/activities';
import { ApiError } from '@/lib/api/client';
import { pushWorkoutToWatch, WorkoutPushPayload } from '@/lib/api/garmin';
import {
  deleteSession,
  getSessionLink,
  moveSession,
  setSessionDuration,
  setSessionLink,
} from '@/lib/api/plans';
import type { PlanSession, Weekday } from '@/lib/api/plans';
import { pressable } from '@/lib/pressable';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import {
  DAY_LABELS,
  sessionTitle,
  blockZone,
  estimateDistanceKm,
  formatDuration,
  hrIsCeiling,
  sessionDifficulty,
  zoneColor,
  zoneHeightPct,
} from '@/lib/plan-format';

// Minutes offered when retuning a session in place. Coarse on purpose: this is
// "I only have 40 minutes today", not a stopwatch.
const DURATION_CHOICES = [20, 30, 40, 45, 60, 75, 90];

const WEEKDAYS: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

type SessionDetailParam = {
  session: PlanSession;
  weekNumber: number;
  position: number;
  total: number;
  isKey: boolean;
};

function useSessionParam(): SessionDetailParam | null {
  const { s } = useLocalSearchParams<{ s?: string }>();
  if (!s) return null;
  try {
    return JSON.parse(s) as SessionDetailParam;
  } catch {
    return null;
  }
}

function frDistance(km: number): string {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

function frLinkedMeta(a: Activity): string {
  const date = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(a.start_time));
  const min = Math.round(a.duration_s / 60);
  const dur = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;
  const dist =
    a.distance_m && a.distance_m > 0
      ? ` · ${(a.distance_m / 1000).toFixed(1).replace('.', ',')} km`
      : '';
  return `${date} · ${dur}${dist}`;
}

function Bolt({ active }: { active: boolean }) {
  return (
    <Svg width={11} height={15} viewBox="0 0 11 15">
      <Path d="M6 0 0 9h4l-1 6 8-10H6z" fill={active ? Colors.blaze : Colors.contourFaint} />
    </Svg>
  );
}

/** Zone label for the HR side, framed as a ceiling on easy days ("≤ Zx"). */
function hrZoneLabel(type: PlanSession['type'], zone: number): string {
  return hrIsCeiling(type) ? `≤ Z${zone}` : `Z${zone}`;
}

export default function SessionDetailScreen() {
  const data = useSessionParam();
  const paceFirst = usePreferencesStore((s) => s.primaryMetric) === 'pace';
  const pushMutation = useMutation({
    mutationFn: (payload: WorkoutPushPayload) => pushWorkoutToWatch(payload),
  });

  const queryClient = useQueryClient();
  /** Every per-week override changes the same three reads. */
  const invalidatePlan = () => {
    queryClient.invalidateQueries({ queryKey: ['plan'] });
    queryClient.invalidateQueries({ queryKey: ['plan-today'] });
    queryClient.invalidateQueries({ queryKey: ['plan-progress'] });
  };
  const linkQuery = useQuery({
    queryKey: ['session-link', data?.weekNumber, data?.session.day],
    queryFn: () => getSessionLink(data!.weekNumber, data!.session.day),
    enabled: !!data,
    retry: false,
  });
  const unlinkMutation = useMutation({
    mutationFn: () => setSessionLink(data!.weekNumber, data!.session.day, null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-link', data?.weekNumber, data?.session.day] });
      queryClient.invalidateQueries({ queryKey: ['plan-progress'] });
    },
  });
  const [editingDuration, setEditingDuration] = useState(false);
  // Deleting is not undoable until the next replan, so it takes two taps rather
  // than an Alert (which barely exists on react-native-web).
  const [confirmDelete, setConfirmDelete] = useState(false);
  const durationMutation = useMutation({
    mutationFn: (durationMin: number) =>
      setSessionDuration(data!.weekNumber, data!.session.day, data!.session.slot, durationMin),
    onSuccess: () => {
      invalidatePlan();
      router.back(); // the detail param carries the old duration — it's stale now
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteSession(data!.weekNumber, data!.session.day, data!.session.slot),
    onSuccess: () => {
      invalidatePlan();
      router.back(); // the session no longer exists
    },
  });
  const [moving, setMoving] = useState(false);
  const moveMutation = useMutation({
    mutationFn: (toDay: Weekday) => moveSession(data!.weekNumber, data!.session.day, toDay),
    onSuccess: () => {
      invalidatePlan();
      router.back(); // the session now lives on another day — the detail param is stale
    },
  });

  if (!data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.fallback}>
          <ThemedText type="default" themeColor="textSecondary">
            Séance introuvable.
          </ThemedText>
          <Button label="Retour" variant="ghost" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const { session, weekNumber, position, total, isKey } = data;
  const difficulty = sessionDifficulty(session.type);
  const distanceKm = estimateDistanceKm(session.duration_min, session.pace_range);
  const structureTotal = session.structure.reduce((sum, b) => sum + b.duration_min, 0) || 1;

  const paceTarget = session.pace_range
    ? {
        label: 'Allure cible',
        value: `${session.pace_range.min_per_km_low}–${session.pace_range.min_per_km_high} /km`,
      }
    : null;
  const hrTarget =
    session.hr_zone != null
      ? {
          label: hrIsCeiling(session.type) ? 'Plafond FC' : 'Zone FC',
          value: hrZoneLabel(session.type, session.hr_zone),
        }
      : null;
  const targets = (paceFirst ? [paceTarget, hrTarget] : [hrTarget, paceTarget]).filter(
    (t): t is { label: string; value: string } => t != null,
  );

  const pushMessage = (() => {
    if (pushMutation.isSuccess) {
      return 'Séance envoyée — elle apparaîtra sur votre montre à la prochaine synchro Garmin.';
    }
    if (pushMutation.error instanceof ApiError) return pushMutation.error.message;
    if (pushMutation.isError) return 'Envoi impossible. Réessayez.';
    return undefined;
  })();

  const linked = linkQuery.data?.linked ?? null;
  const sessionDate = linkQuery.data?.session_date;

  function openPicker() {
    router.push({
      pathname: '/link-activity',
      params: {
        week: String(weekNumber),
        day: session.day,
        ...(sessionDate ? { sessionDate } : {}),
      },
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <ScreenCrest />
          <View style={styles.topbar}>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              style={pressable(styles.iconBtn)}>
              <Icon name="arrow-left" size={22} />
            </Pressable>
          </View>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Semaine {weekNumber} · Séance {position}/{total}
          </ThemedText>
          <View style={styles.titleRow}>
            <SportIcon sport={session.sport} size={26} color={Colors.text} />
            <ThemedText type="title" style={styles.title}>
              {sessionTitle(session)}
            </ThemedText>
          </View>
          {isKey ? (
            <View style={styles.pill}>
              <View style={styles.pin} />
              <ThemedText type="waypointLabel" themeColor="blaze">
                Séance clé
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/* Stats — the duration is editable in place, so the footer doesn't
            grow another button for it. */}
        <View style={styles.stats}>
          <Pressable
            onPress={() => setEditingDuration((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={`Durée ${formatDuration(session.duration_min)}, modifier`}
            accessibilityState={{ expanded: editingDuration }}
            style={pressable(styles.statPress)}>
            <Stat
              label={editingDuration ? 'Durée · fermer' : 'Durée · modifier'}
              value={formatDuration(session.duration_min)}
            />
          </Pressable>
          {distanceKm != null ? (
            <Stat label="Distance ≈" value={frDistance(distanceKm)} bordered />
          ) : null}
          <Stat label="Difficulté" bordered={distanceKm != null}>
            <View style={styles.bolts}>
              {[0, 1, 2, 3].map((i) => (
                <Bolt key={i} active={i < difficulty} />
              ))}
            </View>
          </Stat>
        </View>

        {editingDuration ? (
          <View style={styles.durationRow}>
            {DURATION_CHOICES.map((d) => (
              <Chip
                key={d}
                label={`${d}`}
                selected={d === session.duration_min}
                disabled={durationMutation.isPending || d === session.duration_min}
                fill
                onPress={() => durationMutation.mutate(d)}
                accessibilityLabel={`Passer à ${d} minutes`}
              />
            ))}
          </View>
        ) : null}

        {/* Linked activity (session validated) */}
        {linked ? (
          <View style={styles.linkedCard}>
            <View style={styles.linkedHead}>
              <ThemedText type="waypointLabel" themeColor="blaze">
                ✓ Séance validée
              </ThemedText>
              <Pressable
                onPress={() => unlinkMutation.mutate()}
                disabled={unlinkMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="Délier l’activité"
                style={pressable(styles.unlink)}>
                <ThemedText type="waypointLabel" themeColor="textSecondary">
                  {unlinkMutation.isPending ? 'Déliaison…' : 'Délier'}
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="default">{activityLabel(linked)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {frLinkedMeta(linked)}
            </ThemedText>
          </View>
        ) : null}

        {/* Description */}
        {session.rationale ? (
          <View style={styles.section}>
            <ThemedText type="default" themeColor="textSecondary">
              {session.rationale}
            </ThemedText>
          </View>
        ) : null}

        {/* Structure */}
        {session.structure.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="waypointLabel" themeColor="textSecondary" style={styles.kicker}>
              Structure
            </ThemedText>

            <View style={styles.strip}>
              {session.structure.map((block, i) => {
                const zone = blockZone(block, session);
                return (
                  <View
                    key={i}
                    style={{
                      width: `${(block.duration_min / structureTotal) * 100}%`,
                      height: `${zoneHeightPct(zone)}%`,
                      backgroundColor: zoneColor(zone),
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      marginRight: i < session.structure.length - 1 ? 3 : 0,
                    }}
                  />
                );
              })}
            </View>

            {session.structure.map((block, i) => {
              const zone = blockZone(block, session);
              const pace = block.pace_range;
              const paceStr = pace ? `${pace.min_per_km_low}–${pace.min_per_km_high} /km` : null;
              const zoneStr = `Zone ${zone}`;
              const subtitle =
                paceFirst && paceStr
                  ? `${paceStr} · ${zoneStr}`
                  : `${zoneStr}${paceStr ? ` · ${paceStr}` : ''}`;
              return (
                <View key={i} style={styles.block}>
                  <View style={[styles.tick, { backgroundColor: zoneColor(zone) }]} />
                  <View style={styles.blockMain}>
                    <ThemedText type="default">{block.label}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {subtitle}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDuration(block.duration_min)}
                  </ThemedText>
                </View>
              );
            })}

            {targets.length > 0 ? (
              <View style={styles.targets}>
                {targets.map((t, idx) => (
                  <Target key={t.label} label={t.label} value={t.value} bordered={idx > 0} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {pushMessage ? (
          <ThemedText
            type="small"
            themeColor={pushMutation.isSuccess ? 'hydro' : 'flare'}
            style={styles.pushMessage}>
            {pushMessage}
          </ThemedText>
        ) : null}
        <Button
          label={linked ? 'Changer l’activité liée' : 'J’ai fait cette séance'}
          onPress={openPicker}
        />

        {/* The two real secondary actions share one compact row. Stacking every
            action as a full-width 52pt block gave four bars of identical weight
            and buried the one commitment among them. */}
        <View style={styles.utilityRow}>
          {session.sport === 'RUN' ? (
            <UtilityAction
              label={pushMutation.isSuccess ? 'Envoyée ✓' : 'Vers ma montre'}
              busy={pushMutation.isPending}
              disabled={pushMutation.isSuccess}
              onPress={() =>
                pushMutation.mutate({
                  session_type: session.type,
                  duration_min: session.duration_min,
                  structure: session.structure,
                  pace_range: session.pace_range,
                  hr_zone: session.hr_zone,
                  rationale: session.rationale,
                  week_number: weekNumber,
                })
              }
            />
          ) : null}
          <UtilityAction
            label={moving ? 'Annuler' : 'Déplacer'}
            selected={moving}
            onPress={() => setMoving((v) => !v)}
          />
          {/* A run is never deletable: losing one breaks the plan's guaranteed
              run count, which is a replan decision. The backend refuses it too —
              this only keeps the control from being offered. */}
          {session.sport !== 'RUN' ? (
            <UtilityAction
              label={confirmDelete ? 'Confirmer ?' : 'Supprimer'}
              danger
              selected={confirmDelete}
              busy={deleteMutation.isPending}
              onPress={() => {
                if (confirmDelete) deleteMutation.mutate();
                else setConfirmDelete(true);
              }}
            />
          ) : null}
        </View>

        {moving ? (
          <View style={styles.moveRow}>
            {WEEKDAYS.map((d) => {
              const current = d === session.day;
              return (
                <Chip
                  key={d}
                  label={DAY_LABELS[d]}
                  selected={current}
                  disabled={moveMutation.isPending || current}
                  fill
                  onPress={() => moveMutation.mutate(d)}
                  accessibilityLabel={
                    current ? `${DAY_LABELS[d]}, jour actuel` : `Déplacer à ${DAY_LABELS[d]}`
                  }
                />
              );
            })}
          </View>
        ) : null}
        {/* No "Voir la semaine" button: it called router.back(), which is
            exactly what the back arrow in the header already does. */}
      </View>
    </SafeAreaView>
  );
}

/** A secondary action in the footer's compact row: ghost, 44pt, sized to share
 * the row. Deliberately lighter than `Button` — the screen's one full-width
 * blaze commitment is "J'ai fait cette séance" (DESIGN.md, The One Blaze Rule). */
function UtilityAction({
  label,
  onPress,
  busy = false,
  disabled = false,
  selected = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** Destructive — carries the flare tone instead of the accent. */
  danger?: boolean;
}) {
  const isDisabled = disabled || busy;
  const accent = danger ? 'flare' : 'blaze';
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy, selected }}
      style={pressable([
        styles.utilityAction,
        selected && styles.utilityActionSelected,
        selected && { borderColor: Colors[accent] },
        danger && !selected && styles.utilityActionDanger,
        isDisabled && styles.utilityActionDisabled,
      ])}>
      {busy ? (
        <ActivityIndicator color={Colors.text} />
      ) : (
        <ThemedText
          type="small"
          themeColor={selected ? accent : isDisabled ? 'textSecondary' : danger ? 'flare' : 'text'}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

function Stat({
  label,
  value,
  bordered,
  children,
}: {
  label: string;
  value?: string;
  bordered?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.stat, bordered && styles.statBordered]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {value ? <ThemedText type="subtitle">{value}</ThemedText> : children}
    </View>
  );
}

function Target({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <View style={[styles.target, bordered && styles.targetBordered]}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="default">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { maxWidth: MaxContentWidth, alignSelf: 'center', width: '100%' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },

  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    overflow: 'hidden',
  },
  topbar: { flexDirection: 'row', marginBottom: Spacing.four },
  iconBtn: {
    // A real 44pt target: hitSlop does not extend the hit area on
    // react-native-web, and this app ships as an installed PWA.
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.contour,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: { marginTop: Spacing.one },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: '#E8792C66',
    backgroundColor: '#E8792C1f',
  },
  pin: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.blaze },

  stats: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  stat: { flex: 1, gap: Spacing.one },
  statBordered: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.contourFaint,
    paddingLeft: Spacing.three,
  },
  bolts: { flexDirection: 'row', gap: 3, alignItems: 'center', height: 24 },

  section: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.four, gap: Spacing.two },
  kicker: { marginBottom: Spacing.two },

  strip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 66,
    marginBottom: Spacing.two,
  },
  block: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  tick: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  blockMain: { flex: 1, gap: Spacing.half },

  targets: {
    flexDirection: 'row',
    marginTop: Spacing.three,
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    overflow: 'hidden',
  },
  target: { flex: 1, padding: Spacing.three, gap: Spacing.half },
  targetBordered: { borderLeftWidth: 1, borderLeftColor: Colors.contourFaint },

  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  pushMessage: {
    paddingBottom: Spacing.one,
  },
  utilityRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  utilityAction: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: Colors.contour,
  },
  utilityActionSelected: {
    borderWidth: 1.5,
    borderColor: Colors.blaze,
    backgroundColor: Colors.backgroundSelected,
  },
  utilityActionDanger: {
    borderColor: Colors.flare,
  },
  utilityActionDisabled: {
    borderColor: Colors.contourFaint,
  },
  statPress: {
    flex: 1,
  },
  durationRow: {
    flexDirection: 'row',
    gap: Spacing.one,
    // The scroll container has no padding of its own — every section applies
    // its own, so this row needs it too or it runs edge to edge.
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  moveRow: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingTop: Spacing.one,
  },
  linkedCard: {
    marginHorizontal: Spacing.four,
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.one,
    borderLeftWidth: 2,
    borderLeftColor: Colors.blaze,
  },
  unlink: {
    // hitSlop is inert on web, so the row carries the 44pt itself.
    minHeight: 44,
    justifyContent: 'center',
  },
  linkedHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
});

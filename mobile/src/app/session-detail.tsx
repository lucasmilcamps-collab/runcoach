import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { IntensityNotch } from '@/components/intensity-notch';
import { BackButton } from '@/components/back-button';
import { SportIcon } from '@/components/sport-icon';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { useTheme, useZoneRamp } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';
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
  skipSession,
} from '@/lib/api/plans';
import type { PlanSession, Weekday } from '@/lib/api/plans';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';
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

/** Zone label for the HR side, framed as a ceiling on easy days ("≤ Zx"). */
function hrZoneLabel(type: PlanSession['type'], zone: number): string {
  return hrIsCeiling(type) ? `≤ Z${zone}` : `Z${zone}`;
}

/** Colour never carries the level on its own — the word beside the notches is
 * what actually says how hard the session is (DESIGN.md). */
const DIFFICULTY_WORDS: Record<number, string> = {
  0: 'Repos',
  1: 'Facile',
  2: 'Modérée',
  3: 'Soutenue',
  4: 'Difficile',
};

/** Backend codes that mean "the Garmin link is broken", not "Garmin hiccuped":
 * retrying the send can never clear them, reconnecting the account can. */
const RECONNECT_CODES = ['GARMIN_NOT_CONNECTED', 'GARMIN_RELOGIN'];

export default function SessionDetailScreen() {
  const theme = useTheme();
  const ramp = useZoneRamp();
  const styles = useStyles();
  const data = useSessionParam();
  const paceFirst = usePreferencesStore((s) => s.primaryMetric) === 'pace';
  const pushMutation = useMutation({
    mutationFn: (payload: WorkoutPushPayload) => pushWorkoutToWatch(payload),
  });

  const queryClient = useQueryClient();
  /** Every per-week override changes the same reads. `plan-overview` is one of
   * them: the detailed adherence screen is computed from the same completions
   * and overrides, so leaving it out left it showing yesterday's answer. */
  const invalidatePlan = () => {
    queryClient.invalidateQueries({ queryKey: qk.plan() });
    queryClient.invalidateQueries({ queryKey: qk.planToday() });
    queryClient.invalidateQueries({ queryKey: qk.planProgress() });
    queryClient.invalidateQueries({ queryKey: qk.planOverview.all() });
  };
  const linkKey = qk.sessionLink(data?.weekNumber, data?.session.day, data?.session.slot);
  const linkQuery = useQuery({
    queryKey: linkKey,
    queryFn: () => getSessionLink(data!.weekNumber, data!.session.day, data!.session.slot),
    enabled: !!data,
  });
  const unlinkMutation = useMutation({
    mutationFn: () => setSessionLink(data!.weekNumber, data!.session.day, null, data!.session.slot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: linkKey });
      queryClient.invalidateQueries({ queryKey: qk.planProgress() });
      queryClient.invalidateQueries({ queryKey: qk.planOverview.all() });
      // Linking changes which sessions the weekly review counts as done, so
      // its verdict is stale the moment a link lands.
      queryClient.invalidateQueries({ queryKey: qk.weeklyReview() });
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
  const skipMutation = useMutation({
    mutationFn: (skipped: boolean) =>
      skipSession(data!.weekNumber, data!.session.day, data!.session.slot, skipped),
    onSuccess: () => {
      invalidatePlan();
      router.back(); // the detail param carries the old flag — it's stale now
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
          <ThemedText type="default" themeColor="inkMuted">
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

  const pushFeedback = (() => {
    if (pushMutation.isSuccess) {
      return {
        text: 'Séance envoyée — elle apparaîtra sur ta montre à la prochaine synchro Garmin.',
        tone: 'recup' as const,
        reconnect: false,
      };
    }
    if (pushMutation.error instanceof ApiError) {
      return {
        text: pushMutation.error.message,
        tone: 'alerte' as const,
        // The two failures no amount of retrying fixes. The backend names them
        // so the screen can offer the way out instead of a dead-end sentence.
        reconnect: RECONNECT_CODES.includes(pushMutation.error.code),
      };
    }
    if (pushMutation.isError) {
      return { text: 'Envoi impossible. Réessaie.', tone: 'alerte' as const, reconnect: false };
    }
    return null;
  })();

  const linked = linkQuery.data?.linked ?? null;
  const sessionDate = linkQuery.data?.session_date;

  function openPicker() {
    router.push({
      pathname: '/link-activity',
      params: {
        week: String(weekNumber),
        day: session.day,
        slot: session.slot,
        ...(sessionDate ? { sessionDate } : {}),
      },
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.topbar}>
            <BackButton />
          </View>
          <ThemedText type="label" themeColor="inkMuted">
            Semaine {weekNumber} · Séance {position}/{total}
          </ThemedText>
          <View style={styles.titleRow}>
            <SportIcon sport={session.sport} size={26} color={theme.ink} />
            <ThemedText type="title" style={styles.title}>
              {sessionTitle(session)}
            </ThemedText>
          </View>
          {/* Both states are stated, not just the key one: on a week that got
              away from you, "which of these can I drop?" is the question this
              screen has to answer without you counting pills across the plan. */}
          <View style={isKey ? styles.pill : styles.pillMuted}>
            <View style={isKey ? styles.pin : styles.pinMuted} />
            <ThemedText type="label" themeColor={isKey ? 'ink' : 'inkMuted'}>
              {isKey ? 'Séance clé' : 'Séance optionnelle'}
            </ThemedText>
          </View>
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
              <IntensityNotch level={difficulty} />
              <ThemedText type="small" themeColor="inkMuted">
                {DIFFICULTY_WORDS[difficulty] ?? '—'}
              </ThemedText>
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
              <ThemedText type="label" themeColor="ink">
                ✓ Séance validée
              </ThemedText>
              <Pressable
                onPress={() => unlinkMutation.mutate()}
                disabled={unlinkMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="Délier l’activité"
                style={pressable(styles.unlink)}>
                <ThemedText type="label" themeColor="inkMuted">
                  {unlinkMutation.isPending ? 'Déliaison…' : 'Délier'}
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="default">{activityLabel(linked)}</ThemedText>
            <ThemedText type="small" themeColor="inkMuted">
              {frLinkedMeta(linked)}
            </ThemedText>
          </View>
        ) : null}

        {/* Description */}
        {session.rationale ? (
          <View style={styles.section}>
            <ThemedText type="default" themeColor="inkMuted">
              {session.rationale}
            </ThemedText>
          </View>
        ) : null}

        {/* Structure */}
        {session.structure.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="label" themeColor="inkMuted" style={styles.kicker}>
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
                      backgroundColor: zoneColor(zone, ramp),
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
                  <View style={[styles.tick, { backgroundColor: zoneColor(zone, ramp) }]} />
                  <View style={styles.blockMain}>
                    <ThemedText type="default">{block.label}</ThemedText>
                    <ThemedText type="small" themeColor="inkMuted">
                      {subtitle}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="inkMuted">
                    {formatDuration(block.duration_min)}
                  </ThemedText>
                </View>
              );
            })}

            {targets.length > 0 ? (
              <View style={styles.targets}>
                {targets.map((target, idx) => (
                  <Target
                    key={target.label}
                    label={target.label}
                    value={target.value}
                    bordered={idx > 0}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {pushFeedback ? (
          <View style={styles.pushMessage}>
            <ThemedText type="small" themeColor={pushFeedback.tone}>
              {pushFeedback.text}
            </ThemedText>
            {pushFeedback.reconnect ? (
              <Pressable
                onPress={() => router.push('/garmin-connect')}
                accessibilityRole="button"
                accessibilityLabel="Reconnecter mon compte Garmin"
                style={pressable(styles.pushAction)}>
                <ThemedText type="label">Reconnecter Garmin</ThemedText>
              </Pressable>
            ) : null}
          </View>
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
          {/* Offered on runs too, unlike deleting: skipping says "not this
              week" without pretending the plan changed. On a key session it
              counts as missed straight away and feeds the replan suggestion. */}
          <UtilityAction
            label={session.skipped ? 'Reprendre' : 'Passer'}
            selected={session.skipped}
            busy={skipMutation.isPending}
            onPress={() => skipMutation.mutate(!session.skipped)}
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
 * primary action is "J'ai fait cette séance" — everything else here is a
 * secondary control and stays a ghost (DESIGN.md). */
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
  /** Destructive — carries the Alerte ink instead of neutral Ink. */
  danger?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const isDisabled = disabled || busy;
  const accent = danger ? 'alerte' : 'ink';
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
        selected && { borderColor: theme[accent] },
        danger && !selected && styles.utilityActionDanger,
        isDisabled && styles.utilityActionDisabled,
      ])}>
      {busy ? (
        <ActivityIndicator color={theme.ink} />
      ) : (
        <ThemedText
          type="small"
          themeColor={selected ? accent : isDisabled ? 'inkMuted' : danger ? 'alerte' : 'ink'}>
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
  const styles = useStyles();
  return (
    <View style={[styles.stat, bordered && styles.statBordered]}>
      <ThemedText type="small" themeColor="inkMuted">
        {label}
      </ThemedText>
      {value ? <ThemedText type="subtitle">{value}</ThemedText> : children}
    </View>
  );
}

function Target({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.target, bordered && styles.targetBordered]}>
      <ThemedText type="label" themeColor="inkMuted">
        {label}
      </ThemedText>
      <ThemedText type="default">{value}</ThemedText>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  safeArea: { flex: 1, backgroundColor: t.surface },
  scroll: { maxWidth: MaxContentWidth, alignSelf: 'center', width: '100%' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },

  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    overflow: 'hidden',
  },
  topbar: { flexDirection: 'row', marginBottom: Spacing.four },
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
  pillMuted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: t.rule,
    backgroundColor: 'transparent',
  },
  pin: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink },
  pinMuted: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.inkMuted },

  stats: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  stat: { flex: 1, gap: Spacing.one },
  statBordered: {
    borderLeftWidth: 1,
    borderLeftColor: t.rule,
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
    borderTopColor: t.rule,
  },
  tick: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  blockMain: { flex: 1, gap: Spacing.half },

  targets: {
    flexDirection: 'row',
    marginTop: Spacing.three,
    backgroundColor: t.raised,
    borderRadius: Rounded.md,
    overflow: 'hidden',
  },
  target: { flex: 1, padding: Spacing.three, gap: Spacing.half },
  targetBordered: { borderLeftWidth: 1, borderLeftColor: t.rule },

  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: t.rule,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  pushMessage: {
    paddingBottom: Spacing.one,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  pushAction: {
    paddingVertical: Spacing.one,
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
    borderColor: t.ruleStrong,
  },
  utilityActionSelected: {
    borderWidth: 1.5,
    borderColor: t.ink,
    backgroundColor: t.inset,
  },
  utilityActionDanger: {
    borderColor: t.alerte,
  },
  utilityActionDisabled: {
    borderColor: t.rule,
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
    backgroundColor: t.goWash,
    borderRadius: Rounded.sm,
    // A completed session is a Go state — the one thing colour is for here —
    // stated with a hairline and a wash rather than a heavy coloured rail.
    borderLeftWidth: 1,
    borderLeftColor: t.go,
    padding: Spacing.three,
    gap: Spacing.one,
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
}));

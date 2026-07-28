import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { G, Path } from 'react-native-svg';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api/client';
import { pushWorkoutToWatch, WorkoutPushPayload } from '@/lib/api/garmin';
import type { PlanSession } from '@/lib/api/plans';
import { pressable } from '@/lib/pressable';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import {
  SESSION_LABELS,
  blockZone,
  estimateDistanceKm,
  formatDuration,
  hrIsCeiling,
  sessionDifficulty,
  zoneColor,
  zoneHeightPct,
} from '@/lib/plan-format';

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

function Bolt({ active }: { active: boolean }) {
  return (
    <Svg width={11} height={15} viewBox="0 0 11 15">
      <Path d="M6 0 0 9h4l-1 6 8-10H6z" fill={active ? Colors.blaze : Colors.contourFaint} />
    </Svg>
  );
}

function ContourTexture() {
  return (
    <View pointerEvents="none" style={styles.texture}>
      <Svg width={220} height={180} viewBox="0 0 220 180" fill="none">
        <G stroke={Colors.contour} strokeWidth={1} fill="none">
          <Path
            d="M30 90 C25 45 80 15 130 22 C185 30 215 70 205 115 C196 158 130 175 80 160 C40 148 35 120 30 90Z"
            opacity={0.32}
          />
          <Path
            d="M60 92 C56 60 95 40 135 47 C172 54 190 82 182 112 C174 143 128 154 90 143 C62 135 63 116 60 92Z"
            opacity={0.22}
          />
        </G>
      </Svg>
    </View>
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <ContourTexture />
          <View style={styles.topbar}>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              hitSlop={8}
              style={pressable(styles.iconBtn)}>
              <ThemedText type="default">←</ThemedText>
            </Pressable>
          </View>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Semaine {weekNumber} · Séance {position}/{total}
          </ThemedText>
          <ThemedText type="title" style={styles.title}>
            {SESSION_LABELS[session.type]}
          </ThemedText>
          {isKey ? (
            <View style={styles.pill}>
              <View style={styles.pin} />
              <ThemedText type="waypointLabel" themeColor="blaze">
                Séance clé
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/* Stats */}
        <View style={styles.stats}>
          <Stat label="Durée" value={formatDuration(session.duration_min)} />
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
          label="J’ai fait cette séance"
          onPress={() =>
            router.push({
              pathname: '/add-activity',
              params: { sport: session.sport, duration: String(session.duration_min) },
            })
          }
        />
        {session.sport === 'RUN' ? (
          <Button
            label={pushMutation.isSuccess ? 'Envoyée sur Garmin ✓' : 'Envoyer vers ma montre'}
            variant="ghost"
            loading={pushMutation.isPending}
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
        <Button label="Voir la semaine" variant="ghost" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
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
  texture: { position: 'absolute', right: -40, top: -30, opacity: 0.5 },
  topbar: { flexDirection: 'row', marginBottom: Spacing.four },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.contour,
    alignItems: 'center',
    justifyContent: 'center',
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
});

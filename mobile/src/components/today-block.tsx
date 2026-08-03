import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SportIcon } from '@/components/sport-icon';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PlanSession, TodaySession } from '@/lib/api/plans';
import { estimateDistanceKm, formatDuration, frKm, hrIsCeiling, sessionTitle } from '@/lib/plan-format';
import { pressable } from '@/lib/pressable';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The first of Accueil's three blocks, and the question a home screen exists to
 * answer: *qu'est-ce que je fais aujourd'hui ?*
 *
 * The session leads — named, at Subtitle scale, with its duration as a Figure
 * beside it. Everything else on the screen (the week's shape, the one
 * arbitration to make) is context for this line, so nothing competes with it
 * here: no ring, no stat row, no second call to action.
 *
 * The Go tick appears only when the plan itself marked the session as key. It is
 * a read-out, not decoration, and the row's own tap target is the session, not
 * the tick (DESIGN.md, The Signal Is Never A Command).
 */
export function TodayBlock({ today }: { today: TodaySession | undefined }) {
  const styles = useStyles();
  const theme = useTheme();
  const primaryMetric = usePreferencesStore((state) => state.primaryMetric);

  const session = today?.sessions[0] ?? null;
  const adjustment = today?.adjustment ?? null;
  const adjusted = adjustment?.adjusted ?? false;

  // The engine only ever downgrades a session, and only for a reason it can
  // state (plan_adaptation). When it has, the adjusted type is what the athlete
  // should actually do today — so that is what this block names.
  const shownType = adjusted ? adjustment!.suggested_type : (session?.type ?? 'easy');
  const isKey = session?.priority === 'key' && !adjusted;

  if (!today?.has_plan) {
    return (
      <View style={styles.block}>
        <ThemedText type="label" themeColor="inkMuted">
          Aujourd’hui
        </ThemedText>
        <ThemedText type="subtitle">Pas encore de plan</ThemedText>
        <ThemedText type="small" themeColor="inkMuted">
          Fixe un objectif et Relay construira la semaine autour de tes autres sports.
        </ThemedText>
      </View>
    );
  }

  if (!today.has_session || !session) {
    return (
      <View style={styles.block}>
        <View style={styles.head}>
          <ThemedText type="label" themeColor="inkMuted">
            Aujourd’hui
          </ThemedText>
          <View style={[styles.tick, { backgroundColor: theme.recup }]} />
        </View>
        <ThemedText type="subtitle">Repos</ThemedText>
        <ThemedText type="small" themeColor="inkMuted">
          {today.message ?? 'Rien de prévu — c’est ce qui fait tenir le reste de la semaine.'}
        </ThemedText>
      </View>
    );
  }

  const distanceKm = estimateDistanceKm(session.duration_min, session.pace_range);

  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <ThemedText type="label" themeColor="inkMuted">
          Aujourd’hui
        </ThemedText>
        {isKey ? (
          <View style={styles.keyTag}>
            <View style={[styles.tick, { backgroundColor: theme.go }]} />
            <ThemedText type="label" style={{ color: theme.go }}>
              Séance clé
            </ThemedText>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={() => router.push('/plan')}
        accessibilityRole="button"
        accessibilityLabel={`${sessionTitle({ sport: session.sport, type: shownType })}, ${formatDuration(session.duration_min)}. Voir la séance.`}
        style={pressable(styles.row)}>
        <SportIcon sport={session.sport} size={22} color={theme.inkMuted} />
        <View style={styles.rowText}>
          <ThemedText type="subtitle" numberOfLines={2}>
            {sessionTitle({ sport: session.sport, type: shownType })}
          </ThemedText>
          <ThemedText type="small" themeColor="inkMuted">
            {targetLine(session, primaryMetric, distanceKm)}
          </ThemedText>
        </View>
        <ThemedText type="figure" style={styles.duration}>
          {formatDuration(session.duration_min)}
        </ThemedText>
        <Icon name="chevron-right" size={20} color={theme.inkMuted} />
      </Pressable>

      {/* An adjustment the athlete can't audit is one they will override, so the
          engine's reason is shown verbatim rather than summarised into "adapté
          à ta forme". */}
      {adjusted ? (
        <View style={[styles.note, { borderColor: theme.prudence, backgroundColor: theme.prudenceWash }]}>
          <ThemedText type="small" themeColor="ink">
            {adjustment!.reason}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

/** What the session asks for, in the unit the athlete reads it in. Distance is
 * derived from the target pace, so it only appears when there is one. */
function targetLine(
  session: PlanSession,
  primaryMetric: 'pace' | 'hr',
  distanceKm: number | null,
): string {
  const zone =
    session.hr_zone != null
      ? `${hrIsCeiling(session.type) ? '≤ Z' : 'Z'}${session.hr_zone}`
      : null;
  const pace = session.pace_range
    ? `${session.pace_range.min_per_km_low}–${session.pace_range.min_per_km_high} /km`
    : null;

  const ordered = primaryMetric === 'hr' ? [zone, pace] : [pace, zone];
  const parts = ordered.filter(Boolean) as string[];
  if (distanceKm != null) parts.push(`≈ ${frKm(distanceKm)} km`);
  return parts.length > 0 ? parts.join(' · ') : 'À l’allure du jour.';
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  keyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  tick: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
    paddingVertical: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  duration: {
    fontSize: 16,
    lineHeight: 22,
  },
  note: {
    borderLeftWidth: 1,
    borderRadius: Rounded.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
}));

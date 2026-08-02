import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DetailScreen } from '@/components/detail-screen';
import { PlanAdherenceGrid } from '@/components/plan-adherence-grid';
import { StatTiles } from '@/components/stat-tiles';
import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { getPlanOverview } from '@/lib/api/plans';
import type { PlanOverview, WeekAdherence } from '@/lib/api/plans';
import { weekRangeLabel } from '@/lib/plan-overview';
import { qk } from '@/lib/query-keys';

// The recent window: enough weeks to be a trend, few enough to still be recent.
const RecentWeeks = 4;

export default function PlanRegularityScreen() {
  const { version } = useLocalSearchParams<{ version: string }>();
  const versionNumber = Number(version);

  const query = useQuery({
    queryKey: qk.planOverview.byVersion(versionNumber),
    queryFn: () => getPlanOverview(versionNumber),
    enabled: Number.isFinite(versionNumber),
  });

  return (
    <DetailScreen
      kicker={`Plan ${version}`}
      title="Régularité"
      blurb="Ce que le plan demandait semaine par semaine, et ce qui a réellement été couru. Séances de course clés uniquement — une séance optionnelle sautée n’est pas un manquement.">
      {query.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.contour} />
        </View>
      ) : query.isError || !query.data ? (
        <ThemedText type="default" themeColor="flare">
          Impossible de charger la régularité de ce plan.
        </ThemedText>
      ) : (
        <Body overview={query.data} />
      )}
    </DetailScreen>
  );
}

function Body({ overview }: { overview: PlanOverview }) {
  const elapsed = overview.weeks.filter((w) => w.is_past);
  const recent = elapsed.slice(-RecentWeeks);
  const recentPlanned = sum(recent, (w) => w.planned);
  const recentCompleted = sum(recent, (w) => w.completed);
  const remaining = sum(
    overview.weeks.filter((w) => !w.is_past),
    (w) => w.planned,
  );

  return (
    <>
      <View style={styles.card}>
        <StatTiles
          stats={[
            {
              label: 'Générale',
              value: overview.planned > 0 ? `${pct(overview.completed, overview.planned)}%` : '—',
              hint: `${overview.completed} sur ${overview.planned} depuis le début`,
            },
            {
              label: 'Récente',
              // "—" and not "0%": no elapsed week means nothing was measured,
              // which is a different statement from "you did none of it".
              value: recentPlanned > 0 ? `${pct(recentCompleted, recentPlanned)}%` : '—',
              hint: `sur les ${Math.min(RecentWeeks, elapsed.length) || RecentWeeks} dernières semaines`,
            },
            {
              label: 'Moyenne',
              value:
                elapsed.length > 0
                  ? (overview.completed / elapsed.length).toFixed(1).replace('.', ',')
                  : '—',
              unit: 'séances/sem.',
              hint: 'sur les semaines terminées',
            },
            {
              label: 'Restantes',
              value: `${remaining}`,
              unit: 'séances clés',
              hint: 'jusqu’à la fin du plan',
            },
          ]}
        />
      </View>

      <View style={styles.card}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Vue d’ensemble
        </ThemedText>
        <PlanAdherenceGrid weeks={overview.weeks} />
      </View>

      <View style={styles.card}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Semaine par semaine
        </ThemedText>
        {overview.weeks.map((week, position) => (
          <WeekRow
            key={week.week_index}
            week={week}
            range={weekRangeLabel(overview.start_date, position)}
          />
        ))}
      </View>
    </>
  );
}

function WeekRow({ week, range }: { week: WeekAdherence; range: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <ThemedText type="default" themeColor={week.is_current ? 'text' : 'textSecondary'}>
          Semaine {week.week_index}
          {week.is_deload ? ' · Décharge' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {range}
        </ThemedText>
      </View>
      {/* Weeks that haven't happened show their plan, not a score: "0/3" on a
          week three months out reads as a failure that hasn't had a chance to
          occur. */}
      {week.is_past || week.is_current ? (
        <ThemedText type="default">
          {week.completed}/{week.planned}
        </ThemedText>
      ) : (
        <ThemedText type="default" themeColor="textSecondary">
          {week.planned} prévues
        </ThemedText>
      )}
    </View>
  );
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

function pct(part: number, whole: number): number {
  return Math.round((part / whole) * 100);
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
    paddingTop: Spacing.two,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
});

import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { Icon } from '@/components/icon';
import { PlanAdherenceGrid } from '@/components/plan-adherence-grid';
import { PlanPhaseBar } from '@/components/plan-phase-bar';
import { PlanVolumeChart } from '@/components/plan-volume-chart';
import { ScreenCrest } from '@/components/screen-crest';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { getPlanOverview, getPlanVersion } from '@/lib/api/plans';
import type { Plan, PlanOverview } from '@/lib/api/plans';
import { frKm } from '@/lib/plan-format';
import { phaseSpans, runsPerWeek, weeklyVolume } from '@/lib/plan-overview';
import { pressable } from '@/lib/pressable';

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export default function PlanVersionScreen() {
  const { version } = useLocalSearchParams<{ version: string }>();
  const versionNumber = Number(version);
  const enabled = Number.isFinite(versionNumber);

  const planQuery = useQuery({
    queryKey: ['plan-version', versionNumber],
    queryFn: () => getPlanVersion(versionNumber),
    enabled,
    retry: false,
  });
  // Split from the plan itself on purpose: the plan document says what was
  // asked, this says where its weeks land on the calendar and what was actually
  // run. Only the second needs the server.
  const overviewQuery = useQuery({
    queryKey: ['plan-overview', versionNumber],
    queryFn: () => getPlanOverview(versionNumber),
    enabled,
    retry: false,
  });

  const plan = planQuery.data?.plan ?? null;
  const overview = overviewQuery.data ?? null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenCrest />
        <View style={styles.topbar}>
          <BackButton />
        </View>
        <View style={styles.header}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Mes plans
          </ThemedText>
          <ThemedText type="title">Plan {version}</ThemedText>
        </View>

        {planQuery.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.contour} />
          </View>
        ) : planQuery.isError || !plan ? (
          <ThemedText type="default" themeColor="flare">
            Impossible de charger ce plan.
          </ThemedText>
        ) : (
          <>
            <GoalCard plan={plan} response={planQuery.data} overview={overview} />
            <RegularityCard
              overview={overview}
              isLoading={overviewQuery.isLoading}
              version={versionNumber}
            />
            <VolumeCard plan={plan} overview={overview} version={versionNumber} />
            <CyclesCard plan={plan} overview={overview} version={versionNumber} />
            <SettingsCard plan={plan} overview={overview} version={versionNumber} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({
  title,
  blurb,
  detail,
  children,
}: {
  title: string;
  blurb: string;
  /** Where "Voir le détail" goes. A card that has more behind it says so in the
   * same place every time, at the bottom, rather than hiding a tap target
   * somewhere in its content. */
  detail?: { pathname: string; version: number; label: string };
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {blurb}
        </ThemedText>
      </View>
      {children}
      {detail ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: detail.pathname as never,
              params: { version: String(detail.version) },
            })
          }
          accessibilityRole="button"
          accessibilityLabel={detail.label}
          style={pressable(styles.link)}>
          <ThemedText type="link" themeColor="text">
            Voir le détail
          </ThemedText>
          <Icon name="chevron-right" size={20} color={Colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The one figure a card is answering, with its unit.
 *
 * `subtitle`, not `title`: the 28px step belongs to the loudest element of a
 * screen, and there is exactly one. Used here it tied with "Plan 3" at the top
 * of the page — a card's number shouting as loud as the page's name — and it
 * also made this 80% *bigger* than the same 80% on its own detail screen, which
 * inverts the hierarchy between a summary and the depth behind it. */
function Hero({ value, unit }: { value: string; unit?: string }) {
  return (
    <View style={styles.hero}>
      <ThemedText type="subtitle">{value}</ThemedText>
      {unit ? (
        <ThemedText type="small" themeColor="textSecondary">
          {unit}
        </ThemedText>
      ) : null}
    </View>
  );
}

function GoalCard({
  plan,
  response,
  overview,
}: {
  plan: Plan;
  response: { estimated_time_min: number | null; projected_time_min: number | null } | undefined;
  overview: PlanOverview | null;
}) {
  const estimated = response?.estimated_time_min ?? null;
  const projected = response?.projected_time_min ?? null;

  return (
    <Card title="Objectif" blurb="Ce que ce plan visait, et le chrono qu’il projetait.">
      <ThemedText type="subtitle">{plan.goal.description}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {[
          plan.goal.distance_km ? `${frKm(plan.goal.distance_km)} km` : null,
          plan.goal.race_date ? formatDate(plan.goal.race_date) : null,
          overview ? `${overview.weeks_total} semaines` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
      {estimated != null ? (
        <View style={styles.chrono}>
          <Chrono label="Départ" value={fmtTime(estimated)} />
          {/* An arrow, not a chevron: a chevron means "tap to go there" all over
              this app, and nothing here is tappable. */}
          <ThemedText type="subtitle" themeColor="textSecondary">
            →
          </ThemedText>
          <Chrono label="Projeté" value={projected != null ? fmtTime(projected) : '—'} bright />
        </View>
      ) : null}
    </Card>
  );
}

function Chrono({ label, value, bright }: { label: string; value: string; bright?: boolean }) {
  return (
    <View style={styles.chronoItem}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle" themeColor={bright ? 'text' : 'textSecondary'}>
        {value}
      </ThemedText>
    </View>
  );
}

function RegularityCard({
  overview,
  isLoading,
  version,
}: {
  overview: PlanOverview | null;
  isLoading: boolean;
  version: number;
}) {
  if (isLoading) {
    return (
      <View style={[styles.card, styles.centered]}>
        <ActivityIndicator color={Colors.contour} />
      </View>
    );
  }
  if (!overview || overview.weeks.length === 0) return null;

  // Nothing has elapsed yet — a 0% on a plan that hasn't started is a score
  // nobody earned, so the card states the situation instead of grading it.
  const notStarted = overview.planned === 0;
  const pct = notStarted ? 0 : Math.round((overview.completed / overview.planned) * 100);

  return (
    <Card
      title="Régularité"
      blurb="C’est la constance qui construit la forme, pas la séance parfaite."
      detail={{
        pathname: '/plan-regularity/[version]',
        version,
        label: 'Voir le détail de la régularité',
      }}>
      {notStarted ? (
        <ThemedText type="default" themeColor="textSecondary">
          Aucune semaine terminée pour l’instant.
        </ThemedText>
      ) : (
        <View style={styles.heroRow}>
          <Hero value={`${pct}%`} />
          <ThemedText type="small" themeColor="textSecondary">
            {overview.completed} séances clés sur {overview.planned}
          </ThemedText>
        </View>
      )}
      <PlanAdherenceGrid weeks={overview.weeks} />
    </Card>
  );
}

function VolumeCard({
  plan,
  overview,
  version,
}: {
  plan: Plan;
  overview: PlanOverview | null;
  version: number;
}) {
  const weeks = weeklyVolume(plan);
  const peak = Math.max(...weeks.map((w) => w.km), 0);
  // Every run in this plan is prescribed in minutes with no target pace, so
  // there is no distance to derive — an all-zero chart would say the plan has
  // no volume, which is the opposite of true.
  if (peak <= 0) return null;

  return (
    <Card
      title="Volume"
      blurb="Comment la charge de course monte au fil des semaines."
      detail={{ pathname: '/plan-volume/[version]', version, label: 'Voir le détail du volume' }}>
      <View style={styles.heroRow}>
        <Hero value={frKm(peak)} unit="km au pic hebdo" />
      </View>
      <PlanVolumeChart weeks={weeks} weekCurrent={overview?.week_current ?? null} />
    </Card>
  );
}

function CyclesCard({
  plan,
  overview,
  version,
}: {
  plan: Plan;
  overview: PlanOverview | null;
  version: number;
}) {
  const phases = phaseSpans(plan);
  if (phases.length === 0) return null;

  return (
    <Card
      title="Cycles"
      blurb="Des blocs successifs, chacun avec un travail à lui."
      detail={{ pathname: '/plan-cycles/[version]', version, label: 'Voir le détail des cycles' }}>
      {overview?.week_current != null ? (
        <ThemedText type="default">
          Semaine {overview.week_current} sur {overview.weeks_total}
        </ThemedText>
      ) : null}
      <PlanPhaseBar phases={phases} weekCurrent={overview?.week_current ?? null} />
    </Card>
  );
}

function SettingsCard({
  plan,
  overview,
  version,
}: {
  plan: Plan;
  overview: PlanOverview | null;
  version: number;
}) {
  const runs = runsPerWeek(plan);

  return (
    <Card title="Le plan" blurb="Son cadre, et le détail de chaque séance.">
      {runs ? (
        <Row
          label="Courses par semaine"
          value={runs.min === runs.max ? `${runs.min}` : `${runs.min} à ${runs.max}`}
        />
      ) : null}
      {overview ? <Row label="Début" value={formatDate(overview.start_date)} /> : null}
      {overview ? <Row label="Fin" value={formatDate(overview.end_date)} /> : null}
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/plan-sessions/[version]',
            params: { version: String(version) },
          })
        }
        accessibilityRole="button"
        accessibilityLabel="Voir toutes les séances de ce plan"
        style={pressable(styles.link)}>
        <ThemedText type="link" themeColor="text">
          Voir toutes les séances
        </ThemedText>
        <Icon name="chevron-right" size={20} color={Colors.textSecondary} />
      </Pressable>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="default" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="default">{value}</ThemedText>
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
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  topbar: { flexDirection: 'row' },
  header: { gap: Spacing.two },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  cardHead: {
    gap: Spacing.half,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.three,
    flexWrap: 'wrap',
  },
  chrono: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  chronoItem: {
    gap: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 32,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // 44pt for real — hitSlop doesn't apply on web, and this ships as a PWA.
    minHeight: 44,
    marginTop: Spacing.one,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
});

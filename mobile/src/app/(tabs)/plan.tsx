import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CardColumns } from '@/components/card-columns';
import { EmptyState } from '@/components/empty-state';
import { GenerationProgress } from '@/components/generation-progress';
import { Icon } from '@/components/icon';
import { OfflineBanner } from '@/components/offline-banner';
import { PlanWeekPager } from '@/components/plan-view';
import { RegenerateButton } from '@/components/regenerate-button';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { WeeklyOverview } from '@/components/weekly-overview';
import { WeeklyReviewCard } from '@/components/weekly-review-card';
import { MaxContentWidthWide, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';
import { listActivities } from '@/lib/api/activities';
import { ApiError } from '@/lib/api/client';
import {
  EstimateSource,
  getCurrentPlan,
  getPlanProgress,
  PlanProgress,
  PlanResponse,
  replanPlan,
} from '@/lib/api/plans';
import { getWeeklyReview } from '@/lib/api/reviews';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';
import { usePlanGeneration } from '@/lib/use-plan-generation';
import { useCompactHeader } from '@/hooks/use-compact-header';
import { useTabScrollPadding } from '@/hooks/use-tab-scroll-padding';
import { useAuthStore } from '@/lib/stores/auth-store';
import { computeWeekProgress, currentWeekRangeLabel, findWeek } from '@/lib/week-progress';

export default function PlanScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const query = useQuery({
    queryKey: qk.plan(),
    queryFn: getCurrentPlan,
  });
  const progressQuery = useQuery({
    queryKey: qk.planProgress(),
    queryFn: getPlanProgress,
  });
  const reviewQuery = useQuery({
    queryKey: qk.weeklyReview(),
    queryFn: getWeeklyReview,
  });
  const bottomPad = useTabScrollPadding();
  const { compact, onScroll } = useCompactHeader();
  const garminConnected = useAuthStore((s) => s.garminConnected);
  const activitiesQuery = useQuery({
    queryKey: qk.activities(),
    queryFn: listActivities,
    enabled: garminConnected,
  });

  // Replan, not regenerate: the objective comes from the active plan server-side
  // and the weeks already under way are frozen. Rebuilding from the objective up
  // is what plan-setup does, and it stays there.
  const replan = usePlanGeneration<void>(replanPlan);

  const noPlan = query.error instanceof ApiError && query.error.status === 404;
  const ready = query.data?.status === 'ready';

  const plan = query.data?.plan ?? null;
  const weekCurrent = progressQuery.data?.week_current ?? null;
  const weekProgress = computeWeekProgress(
    activitiesQuery.data ?? [],
    findWeek(plan, weekCurrent),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <TopBar subtitle={ready ? currentWeekRangeLabel() : undefined} compact={compact} />
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>

          {/* Above everything: this screen is the one read at 6am with no
              network, and the age of what's below it is the first thing to
              know. */}
          <OfflineBanner />

          {/* Not tied to the replan banner below: after the PWA is reloaded
              mid-generation this is the screen the user lands on, and the hook
              picks the job back up here. Without this, a generation that is
              still running would show nothing at all. */}
          <GenerationProgress phase={replan.phase} elapsedSeconds={replan.elapsedSeconds} />

          {/* A replan can be legitimately refused — nothing left after the week
              under way, no active plan — and the server says why. Without this
              the tap just did nothing, which reads as a broken button. */}
          {replan.errorMessage ? (
            <ThemedText type="small" themeColor="alerte">
              {replan.errorMessage}
            </ThemedText>
          ) : null}

          {/* Not gated on `ready` any more. This is the way to restoring a past
              version, and it was hidden in exactly the state where something had
              just gone wrong — leaving a screen with no action at all. */}
          {query.data ? (
            <View style={styles.historyRow}>
              <Pressable
                onPress={() => router.push('/plan-history')}
                accessibilityRole="button"
                accessibilityLabel="Mes plans — le plan actif et les précédents"
                style={pressable(styles.historyLink)}>
                <ThemedText type="label" themeColor="ink">
                  Mes plans
                </ThemedText>
                <Icon name="chevron-right" size={16} color={theme.ink} />
              </Pressable>
            </View>
          ) : null}

          {/* A failed attempt no longer replaces the plan, so the plan below is
              intact — but saying nothing would read as "my request went
              through". The reason, and one tap to try again. */}
          {query.data?.last_generation_error ? (
            <View style={styles.failureBanner}>
              <ThemedText type="label" themeColor="alerte">
                La dernière génération a échoué
              </ThemedText>
              <ThemedText type="small" themeColor="inkMuted">
                {query.data.last_generation_error} Ton plan actuel est intact.
              </ThemedText>
              {ready ? (
                <RegenerateButton
                  onConfirm={() => replan.generate()}
                  isRegenerating={replan.isGenerating}
                />
              ) : null}
            </View>
          ) : null}

          {/* The week that ended, above the replan banner: it explains *why* a
              replan is being suggested, so it should be read first. Both share
              the one generation path — a second one would let the two disagree
              about what regenerating means. */}
          {reviewQuery.data?.has_plan ? (
            <WeeklyReviewCard
              review={reviewQuery.data}
              onReplan={() => replan.generate()}
              isReplanning={replan.isGenerating}
              canReplan={ready}
            />
          ) : null}

          {progressQuery.data?.replan_suggested && ready ? (
            <ReplanBanner
              progress={progressQuery.data}
              onReplan={() => replan.generate()}
              isReplanning={replan.isGenerating}
            />
          ) : null}

          {/* Weekly overview + chrono forecast pair up on wide viewports. */}
          {ready ? (
            <CardColumns>
              {[
                <WeeklyOverview key="overview" progress={weekProgress} />,
                query.data?.estimated_time_min != null ? (
                  <ForecastCard
                    key="forecast"
                    estimated={query.data.estimated_time_min}
                    projected={query.data.projected_time_min}
                    confidence={query.data.estimated_time_confidence}
                    source={query.data.estimated_time_source}
                  />
                ) : null,
              ].filter(Boolean)}
            </CardColumns>
          ) : null}

          {ready && query.data?.feasibility_warning ? (
            <View style={styles.warnBanner}>
              <ThemedText type="label" themeColor="prudence">
                Objectif ambitieux
              </ThemedText>
              <ThemedText type="small" themeColor="inkMuted">
                {query.data.feasibility_warning}
              </ThemedText>
            </View>
          ) : null}

          {query.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.ruleStrong} />
            </View>
          ) : noPlan ? (
            <EmptyPlan />
          ) : query.isError ? (
            <ThemedText type="default" themeColor="alerte">
              Impossible de charger ton plan. Réessaie.
            </ThemedText>
          ) : query.data ? (
            <PlanBody response={query.data} currentWeek={progressQuery.data?.week_current ?? null} />
          ) : null}

          {query.data?.status === 'ready' ? <PlanActions /> : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function PlanActions() {
  const styles = useStyles();
  return (
    <View style={styles.actions}>
      <Button
        label="Modifier l’objectif"
        variant="ghost"
        style={styles.actionBtn}
        onPress={() => router.push('/plan-setup')}
      />
      <Button
        label="Signaler une gêne"
        variant="ghost"
        style={styles.actionBtn}
        onPress={() => router.push('/injury-report')}
      />
    </View>
  );
}

function ReplanBanner({
  progress,
  onReplan,
  isReplanning,
}: {
  progress: PlanProgress;
  onReplan: () => void;
  isReplanning: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.replanBanner}>
      <ThemedText type="label" themeColor="prudence">
        Plan à réajuster
      </ThemedText>
      <ThemedText type="small" themeColor="inkMuted">
        {progress.replan_reason ?? 'Ton plan mérite un réajustement.'} Replanifier la suite à partir
        de ta forme actuelle ?
      </ThemedText>
      <RegenerateButton onConfirm={onReplan} isRegenerating={isReplanning} />
    </View>
  );
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

/** How much weight to give the estimate, in words rather than a jargon label.
 * Phrased as what it depends on, because that is the actionable part: a "faible"
 * that doesn't say why leaves the athlete no way to improve it. */
const CONFIDENCE_NOTE: Record<'high' | 'medium' | 'low', string> = {
  high: 'Estimation fiable : basée sur un effort récent proche de ta distance cible.',
  medium: 'Estimation indicative : l’effort de référence est plus court que ta distance cible.',
  low: 'Estimation peu fiable : elle extrapole un effort bien plus court que ta distance cible. Une sortie longue ou une course enregistrée à part la fiabilisera.',
};

function ForecastCard({
  estimated,
  projected,
  confidence,
  source,
}: {
  estimated: number;
  projected: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  source: EstimateSource | null;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const improves = projected != null && projected < estimated;
  return (
    <View style={styles.forecastCard}>
      <ThemedText type="label" themeColor="inkMuted">
        Prévision de chrono
      </ThemedText>
      <View style={styles.forecastRow}>
        <View style={styles.forecastCol}>
          <ThemedText type="label" themeColor="inkMuted">
            Actuel estimé
          </ThemedText>
          <ThemedText type="subtitle">{fmtTime(estimated)}</ThemedText>
        </View>
        <Icon name="chevron-right" size={20} color={theme.inkMuted} />
        <View style={styles.forecastCol}>
          <ThemedText type="label" themeColor="inkMuted">
            Fin de plan
          </ThemedText>
          <ThemedText type="subtitle" themeColor={improves ? 'ink' : 'inkMuted'}>
            {projected != null ? fmtTime(projected) : '—'}
          </ThemedText>
        </View>
      </View>
      {/* Not a colour: confidence is not a training-load state, and DESIGN.md
          keeps go/prudence/recup for load alone. Muted prose is the honest
          register anyway — this qualifies a number, it doesn't alarm. */}
      {confidence ? (
        <ThemedText type="small" themeColor="inkMuted">
          {CONFIDENCE_NOTE[confidence]}
        </ThemedText>
      ) : null}
      {/* Where the number came from. The estimate was 22 minutes out because a
          whole test session — warm-up and cool-down included — was extrapolated
          as if it were the effort, and nothing on screen said so. */}
      {source ? (
        <ThemedText type="small" themeColor="inkMuted">
          {sourceLabel(source)}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** "Basée sur ton effort de 2,0 km à 4:32/km, il y a 3 jours." */
function sourceLabel(source: EstimateSource): string {
  const what = source.isolated ? 'ton effort de' : 'ta course de';
  const distance = source.distance_km.toFixed(1).replace('.', ',');
  const when =
    source.days_ago === 0
      ? "aujourd’hui"
      : source.days_ago === 1
        ? 'hier'
        : `il y a ${source.days_ago} jours`;
  return `Basée sur ${what} ${distance} km à ${source.pace_min_per_km}/km, ${when}.`;
}

function EmptyPlan() {
  return (
    <EmptyState
      title="Aucun plan pour l’instant"
      description="Construis un plan de course qui s’adapte à ta forme réelle et compte tes autres sports comme de la charge, pas comme du bruit."
      variant="ledger">
      <Button label="Créer mon plan" onPress={() => router.push('/plan-setup')} />
    </EmptyState>
  );
}

function PlanBody({
  response,
  currentWeek,
}: {
  response: PlanResponse;
  currentWeek: number | null;
}) {
  const styles = useStyles();
  if (response.status === 'failed') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" themeColor="alerte">
          La génération a échoué.
        </ThemedText>
        <ThemedText type="small" themeColor="inkMuted">
          {response.error_message ?? 'Réessaie dans quelques instants.'}
        </ThemedText>
      </View>
    );
  }
  if (!response.plan) return null;
  return <PlanWeekPager plan={response.plan} currentWeek={currentWeek} />;
}

const useStyles = makeStyles((t) => ({
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
    paddingHorizontal: Spacing.four,
  },
  container: {
    flex: 1,
    maxWidth: MaxContentWidthWide,
    alignSelf: 'center',
    width: '100%',
  },
  scrollContent: {
    gap: Spacing.four,
    paddingTop: Spacing.four,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    // 16pt tall as laid out; hitSlop doesn't help on web.
    minHeight: 44,
  },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  actionBtn: { flex: 1 },
  replanBanner: {
    backgroundColor: t.prudenceWash,
    borderRadius: Rounded.sm,
    borderLeftWidth: 1,
    borderLeftColor: t.prudence,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  // Neutral surface, same as the generation card. A failed generation is not a
  // training-load state, and DESIGN.md keeps go/prudence/recup for load alone —
  // `alerte` on the label is the error register this screen already uses.
  failureBanner: {
    backgroundColor: t.raised,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: t.rule,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  warnBanner: {
    backgroundColor: t.prudenceWash,
    borderRadius: Rounded.sm,
    borderLeftWidth: 1,
    borderLeftColor: t.prudence,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  forecastCard: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  forecastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  forecastCol: { gap: Spacing.half, alignItems: 'center', flex: 1 },
  todayTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  todayTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recoveryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
    paddingTop: Spacing.three,
    marginTop: Spacing.one,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  recoveryStat: {
    gap: Spacing.half,
  },
  card: {
    gap: Spacing.two,
  },
}));

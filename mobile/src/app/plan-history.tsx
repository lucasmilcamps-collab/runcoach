import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { ScreenCrest } from '@/components/screen-crest';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/icon';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import { getPlanVersions, PlanVersionSummary } from '@/lib/api/plans';
import { qk } from '@/lib/query-keys';

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

export default function PlanHistoryScreen() {
  const query = useQuery({ queryKey: qk.planVersions(), queryFn: getPlanVersions });
  const versions = query.data ?? [];

  // The split the athlete actually thinks in: the plan they're running now, and
  // the ones they're not. `is_active` comes from the server — after stopping a
  // plan there is no active one at all, and picking "the first row" here would
  // quietly label a stopped plan as the live one.
  const active = versions.filter((v) => v.is_active);
  const past = versions.filter((v) => !v.is_active);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenCrest />
        <View style={styles.topbar}>
          <BackButton />
        </View>
        <View style={styles.header}>
          <ThemedText type="title">Mes plans</ThemedText>
          {/* Phrased to hold in both states: after stopping a plan there is no
              active one, and a line promising "the one running right now" would
              point at a section that isn't there. */}
          <ThemedText type="default" themeColor="textSecondary">
            Chaque régénération crée un nouveau plan. Les précédents restent consultables : rien
            n’est perdu quand tu replanifies.
          </ThemedText>
        </View>

        {query.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.contour} />
          </View>
        ) : query.isError ? (
          <ThemedText type="default" themeColor="flare">
            Impossible de charger tes plans. Réessayez.
          </ThemedText>
        ) : versions.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Aucun plan pour l’instant.
          </ThemedText>
        ) : (
          <>
            {/* No "Actif" section when nothing is running — an empty heading
                would state the opposite of the truth. */}
            {active.length > 0 ? (
              <Section title="Actif">
                {active.map((v) => (
                  <VersionRow key={v.version} version={v} />
                ))}
              </Section>
            ) : null}
            {past.length > 0 ? (
              <Section title="Passés">
                {past.map((v) => (
                  <VersionRow key={v.version} version={v} />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        {title}
      </ThemedText>
      {/* The heading sits closer to its list than the cards sit to each other,
          so a section reads as one group rather than n loose cards. */}
      <View style={styles.sectionList}>{children}</View>
    </View>
  );
}

function VersionRow({ version }: { version: PlanVersionSummary }) {
  const subtitle = [version.goal_description, version.injury_area].filter(Boolean).join(' · ');

  return (
    <Pressable
      style={pressable(styles.card)}
      accessibilityRole="button"
      accessibilityLabel={`Plan ${version.version}, ${version.reason}`}
      onPress={() =>
        router.push({
          pathname: '/plan-version/[version]',
          params: { version: String(version.version) },
        })
      }>
      <View style={styles.rowTop}>
        <View style={styles.versionLabel}>
          <ThemedText type="default">Plan {version.version}</ThemedText>
          <Icon name="chevron-right" size={16} color={Colors.textSecondary} />
        </View>
        {/* A stopped plan says so: without it, "Passés" reads as "replaced by a
            newer one", which is a different story from "you ended it". */}
        {version.status === 'cancelled' ? (
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Arrêté · {formatDate(version.created_at)}
          </ThemedText>
        ) : (
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {formatDate(version.created_at)}
          </ThemedText>
        )}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {version.reason}
        {version.weeks_total ? ` · ${version.weeks_total} semaines` : ''}
      </ThemedText>
      {version.estimated_time_min != null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Chrono {fmtTime(version.estimated_time_min)}
          {version.projected_time_min != null ? ` → ${fmtTime(version.projected_time_min)}` : ''}
        </ThemedText>
      ) : null}
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      ) : null}
    </Pressable>
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
  section: { gap: Spacing.two },
  sectionList: { gap: Spacing.three },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.half,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  versionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
});

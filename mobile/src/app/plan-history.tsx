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

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}
import { getPlanVersions, PlanVersionSummary } from '@/lib/api/plans';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export default function PlanHistoryScreen() {
  const query = useQuery({ queryKey: ['plan-versions'], queryFn: getPlanVersions, retry: false });
  const versions = query.data ?? [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenCrest />
        <View style={styles.topbar}>
          <BackButton />
        </View>
        <View style={styles.header}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Mon plan
          </ThemedText>
          <ThemedText type="title">Historique des versions</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Chaque régénération crée une version. La plus récente est ton plan actif ; les
            précédentes restent consultables.
          </ThemedText>
        </View>

        {query.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.contour} />
          </View>
        ) : query.isError ? (
          <ThemedText type="default" themeColor="flare">
            Impossible de charger l’historique. Réessayez.
          </ThemedText>
        ) : versions.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Aucune version pour l’instant.
          </ThemedText>
        ) : (
          versions.map((v, index) => (
            <VersionRow key={v.version} version={v} isActive={index === 0} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function VersionRow({ version, isActive }: { version: PlanVersionSummary; isActive: boolean }) {
  const subtitle = [version.goal_description, version.injury_area]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      style={pressable(styles.card)}
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/plan-version/[version]',
          params: { version: String(version.version) },
        })
      }>
      <View style={styles.rowTop}>
        <View style={styles.versionLabel}>
          <ThemedText type="default">Version {version.version}</ThemedText>
          <Icon name="chevron-right" size={16} color={Colors.textSecondary} />
        </View>
        {isActive ? (
          <ThemedText type="waypointLabel" themeColor="blaze">
            Actif
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
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  topbar: { flexDirection: 'row' },
  header: { gap: Spacing.two, marginBottom: Spacing.one },
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

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
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
        <ThemedText type="default">Version {version.version}  ▸</ThemedText>
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
});

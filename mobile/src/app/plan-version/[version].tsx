import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlanView } from '@/components/plan-view';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { getPlanVersion } from '@/lib/api/plans';

export default function PlanVersionScreen() {
  const { version } = useLocalSearchParams<{ version: string }>();
  const versionNumber = Number(version);

  const query = useQuery({
    queryKey: ['plan-version', versionNumber],
    queryFn: () => getPlanVersion(versionNumber),
    enabled: Number.isFinite(versionNumber),
    retry: false,
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Historique
          </ThemedText>
          <ThemedText type="title">Version {version}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Lecture seule — cette version n’est pas modifiable.
          </ThemedText>
        </View>

        {query.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.contour} />
          </View>
        ) : query.isError || !query.data?.plan ? (
          <ThemedText type="default" themeColor="flare">
            Impossible de charger cette version.
          </ThemedText>
        ) : (
          <PlanView plan={query.data.plan} />
        )}
      </ScrollView>
    </SafeAreaView>
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
  header: { gap: Spacing.two },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
});

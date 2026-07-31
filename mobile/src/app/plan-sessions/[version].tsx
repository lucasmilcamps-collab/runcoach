import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { PlanView } from '@/components/plan-view';
import { ScreenCrest } from '@/components/screen-crest';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { getPlanVersion } from '@/lib/api/plans';

/**
 * Every session of a plan, week by week. This used to be what opening a plan
 * landed on; it now sits one tap behind the summary, because "all 60 sessions"
 * answers a question you only ask after the ones the summary answers.
 */
export default function PlanSessionsScreen() {
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
        <ScreenCrest />
        <View style={styles.topbar}>
          <BackButton />
        </View>
        <View style={styles.header}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Plan {version}
          </ThemedText>
          <ThemedText type="title">Toutes les séances</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Lecture seule — ce plan n’est pas modifiable ici.
          </ThemedText>
        </View>

        {query.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.contour} />
          </View>
        ) : query.isError || !query.data?.plan ? (
          <ThemedText type="default" themeColor="flare">
            Impossible de charger ce plan.
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
  topbar: { flexDirection: 'row' },
  header: { gap: Spacing.two },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
});

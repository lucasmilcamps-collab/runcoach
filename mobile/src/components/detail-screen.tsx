import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { ScreenCrest } from '@/components/screen-crest';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * The shared frame for a plan detail screen: crest, a way back, a kicker naming
 * the plan it belongs to, a title, and a line saying what the screen is for.
 *
 * The three detail screens are the same page with different content; giving
 * each its own copy of this scaffolding would mean fixing every safe-area or
 * width decision three times.
 */
export function DetailScreen({
  kicker,
  title,
  blurb,
  children,
}: {
  kicker: string;
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenCrest />
        <View style={styles.topbar}>
          <BackButton />
        </View>
        <View style={styles.header}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {kicker}
          </ThemedText>
          <ThemedText type="title">{title}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {blurb}
          </ThemedText>
        </View>
        {children}
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
    paddingBottom: Spacing.six,
  },
  topbar: { flexDirection: 'row' },
  header: { gap: Spacing.two },
});

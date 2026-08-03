import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The shared frame for a detail screen: a way back, a kicker naming what this
 * belongs to, a title, and a line saying what the screen is for, closed by the
 * rule that everything below hangs from.
 *
 * The detail screens are the same page with different content; giving each its
 * own copy of this scaffolding would mean fixing every safe-area or width
 * decision several times over.
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
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <BackButton />
        </View>
        <View style={styles.header}>
          <ThemedText type="label" themeColor="inkMuted">
            {kicker}
          </ThemedText>
          <ThemedText type="title">{title}</ThemedText>
          <ThemedText type="default" themeColor="inkMuted">
            {blurb}
          </ThemedText>
        </View>
        <View style={styles.rule} />
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
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
  rule: { height: 1, backgroundColor: t.rule },
}));

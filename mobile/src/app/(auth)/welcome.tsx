import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Logo } from '@/components/logo';
import { ScreenCrest } from '@/components/screen-crest';
import { ThemedText } from '@/components/themed-text';
import { WaypointStepper } from '@/components/waypoint-stepper';
import { Colors, MaxFormWidth, Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenCrest />

      <View style={styles.content}>
        <WaypointStepper currentStep={0} />

        <View style={styles.hero}>
          {/* The only screen that introduces the app, and so the only one that
              carries the full lockup — everywhere else the avatar heads the
              page and the tab bar says where you are. */}
          <Logo size={44} />
          <ThemedText type="title">Tous tes sports, une seule foulée.</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Mosa lit vos données Garmin réelles — récupération, sommeil, Body Battery — et
            recalcule votre plan course à pied en tenant compte de vos autres sports.
          </ThemedText>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label="Commencer" onPress={() => router.push('/login')} />
        <Button label="J'ai déjà un compte" variant="ghost" onPress={() => router.push('/login?mode=signin')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.six,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
  },
  hero: {
    gap: Spacing.three,
  },
  actions: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
  },
});

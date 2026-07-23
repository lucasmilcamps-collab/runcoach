import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { WaypointStepper } from '@/components/waypoint-stepper';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ContourRings />

      <View style={styles.content}>
        <WaypointStepper currentStep={0} />

        <View style={styles.hero}>
          <ThemedText type="title">Le sentier s'adapte à vous, pas l'inverse.</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            RunCoach lit vos données Garmin réelles — récupération, sommeil, Body Battery — et
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

function ContourRings() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ringsWrapper]}>
      {[280, 220, 160, 100].map((size) => (
        <View
          key={size}
          style={[
            styles.ring,
            {
              width: size,
              height: size * 0.62,
              borderRadius: size / 2,
              top: -size * 0.28,
              right: -size * 0.32,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  ringsWrapper: {
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: Colors.contourFaint,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.six,
    maxWidth: MaxContentWidth,
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
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
});

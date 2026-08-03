import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Logo } from '@/components/logo';
import { ThemedText } from '@/components/themed-text';
import { LegStepper } from '@/components/leg-stepper';
import { MaxFormWidth, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';

export default function WelcomeScreen() {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.safeArea}>

      <View style={styles.content}>
        <LegStepper currentStep={0} />

        <View style={styles.hero}>
          {/* The only screen that introduces the app, and so the only one that
              carries the full lockup — everywhere else the avatar heads the
              page and the tab bar says where you are. */}
          <Logo size={44} />
          <ThemedText type="title">Tous tes sports comptent.</ThemedText>
          <ThemedText type="default" themeColor="inkMuted">
            Le padel du mardi et le match de jeudi pèsent sur la sortie longue du dimanche. Relay
            lit ta montre — récupération, sommeil, fréquence cardiaque — et arbitre la semaine
            entre la course, le renfo et tes sports co.
          </ThemedText>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label="Commencer" onPress={() => router.push('/login')} />
        <Button
          label="J’ai déjà un compte"
          variant="ghost"
          onPress={() => router.push('/login?mode=signin')}
        />
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
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
}));

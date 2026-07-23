import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuthStore } from '@/lib/stores/auth-store';

export default function DashboardScreen() {
  const garminConnected = useAuthStore((state) => state.garminConnected);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.header}>
          <ThemedText type="title">Votre tableau de bord</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {garminConnected
              ? 'Garmin est connecté. La première synchronisation (jusqu’à 90 jours) tourne en tâche de fond — revenez dans quelques minutes.'
              : 'Aucune donnée pour l’instant : connectez Garmin pour que votre charge d’entraînement et votre récupération apparaissent ici.'}
          </ThemedText>
        </View>

        <FlatContour />

        {!garminConnected && (
          <Button label="Connecter Garmin" variant="ghost" onPress={() => router.push('/garmin-connect')} />
        )}
      </View>
    </SafeAreaView>
  );
}

function FlatContour() {
  return (
    <View style={styles.contourCard}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Charge — 7 derniers jours
      </ThemedText>
      <View style={styles.contourLineWrapper}>
        <View style={styles.contourLine} />
        <View style={styles.contourDot} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Aucune charge enregistrée pour l'instant.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
  },
  content: {
    flex: 1,
    gap: Spacing.five,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  contourCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 14,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  contourLineWrapper: {
    height: 48,
    justifyContent: 'center',
  },
  contourLine: {
    height: 1,
    backgroundColor: Colors.contour,
  },
  contourDot: {
    position: 'absolute',
    left: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textSecondary,
  },
});

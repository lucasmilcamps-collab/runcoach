import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { NotificationsCard } from '@/components/notifications-card';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import { useAuthStore } from '@/lib/stores/auth-store';

export default function SettingsScreen() {
  const garminConnected = useAuthStore((s) => s.garminConnected);
  const signOut = useAuthStore((s) => s.signOut);

  async function handleSignOut() {
    await signOut();
    router.replace('/welcome');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.topbar}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/dashboard'))}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              hitSlop={8}
              style={pressable(styles.iconBtn)}>
              <Icon name="arrow-left" size={22} />
            </Pressable>
          </View>

          <View style={styles.header}>
            <ThemedText type="title">Réglages</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Vos repères, votre compte Garmin et vos notifications.
            </ThemedText>
          </View>

          <Section title="Entraînement">
            <View style={styles.card}>
              <SettingRow
                label="Repères cardiaques & allure"
                hint="FC max, FC repos et repère principal (allure ou FC)"
                onPress={() => router.push('/fitness-profile')}
              />
              <SettingRow
                label="Objectif du plan"
                hint="Distance, date de course et disponibilités"
                onPress={() => router.push('/plan-setup')}
                last
              />
            </View>
          </Section>

          <Section title="Garmin">
            <View style={styles.card}>
              <View style={styles.statusRow}>
                <ThemedText type="default">Connexion</ThemedText>
                <ThemedText
                  type="waypointLabel"
                  themeColor={garminConnected ? 'hydro' : 'textSecondary'}>
                  {garminConnected ? 'Connecté' : 'Non connecté'}
                </ThemedText>
              </View>
              <SettingRow
                label={garminConnected ? 'Reconnecter mon compte' : 'Connecter Garmin'}
                hint="Si la synchro échoue ou après un changement de mot de passe"
                onPress={() => router.push('/garmin-connect')}
                last
              />
            </View>
          </Section>

          <NotificationsCard />

          <Section title="Compte">
            <View style={styles.card}>
              <SettingRow label="Se déconnecter" onPress={handleSignOut} danger last />
            </View>
          </Section>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="waypointLabel" themeColor="blaze">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function SettingRow({
  label,
  hint,
  onPress,
  danger,
  last,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={pressable([styles.row, last && styles.rowLast])}>
      <View style={styles.rowMain}>
        <ThemedText type="default" themeColor={danger ? 'flare' : 'text'}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {!danger ? <Icon name="chevron-right" size={20} color={Colors.textSecondary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
  },
  container: {
    flex: 1,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  scrollContent: {
    gap: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
  },
  topbar: {
    flexDirection: 'row',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.contour,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.contourFaint,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.contourFaint,
  },
});

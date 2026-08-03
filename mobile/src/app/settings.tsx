import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { NotificationsCard } from '@/components/notifications-card';
import { ThemedText } from '@/components/themed-text';
import { MaxFormWidth, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';
import { pressable } from '@/lib/pressable';
import { cancelPlan, getCurrentPlan } from '@/lib/api/plans';
import { invalidatePlanReads, qk } from '@/lib/query-keys';
import { useAuthStore } from '@/lib/stores/auth-store';
import { usePreferencesStore, type ThemeMode } from '@/lib/stores/preferences-store';

const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Sable' },
  { value: 'dark', label: 'Graphite' },
];

export default function SettingsScreen() {
  const styles = useStyles();
  const garminConnected = useAuthStore((s) => s.garminConnected);
  const queryClient = useQueryClient();
  // Only offer the stop when there is something to stop.
  const planQuery = useQuery({ queryKey: qk.plan(), queryFn: getCurrentPlan });
  // `isError` matters as much as the data: after the stop the refetch 404s, and
  // TanStack Query keeps the last successful value — so checking `data` alone
  // left the row on screen offering to stop an already-stopped plan.
  const hasPlan = planQuery.data?.status === 'ready' && !planQuery.isError;
  // Irreversible from the app's side (the plan leaves every current-plan read),
  // so it asks twice rather than firing on the first tap.
  const [confirmStop, setConfirmStop] = useState(false);
  const stopMutation = useMutation({
    mutationFn: cancelPlan,
    onSuccess: () => {
      // Stopping a plan makes exactly the same five reads stale as generating
      // one does — same set, one call.
      invalidatePlanReads(queryClient);
      setConfirmStop(false);
    },
  });
  const signOut = useAuthStore((s) => s.signOut);
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);

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
            <BackButton />
          </View>

          <View style={styles.header}>
            <ThemedText type="title">Réglages</ThemedText>
            <ThemedText type="default" themeColor="inkMuted">
              Tes repères, ton compte Garmin et tes notifications.
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
                last={!hasPlan}
              />
              {hasPlan ? (
                <SettingRow
                  label={
                    stopMutation.isPending
                      ? 'Arrêt en cours…'
                      : confirmStop
                        ? 'Confirmer l’arrêt du plan ?'
                        : 'Arrêter le plan en cours'
                  }
                  hint={
                    confirmStop
                      ? 'Il quittera l’Accueil et les Séances, mais restera dans Mes plans.'
                      : 'Repartir sans plan — tu pourras en générer un nouveau quand tu veux'
                  }
                  onPress={() => (confirmStop ? stopMutation.mutate() : setConfirmStop(true))}
                  danger
                  last
                />
              ) : null}
            </View>
          </Section>

          <Section title="Garmin">
            <View style={styles.card}>
              <View style={styles.statusRow}>
                <ThemedText type="default">Connexion</ThemedText>
                <ThemedText type="label" themeColor={garminConnected ? 'ink' : 'inkMuted'}>
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

          <Section title="Apparence">
            <View style={styles.appearance}>
              {/* Neither appearance is the fallback: the app is read at 6h in a
                  dark bedroom and again at 22h after a match, so Système is the
                  honest default and the other two are overrides (DESIGN.md). */}
              <View style={styles.appearanceRow}>
                {THEME_MODES.map((mode) => (
                  <Chip
                    key={mode.value}
                    label={mode.label}
                    selected={themeMode === mode.value}
                    onPress={() => setThemeMode(mode.value)}
                    fill
                    accessibilityLabel={`Apparence : ${mode.label}`}
                  />
                ))}
              </View>
              <ThemedText type="small" themeColor="inkMuted">
                Système suit le réglage clair/sombre de ton téléphone.
              </ThemedText>
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
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <ThemedText type="label" themeColor="ink">
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
  const theme = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={pressable([styles.row, last && styles.rowLast])}>
      <View style={styles.rowMain}>
        <ThemedText type="default" themeColor={danger ? 'alerte' : 'ink'}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="inkMuted">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {!danger ? <Icon name="chevron-right" size={20} color={theme.inkMuted} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
    paddingHorizontal: Spacing.four,
  },
  container: {
    flex: 1,
    maxWidth: MaxFormWidth,
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
  header: {
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    backgroundColor: t.raised,
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
    borderBottomColor: t.rule,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  appearance: {
    gap: Spacing.two,
  },
  appearanceRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: t.rule,
  },
}));

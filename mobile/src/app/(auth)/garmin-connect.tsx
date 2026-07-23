import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { WaypointStepper } from '@/components/waypoint-stepper';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { connectGarmin } from '@/lib/api/garmin';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/auth-store';

export default function GarminConnectScreen() {
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();

  const setGarminConnected = useAuthStore((state) => state.setGarminConnected);
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);

  const mutation = useMutation({
    mutationFn: () => connectGarmin(garminEmail, garminPassword),
    onSuccess: async () => {
      await setGarminConnected(true);
      router.replace('/dashboard');
    },
  });

  function handleSubmit() {
    const nextEmailError = garminEmail.trim().length > 0 ? undefined : 'Entrez votre identifiant Garmin.';
    const nextPasswordError = garminPassword.length > 0 ? undefined : 'Entrez votre mot de passe Garmin.';

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    mutation.mutate();
  }

  async function handleSkip() {
    await completeOnboarding();
    router.replace('/dashboard');
  }

  const serverErrorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.code === 'GARMIN_INVALID_CREDENTIALS'
        ? 'Identifiants Garmin refusés. Vérifiez votre email et mot de passe.'
        : mutation.error.code === 'GARMIN_UPSTREAM_ERROR'
          ? 'Garmin Connect ne répond pas. Réessayez dans quelques minutes.'
          : mutation.error.message
      : mutation.isError
        ? 'Impossible de contacter le serveur. Réessayez.'
        : undefined;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <WaypointStepper currentStep={2} />

          <View style={styles.header}>
            <ThemedText type="title">Relier votre Garmin</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Vos identifiants Garmin Connect ne sont utilisés qu'une fois pour établir la
              connexion. Seuls les jetons de session sont conservés, chiffrés — jamais votre mot
              de passe.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Identifiant Garmin (email)"
              value={garminEmail}
              onChangeText={(text) => {
                setGarminEmail(text);
                setEmailError(undefined);
                mutation.reset();
              }}
              error={emailError}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="vous@example.com"
            />
            <TextField
              label="Mot de passe Garmin"
              value={garminPassword}
              onChangeText={(text) => {
                setGarminPassword(text);
                setPasswordError(undefined);
                mutation.reset();
              }}
              error={passwordError}
              secureTextEntry
              placeholder="Votre mot de passe Garmin Connect"
            />
            {serverErrorMessage ? (
              <ThemedText type="small" themeColor="flare">
                {serverErrorMessage}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          <Button label="Connecter Garmin" onPress={handleSubmit} loading={mutation.isPending} />
          <Button label="Plus tard" variant="ghost" disabled={mutation.isPending} onPress={handleSkip} />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    gap: Spacing.five,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  form: {
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

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
import { ApiError } from '@/lib/api/client';
import { completeGarminMfa, connectGarmin } from '@/lib/api/garmin';
import { useAuthStore } from '@/lib/stores/auth-store';

function garminErrorMessage(error: unknown, isError: boolean): string | undefined {
  if (error instanceof ApiError) {
    if (error.code === 'GARMIN_INVALID_CREDENTIALS') {
      return 'Identifiants Garmin refusés. Vérifiez votre email et mot de passe.';
    }
    if (error.code === 'GARMIN_MFA_INVALID') {
      return 'Code incorrect ou expiré. Redemandez la connexion.';
    }
    if (error.code === 'GARMIN_UPSTREAM_ERROR') {
      return 'Garmin Connect ne répond pas. Réessayez dans quelques minutes.';
    }
    return error.message;
  }
  return isError ? 'Impossible de contacter le serveur. Réessayez.' : undefined;
}

export default function GarminConnectScreen() {
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaCodeError, setMfaCodeError] = useState<string | undefined>();

  const setGarminConnected = useAuthStore((state) => state.setGarminConnected);
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);

  const connectMutation = useMutation({
    mutationFn: () => connectGarmin(garminEmail, garminPassword),
    onSuccess: async (result) => {
      if (result.status === 'needs_mfa' && result.mfa_token) {
        setMfaToken(result.mfa_token);
        return;
      }
      await setGarminConnected(true);
      router.replace('/dashboard');
    },
  });

  const mfaMutation = useMutation({
    mutationFn: () => completeGarminMfa(mfaToken ?? '', mfaCode),
    onSuccess: async () => {
      await setGarminConnected(true);
      router.replace('/dashboard');
    },
  });

  function handleSubmitCredentials() {
    const nextEmailError = garminEmail.trim().length > 0 ? undefined : 'Entrez votre identifiant Garmin.';
    const nextPasswordError = garminPassword.length > 0 ? undefined : 'Entrez votre mot de passe Garmin.';

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    connectMutation.mutate();
  }

  function handleSubmitMfaCode() {
    const nextMfaCodeError = mfaCode.trim().length > 0 ? undefined : 'Entrez le code reçu par email.';
    setMfaCodeError(nextMfaCodeError);
    if (nextMfaCodeError) return;

    mfaMutation.mutate();
  }

  async function handleSkip() {
    await completeOnboarding();
    router.replace('/dashboard');
  }

  const credentialsErrorMessage = garminErrorMessage(connectMutation.error, connectMutation.isError);
  const mfaErrorMessage = garminErrorMessage(mfaMutation.error, mfaMutation.isError);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        {mfaToken ? (
          <View style={styles.content}>
            <WaypointStepper currentStep={2} />

            <View style={styles.header}>
              <ThemedText type="title">Vérifiez votre email</ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                Garmin vous a envoyé un code de vérification par email. Entrez-le ci-dessous pour
                terminer la connexion.
              </ThemedText>
            </View>

            <View style={styles.form}>
              <TextField
                label="Code de vérification"
                value={mfaCode}
                onChangeText={(text) => {
                  setMfaCode(text);
                  setMfaCodeError(undefined);
                  mfaMutation.reset();
                }}
                error={mfaCodeError}
                keyboardType="number-pad"
                placeholder="123456"
              />
              {mfaErrorMessage ? (
                <ThemedText type="small" themeColor="flare">
                  {mfaErrorMessage}
                </ThemedText>
              ) : null}
            </View>
          </View>
        ) : (
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
                  connectMutation.reset();
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
                  connectMutation.reset();
                }}
                error={passwordError}
                secureTextEntry
                placeholder="Votre mot de passe Garmin Connect"
              />
              {credentialsErrorMessage ? (
                <ThemedText type="small" themeColor="flare">
                  {credentialsErrorMessage}
                </ThemedText>
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.actions}>
          {mfaToken ? (
            <>
              <Button label="Valider le code" onPress={handleSubmitMfaCode} loading={mfaMutation.isPending} />
              <Button
                label="Utiliser un autre compte"
                variant="ghost"
                disabled={mfaMutation.isPending}
                onPress={() => {
                  setMfaToken(null);
                  setMfaCode('');
                  mfaMutation.reset();
                }}
              />
            </>
          ) : (
            <>
              <Button
                label="Connecter Garmin"
                onPress={handleSubmitCredentials}
                loading={connectMutation.isPending}
              />
              <Button
                label="Plus tard"
                variant="ghost"
                disabled={connectMutation.isPending}
                onPress={handleSkip}
              />
            </>
          )}
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

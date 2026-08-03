import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { LegStepper } from '@/components/leg-stepper';
import { MaxFormWidth, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';
import { ApiError } from '@/lib/api/client';
import { completeGarminMfa, connectGarmin } from '@/lib/api/garmin';
import { useAuthStore } from '@/lib/stores/auth-store';

function garminErrorMessage(error: unknown, isError: boolean): string | undefined {
  if (error instanceof ApiError) {
    if (error.code === 'GARMIN_INVALID_CREDENTIALS') {
      return 'Identifiants Garmin refusés. Vérifie ton email et ton mot de passe.';
    }
    if (error.code === 'GARMIN_MFA_INVALID') {
      return 'Code incorrect ou expiré. Redemandez la connexion.';
    }
    if (error.code === 'GARMIN_UPSTREAM_ERROR') {
      return 'Garmin Connect ne répond pas. Réessaie dans quelques minutes.';
    }
    return error.message;
  }
  return isError ? 'Impossible de contacter le serveur. Réessaie.' : undefined;
}

export default function GarminConnectScreen() {
  const styles = useStyles();
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
      router.replace({ pathname: '/dashboard', params: { sync: '1' } });
    },
  });

  const mfaMutation = useMutation({
    mutationFn: () => completeGarminMfa(mfaToken ?? '', mfaCode),
    onSuccess: async () => {
      await setGarminConnected(true);
      router.replace({ pathname: '/dashboard', params: { sync: '1' } });
    },
  });

  function handleSubmitCredentials() {
    const nextEmailError = garminEmail.trim().length > 0 ? undefined : 'Entre ton identifiant Garmin.';
    const nextPasswordError = garminPassword.length > 0 ? undefined : 'Entre ton mot de passe Garmin.';

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    connectMutation.mutate();
  }

  function handleSubmitMfaCode() {
    const nextMfaCodeError = mfaCode.trim().length > 0 ? undefined : 'Entre le code reçu par email.';
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
            <LegStepper currentStep={2} />

            <View style={styles.header}>
              <ThemedText type="title">Vérifie ton email</ThemedText>
              <ThemedText type="default" themeColor="inkMuted">
                Garmin t’a envoyé un code de vérification par email. Entre-le ci-dessous pour
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
                <ThemedText type="small" themeColor="alerte">
                  {mfaErrorMessage}
                </ThemedText>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.content}>
            <LegStepper currentStep={2} />

            <View style={styles.header}>
              <ThemedText type="title">Relier ta montre</ThemedText>
              <ThemedText type="default" themeColor="inkMuted">
                Tes identifiants Garmin Connect ne servent qu’une fois, pour établir la
                connexion. Seuls les jetons de session sont conservés, chiffrés — jamais ton mot
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
                placeholder="toi@example.com"
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
                <ThemedText type="small" themeColor="alerte">
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

const useStyles = makeStyles((t) => ({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    gap: Spacing.five,
    maxWidth: MaxFormWidth,
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
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
  },
}));

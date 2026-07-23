import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { WaypointStepper } from '@/components/waypoint-stepper';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { login, register } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/auth-store';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signin' | 'signup'>(params.mode === 'signin' ? 'signin' : 'signup');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();

  const setTokens = useAuthStore((state) => state.setTokens);

  const mutation = useMutation({
    mutationFn: () => (mode === 'signin' ? login(email, password) : register(email, password)),
    onSuccess: async (tokens) => {
      await setTokens(tokens.access_token, tokens.refresh_token);
      router.replace('/garmin-connect');
    },
  });

  function handleSubmit() {
    const trimmedEmail = email.trim();
    const nextEmailError = EMAIL_PATTERN.test(trimmedEmail) ? undefined : 'Adresse email invalide.';
    const nextPasswordError =
      password.length >= 8 ? undefined : 'Le mot de passe doit contenir au moins 8 caractères.';

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    mutation.mutate();
  }

  const serverErrorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.code === 'INVALID_CREDENTIALS'
        ? 'Email ou mot de passe incorrect.'
        : mutation.error.code === 'EMAIL_ALREADY_EXISTS'
          ? 'Un compte existe déjà avec cet email.'
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
          <WaypointStepper currentStep={1} />

          <View style={styles.header}>
            <ThemedText type="title">
              {mode === 'signin' ? 'Content de vous revoir' : 'Créer votre compte'}
            </ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              {mode === 'signin'
                ? 'Connectez-vous pour retrouver votre plan.'
                : 'Un compte pour garder votre plan et vos données au même endroit.'}
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Email"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
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
              label="Mot de passe"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setPasswordError(undefined);
                mutation.reset();
              }}
              error={passwordError}
              secureTextEntry
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder="8 caractères minimum"
            />
            {serverErrorMessage ? (
              <ThemedText type="small" themeColor="flare">
                {serverErrorMessage}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            label={mode === 'signin' ? 'Se connecter' : 'Créer mon compte'}
            onPress={handleSubmit}
            loading={mutation.isPending}
          />
          <Button
            label={mode === 'signin' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
            variant="ghost"
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setEmailError(undefined);
              setPasswordError(undefined);
              mutation.reset();
            }}
            disabled={mutation.isPending}
          />
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

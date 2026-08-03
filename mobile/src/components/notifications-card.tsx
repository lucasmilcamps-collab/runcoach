import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';
import { sendTestPush } from '@/lib/api/push';
import { disablePush, enablePush, pushPermission, pushSupported, type PushState } from '@/lib/push';

/**
 * Enable/disable Web Push (browser & installed PWA only). Renders nothing on
 * native or where push isn't available. On iPhone, push works only once the app
 * is installed to the home screen (iOS 16.4+) — surfaced here if subscribe fails.
 */
export function NotificationsCard() {
  const styles = useStyles();
  const [state, setState] = useState<PushState>(() => pushPermission());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  if (!pushSupported()) return null;

  async function handleEnable() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await enablePush();
      setState(result);
      if (result === 'denied') {
        setMessage('Notifications refusées. Autorisez-les dans les réglages du navigateur.');
      } else if (result === 'unsupported') {
        setMessage('Notifications non configurées côté serveur.');
      }
    } catch {
      setMessage(
        'Impossible d’activer. Sur iPhone, installez d’abord l’app (Partager → Sur l’écran d’accueil), puis réessayez.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMessage(undefined);
    try {
      const { sent } = await sendTestPush();
      setMessage(sent > 0 ? 'Test envoyé — regarde tes notifications.' : 'Aucun appareil abonné.');
    } catch {
      setMessage('Échec de l’envoi du test.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setMessage(undefined);
    try {
      await disablePush();
      setState('default');
    } finally {
      setBusy(false);
    }
  }

  const granted = state === 'granted';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText type="label" themeColor="inkMuted">
          Notifications
        </ThemedText>
        {granted ? (
          <ThemedText type="label" themeColor="ink">
            Activées
          </ThemedText>
        ) : null}
      </View>

      <ThemedText type="small" themeColor="inkMuted">
        {granted
          ? 'Tu recevras chaque matin ta séance du jour, et une alerte quand le plan mérite un réajustement.'
          : 'Reçois ta séance du jour et les alertes de réajustement, directement sur cet appareil.'}
      </ThemedText>

      {granted ? (
        <View style={styles.actions}>
          <Button label="M’envoyer un test" variant="ghost" loading={busy} onPress={handleTest} />
          <Button label="Désactiver" variant="ghost" disabled={busy} onPress={handleDisable} />
        </View>
      ) : (
        <Button
          label="Activer les notifications"
          variant="ghost"
          loading={busy}
          onPress={handleEnable}
        />
      )}

      {message ? (
        <ThemedText type="small" themeColor="inkMuted">
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.raised,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actions: {
    gap: Spacing.two,
  },
}));

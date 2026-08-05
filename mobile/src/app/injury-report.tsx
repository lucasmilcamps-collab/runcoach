import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ChipRow, Field, FormScreen } from '@/components/form';
import { GenerationProgress } from '@/components/generation-progress';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';
import { pressable } from '@/lib/pressable';
import { usePlanGeneration } from '@/lib/use-plan-generation';
import { InjuryReport, reportInjury } from '@/lib/api/plans';

type Severity = InjuryReport['severity'];

const SEVERITIES: { value: Severity; label: string; hint: string }[] = [
  { value: 'gene', label: 'Gêne légère', hint: 'Je peux courir prudemment' },
  { value: 'douleur', label: 'Douleur', hint: 'Courir aggrave la douleur' },
  { value: 'arret', label: 'Arrêt', hint: 'Je ne peux pas courir' },
];

const DAYS_OFF = [0, 3, 5, 7, 10, 14, 21];

export default function InjuryReportScreen() {
  const styles = useStyles();

  const [area, setArea] = useState('');
  const [severity, setSeverity] = useState<Severity>('gene');
  const [daysOff, setDaysOff] = useState(7);

  const generation = usePlanGeneration(reportInjury, { onDone: () => router.back() });

  function handleSubmit() {
    generation.generate({ area: area.trim(), severity, days_off: daysOff });
  }

  const errorMessage = generation.errorMessage;

  const canSubmit = area.trim().length > 0 && !generation.isGenerating;

  return (
    <FormScreen
      kicker="Signaler une blessure"
      title="Adapter mon plan"
      blurb="Le plan sera régénéré en reprise progressive : une période allégée puis une remontée douce de la charge. Ce n’est pas un avis médical — en cas de doute ou de douleur qui persiste, consulte un professionnel de santé."
      actions={[
        <Button
          key="submit"
          label="Adapter mon plan"
          onPress={handleSubmit}
          loading={generation.isGenerating}
          disabled={!canSubmit}
        />,
        <Button
          key="cancel"
          label="Annuler"
          variant="ghost"
          disabled={generation.isGenerating}
          onPress={() => router.back()}
        />
      ]}>
      <TextField
        label="Zone touchée"
        value={area}
        onChangeText={(t) => {
          setArea(t);
          generation.reset();
        }}
        placeholder="ex. mollet droit, genou gauche…"
        autoCapitalize="none"
      />

      <Field label="Gravité">
        {/* Rows rather than chips: each option carries a sentence explaining
            what it means, and a chip has room for a word. */}
        <View style={styles.severityCol}>
          {SEVERITIES.map((s) => (
            <Pressable
              key={s.value}
              onPress={() => setSeverity(s.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: severity === s.value }}
              accessibilityLabel={`${s.label} — ${s.hint}`}
              style={pressable([
                styles.severityRow,
                severity === s.value && styles.severityRowSelected,
              ])}>
              <ThemedText type={severity === s.value ? 'link' : 'default'}>{s.label}</ThemedText>
              <ThemedText type="small" themeColor="inkMuted">
                {s.hint}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </Field>

      <Field label="Jours sans courir">
        <ChipRow>
          {DAYS_OFF.map((n) => (
            <Chip
              key={n}
              label={n === 0 ? 'Aucun' : `${n} j`}
              selected={n === daysOff}
              onPress={() => setDaysOff(n)}
            />
          ))}
        </ChipRow>
      </Field>

      <GenerationProgress phase={generation.phase} elapsedSeconds={generation.elapsedSeconds} />
      {errorMessage ? (
        <ThemedText type="small" themeColor="alerte">
          {errorMessage}
        </ThemedText>
      ) : null}
    </FormScreen>
  );
}

const useStyles = makeStyles((t) => ({
  severityCol: { gap: Spacing.two },
  severityRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: t.rule,
    backgroundColor: 'transparent',
    gap: Spacing.half,
  },
  severityRowSelected: {
    backgroundColor: t.inset,
    borderColor: t.ruleStrong,
    borderWidth: 1.5,
  },
}));

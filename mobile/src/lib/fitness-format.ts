import type { Colors } from '@/constants/theme';

/**
 * Form (TSB) bands, kept deliberately coarse — a directional cue, not a
 * prescription (no medical advice, per the project's guardrails). `verdict` is
 * the plain-language lead shown in the Accueil readiness hero; `word` is the
 * short tag. Color stays neutral — teal is reserved for live Garmin data, so
 * form (a stored, computed metric) never uses it; only severe fatigue reaches
 * for the flare warning color.
 *
 * Shared by the readiness hero and the fitness (trend) card so the verdict and
 * its band color are defined in exactly one place.
 */
export function formBand(tsb: number): {
  word: string;
  verdict: string;
  color: keyof typeof Colors;
} {
  if (tsb > 5) {
    return { word: 'Frais', verdict: 'Reposé — bon jour pour une séance intense.', color: 'text' };
  }
  if (tsb < -25) {
    return {
      word: 'Fatigue élevée',
      verdict: 'Fatigue marquée — allège et privilégie la récupération.',
      color: 'flare',
    };
  }
  return { word: 'Équilibré', verdict: 'Charge et récupération équilibrées.', color: 'text' };
}

/** Signed, rounded form value for display (e.g. "+14", "-3", "0"). */
export function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

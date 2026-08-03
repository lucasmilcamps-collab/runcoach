import type { ThemeColor } from '@/constants/theme';

/**
 * Form (TSB) bands, kept deliberately coarse — a directional cue, not a
 * prescription (no medical advice, per the project's guardrails).
 *
 * The thresholds are the plan engine's own (training-science: TSB < −25 is high
 * fatigue, TSB > 5 is fresh), so the number the app shows and the decision the
 * backend makes can never disagree.
 *
 * `color` names a signal ink and only ever one: Prudence when fatigue is
 * genuinely high, Go when the athlete is fresh enough to take a hard session,
 * and neutral Ink in between — the middle band is not a state worth spending a
 * colour on.
 */
export function formBand(tsb: number): {
  word: string;
  verdict: string;
  color: ThemeColor;
} {
  if (tsb > 5) {
    return { word: 'Frais', verdict: 'Reposé — bon jour pour une séance intense.', color: 'go' };
  }
  if (tsb < -25) {
    return {
      word: 'Fatigue élevée',
      verdict: 'Fatigue marquée — allège et privilégie la récupération.',
      color: 'prudence',
    };
  }
  return { word: 'Équilibré', verdict: 'Charge et récupération équilibrées.', color: 'ink' };
}

/** Signed, rounded form value for display (e.g. "+14", "-3", "0"). */
export function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

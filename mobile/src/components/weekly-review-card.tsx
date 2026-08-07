import { View } from 'react-native';

import { RegenerateButton } from '@/components/regenerate-button';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';

import type { WeeklyReview } from '@/lib/api/reviews';

/**
 * The week that just ended, and whether it warrants moving the plan.
 *
 * Colour carries load and nothing else (DESIGN.md): `prudence` when the week
 * asks for an adjustment, `go` when it went as planned. The action stays a
 * neutral ghost button — the signal is never the command.
 *
 * It proposes and stops there. Regenerating is one tap away and always the
 * athlete's decision, which is the same contract as the replan banner it sits
 * above; both share the one generation path rather than opening a second.
 */
export function WeeklyReviewCard({
  review,
  onReplan,
  isReplanning,
  canReplan,
}: {
  review: WeeklyReview;
  onReplan: () => void;
  isReplanning: boolean;
  canReplan: boolean;
}) {
  const styles = useStyles();
  const adjust = review.needs_adjustment;

  return (
    <View style={adjust ? styles.bannerPrudence : styles.bannerGo}>
      <ThemedText type="label" themeColor={adjust ? 'prudence' : 'go'}>
        Bilan de la semaine
      </ThemedText>

      <ThemedText type="small" themeColor="inkMuted">
        {review.key_completed}/{review.key_planned} séances clés réalisées
        {review.ctl_ramp_pct != null ? ` · charge ${formatRamp(review.ctl_ramp_pct)}` : ''} · forme{' '}
        {review.tsb >= 0 ? '+' : ''}
        {Math.round(review.tsb)}
      </ThemedText>

      {/* The AI sentence when there is one; otherwise the deterministic signals
          that fired. A week that needed no adjustment says so plainly rather
          than showing an empty card. */}
      {review.summary ? (
        <ThemedText type="small">{review.summary}</ThemedText>
      ) : adjust ? (
        <View style={styles.signals}>
          {review.signals.map((signal) => (
            <ThemedText key={signal} type="small">
              {signal}
            </ThemedText>
          ))}
        </View>
      ) : (
        <ThemedText type="small">Semaine conforme au plan — rien à réajuster.</ThemedText>
      )}

      {adjust && canReplan ? (
        <RegenerateButton onConfirm={onReplan} isRegenerating={isReplanning} />
      ) : null}
    </View>
  );
}

function formatRamp(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${Math.round(pct)} %`;
}

const useStyles = makeStyles((t) => ({
  bannerPrudence: {
    backgroundColor: t.prudenceWash,
    borderRadius: Rounded.sm,
    borderLeftWidth: 1,
    borderLeftColor: t.prudence,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  bannerGo: {
    backgroundColor: t.goWash,
    borderRadius: Rounded.sm,
    borderLeftWidth: 1,
    borderLeftColor: t.go,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  signals: { gap: Spacing.one },
}));

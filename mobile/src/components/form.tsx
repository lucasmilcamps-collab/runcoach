import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxFormWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pressable } from '@/lib/pressable';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The shared parts of a form screen.
 *
 * Plan setup, add-activity and injury-report each carried their own copy of a
 * `Field` component, their own safe-area and keyboard scaffolding, and their own
 * action footer — three near-identical implementations that had already drifted:
 * `Field` labelled itself with body-sized text while `TextField`, sitting in the
 * same column, used the mono kicker. One column, two label treatments.
 *
 * In this world a form is a filled-in register: mono labels down the left, rules
 * between the groups, the commitment pinned at the bottom.
 */
export function FormScreen({
  kicker,
  title,
  blurb,
  children,
  actions,
}: {
  kicker: string;
  title: string;
  blurb?: string;
  children: ReactNode;
  /** Pinned below the scroll, primary first: the one commitment and its way
   * out. An array rather than a fragment so the footer can lay them out. */
  actions: ReactNode[];
}) {
  const styles = useStyles();
  // A phone in landscape is ~390pt tall. Two stacked full-width buttons plus
  // the header left a single row of the form visible, which is not a form. Side
  // by side halves the footer; `row-reverse` keeps the primary on the right,
  // where a horizontal pair puts it, without reordering the array.
  const short = useWindowDimensions().height < 520;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <ThemedText type="label" themeColor="inkMuted">
              {kicker}
            </ThemedText>
            <ThemedText type="title">{title}</ThemedText>
            {blurb ? (
              <ThemedText type="default" themeColor="inkMuted">
                {blurb}
              </ThemedText>
            ) : null}
          </View>
          {children}
        </ScrollView>
        <View style={[styles.actions, short && styles.actionsRow]}>
          {actions.map((action, index) => (
            <View key={index} style={short ? styles.actionSlot : undefined}>
              {action}
            </View>
          ))}
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/**
 * A named group of fields, opened by a rule.
 *
 * A long form read as ten equally-weighted boxes in one column, which is how an
 * athlete ends up scrolling past the thing they came to change. Sections give it
 * three answers to give instead of ten.
 */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();

  return (
    <View style={styles.section}>
      <View style={styles.rule} />
      {/* A heading, not another kicker: at `label` the section title and the
          field labels below it were the same mono uppercase at the same size,
          and the group stopped reading as a group. */}
      <ThemedText type="subtitle">{title}</ThemedText>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

/**
 * One question and its control. `hint` sits between the two — the sentence that
 * says how to choose belongs before the choice, not under it.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const styles = useStyles();

  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="inkMuted">
        {label}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="inkMuted">
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

/** The wrapper every set of chips was re-declaring. */
export function ChipRow({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.chipRow}>{children}</View>;
}

/**
 * A yes/no setting, as the platform's own switch.
 *
 * It replaces a single chip whose label read "Activé" / "Désactivé" and whose
 * selected state said the same thing again — a control that answered its own
 * question twice and looked like a filter. The whole row is the target, which
 * is how a settings row behaves everywhere else on the platform.
 *
 * The track takes neutral Ink when on, never a signal ink: in this system green
 * means "today's key session", and a switch is a command (DESIGN.md).
 */
export function ToggleField({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={pressable(styles.toggle)}>
      <View style={styles.toggleText}>
        <ThemedText type="default">{label}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="inkMuted">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {/* Not focusable itself: the row already carries the role, the label and
          the press target, and two tab stops for one setting is one too many. */}
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.inset, true: theme.ink }}
        thumbColor={Platform.OS === 'android' ? theme.surface : undefined}
        ios_backgroundColor={theme.inset}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  content: {
    gap: Spacing.four,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  header: { gap: Spacing.two },
  section: { gap: Spacing.three, paddingTop: Spacing.two },
  sectionBody: { gap: Spacing.four },
  rule: { height: 1, backgroundColor: t.rule },
  field: { gap: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 44,
  },
  toggleText: { flex: 1, gap: Spacing.half },
  actions: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
  },
  actionsRow: {
    flexDirection: 'row-reverse',
    paddingBottom: Spacing.three,
  },
  actionSlot: { flex: 1 },
}));

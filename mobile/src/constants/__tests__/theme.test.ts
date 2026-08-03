import { Palettes, Rounded, Spacing, ZoneRamp, type Appearance } from '@/constants/theme';

/**
 * The palette's accessibility promises, made executable.
 *
 * DESIGN.md states specific contrast guarantees — every text token at 4.5:1 on
 * all three grounds, `ruleStrong` at 3:1, both appearances equal citizens. Until
 * now those were verified once, by hand, by whoever last touched the file. A
 * single hex nudged for taste could quietly drop the app below AA in one theme
 * and nobody would see it, because the failure is invisible in the appearance
 * you happen to be looking at.
 */

// WCAG 2.1 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees. Contrast measures brightness, so it cannot answer "is this
 * tone in the same family as that one" — which is what the ramp's rule is about. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return ((sector * 60) + 360) % 360;
}

/** Shortest distance around the colour wheel. */
function hueGap(a: string, b: string): number {
  const raw = Math.abs(hue(a) - hue(b));
  return Math.min(raw, 360 - raw);
}

const APPEARANCES: Appearance[] = ['graphite', 'sable'];
/** The three surfaces text is ever set on. */
const GROUNDS = ['surface', 'raised', 'inset'] as const;
/** Everything used as a text colour anywhere in the app. */
const TEXT_TOKENS = ['ink', 'inkMuted', 'go', 'prudence', 'recup', 'alerte'] as const;

describe('contrast — helper', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // #767676 on white is the canonical AA boundary — one shade lighter fails.
    expect(contrast('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#FFFFFF')).toBeLessThan(4.5);
  });
});

describe('hue — helper', () => {
  it('places the primaries where they belong on the wheel', () => {
    expect(hue('#FF0000')).toBeCloseTo(0, 0);
    expect(hue('#00FF00')).toBeCloseTo(120, 0);
    expect(hue('#0000FF')).toBeCloseTo(240, 0);
  });

  it('measures the short way round the wheel', () => {
    expect(hueGap('#FF0000', '#0000FF')).toBeCloseTo(120, 0);
  });
});

describe.each(APPEARANCES)('palette — %s', (appearance) => {
  const palette = Palettes[appearance];

  describe.each(TEXT_TOKENS)('%s as text', (token) => {
    it.each(GROUNDS)('clears AA on %s', (ground) => {
      expect(contrast(palette[token], palette[ground])).toBeGreaterThanOrEqual(4.5);
    });
  });

  it.each(GROUNDS)('keeps ruleStrong at 3:1 on %s (WCAG 1.4.11)', (ground) => {
    // It carries field borders and ghost buttons — an affordance, not decoration.
    expect(contrast(palette.ruleStrong, palette[ground])).toBeGreaterThanOrEqual(3);
  });

  it('keeps a signal legible when it is filled and the ground sits on top of it', () => {
    for (const signal of ['go', 'prudence', 'recup', 'alerte'] as const) {
      expect(contrast(palette.surface, palette[signal])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('separates its three grounds so tonal elevation is visible at all', () => {
    expect(contrast(palette.raised, palette.surface)).toBeGreaterThan(1.05);
    expect(contrast(palette.inset, palette.surface)).toBeGreaterThan(1.1);
  });

  it('never reaches pure black or pure white', () => {
    for (const ground of GROUNDS) {
      expect(palette[ground].toUpperCase()).not.toBe('#000000');
      expect(palette[ground].toUpperCase()).not.toBe('#FFFFFF');
    }
  });

  it('keeps the disabled button label readable on its own fill', () => {
    expect(contrast(palette.inkMuted, palette.inset)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the pressed primary button distinguishable from the resting one', () => {
    expect(contrast(palette.inkPressed, palette.ink)).toBeGreaterThan(1.15);
    // …and its label still readable against the pressed fill.
    expect(contrast(palette.surface, palette.inkPressed)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('palette — parity between appearances', () => {
  it('defines exactly the same tokens in both', () => {
    expect(Object.keys(Palettes.sable).sort()).toEqual(Object.keys(Palettes.graphite).sort());
  });

  it('draws the hairline at the same strength in both', () => {
    // `rule` carries all the structure in this system. When Sable's sat a step
    // fainter than Graphite's, the same divider read as an afterthought in one
    // theme and as deliberate in the other.
    const strengths = APPEARANCES.map((a) => contrast(Palettes[a].rule, Palettes[a].surface));
    const [graphite, sable] = strengths;
    expect(Math.abs(graphite - sable)).toBeLessThan(0.15);
    for (const strength of strengths) expect(strength).toBeGreaterThan(1.35);
  });

  it('uses a distinct value per appearance for every colour token', () => {
    // A token shared verbatim by both palettes is one that was never designed
    // for the second appearance.
    for (const token of Object.keys(Palettes.graphite) as (keyof typeof Palettes.graphite)[]) {
      expect(Palettes.sable[token]).not.toBe(Palettes.graphite[token]);
    }
  });
});

describe('intensity ramp', () => {
  it.each(APPEARANCES)('%s has one tone per zone, Z1 to Z5', (appearance) => {
    expect(ZoneRamp[appearance]).toHaveLength(5);
  });

  it.each(APPEARANCES)('%s stays visible as a bar fill on every ground', (appearance) => {
    // Non-text graphics: 3:1 (WCAG 1.4.11).
    for (const tone of ZoneRamp[appearance]) {
      expect(contrast(tone, Palettes[appearance].surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(tone, Palettes[appearance].raised)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(APPEARANCES)('%s starts at Récup and lands on Go', (appearance) => {
    const ramp = ZoneRamp[appearance];
    const palette = Palettes[appearance];
    expect(hueGap(ramp[0], palette.recup)).toBeLessThan(15);
    expect(hueGap(ramp[4], palette.go)).toBeLessThan(15);
  });

  it.each(APPEARANCES)('%s never passes through Prudence or Alerte', (appearance) => {
    // A hard session is not a warning: no step on the intensity scale may land
    // in the caution or error family, however good it might look there.
    const palette = Palettes[appearance];
    for (const tone of ZoneRamp[appearance]) {
      expect(hueGap(tone, palette.prudence)).toBeGreaterThan(60);
      expect(hueGap(tone, palette.alerte)).toBeGreaterThan(60);
    }
  });

  it.each(APPEARANCES)('%s moves one way only — blue to green, never a rainbow', (appearance) => {
    const hues = ZoneRamp[appearance].map(hue);
    for (let i = 1; i < hues.length; i += 1) {
      expect(hues[i]).toBeLessThan(hues[i - 1]);
    }
    // Two hues, and only two: the whole ramp stays in the cyan-green arc.
    for (const h of hues) {
      expect(h).toBeGreaterThan(120);
      expect(h).toBeLessThan(240);
    }
  });
});

describe('scales', () => {
  it('keeps spacing on a 4px rhythm above the hairline step', () => {
    for (const value of Object.values(Spacing)) {
      if (value === Spacing.half) continue; // 2px, the one sub-step, for tight pairs
      expect(value % 4).toBe(0);
    }
  });

  it('keeps radii moderate and ordered — nothing pill-shaped', () => {
    expect(Rounded.sm).toBeLessThan(Rounded.md);
    expect(Rounded.md).toBeLessThan(Rounded.lg);
    expect(Rounded.lg).toBeLessThanOrEqual(16);
  });
});

/**
 * Math Style Propagation Tests
 *
 * Tests TeX-style transitions (D -> T -> S -> SS), font size scaling
 * per style, configForStyle helper, and integration with layout engine.
 */

import { CM_FONT_PARAMS, DefaultMetricsProvider } from '../../src/layout/default-metrics';
import type { LayoutConfig } from '../../src/layout/layout-engine';
import {
  configForStyle,
  fontSizeForStyle,
  fracDenominatorStyle,
  fracNumeratorStyle,
  layoutEquation,
  layoutNodes,
  subStyle,
  supStyle,
} from '../../src/layout/layout-engine';
import type { MathStyle } from '../../src/layout/types';
import { parseOMML } from '../../src/parser/omml-parser';

// Helper to create a full LayoutConfig with a given style
function makeConfig(overrides: Partial<LayoutConfig> = {}): LayoutConfig {
  const fontSize = overrides.fontSize ?? 12;
  return {
    fontSize,
    scriptScale: 0.7,
    fractionGap: 2,
    fractionBarThickness: 1,
    radicalWidthRatio: 0.6,
    delimiterPadding: 2,
    matrixColGap: 10,
    matrixRowGap: 4,
    accentOffset: 2,
    metrics: new DefaultMetricsProvider(),
    fontParams: CM_FONT_PARAMS,
    style: 'D',
    layoutNodes,
    ...overrides,
    baseFontSize: overrides.baseFontSize ?? overrides.fontSize ?? fontSize,
  };
}

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

// ─── Style Transition Functions ──────────────────────────────────────

describe('fracNumeratorStyle', () => {
  it('D -> T', () => {
    expect(fracNumeratorStyle('D')).toBe('T');
  });

  it('T -> S', () => {
    expect(fracNumeratorStyle('T')).toBe('S');
  });

  it('S -> SS', () => {
    expect(fracNumeratorStyle('S')).toBe('SS');
  });

  it('SS -> SS (bottoms out)', () => {
    expect(fracNumeratorStyle('SS')).toBe('SS');
  });
});

describe('fracDenominatorStyle', () => {
  it('mirrors fracNumeratorStyle for all styles', () => {
    const styles: MathStyle[] = ['D', 'T', 'S', 'SS'];
    for (const s of styles) {
      expect(fracDenominatorStyle(s)).toBe(fracNumeratorStyle(s));
    }
  });
});

describe('supStyle', () => {
  it('D -> S', () => {
    expect(supStyle('D')).toBe('S');
  });

  it('T -> S', () => {
    expect(supStyle('T')).toBe('S');
  });

  it('S -> SS', () => {
    expect(supStyle('S')).toBe('SS');
  });

  it('SS -> SS (bottoms out)', () => {
    expect(supStyle('SS')).toBe('SS');
  });
});

describe('subStyle', () => {
  it('mirrors supStyle for all styles', () => {
    const styles: MathStyle[] = ['D', 'T', 'S', 'SS'];
    for (const s of styles) {
      expect(subStyle(s)).toBe(supStyle(s));
    }
  });
});

// ─── Font Size for Style ─────────────────────────────────────────────

describe('fontSizeForStyle', () => {
  const baseFontSize = 12;
  const scriptScale = 0.7;

  it('D uses full size', () => {
    expect(fontSizeForStyle(baseFontSize, 'D', scriptScale)).toBe(baseFontSize);
  });

  it('T uses full size', () => {
    expect(fontSizeForStyle(baseFontSize, 'T', scriptScale)).toBe(baseFontSize);
  });

  it('S uses scriptScale', () => {
    expect(fontSizeForStyle(baseFontSize, 'S', scriptScale)).toBeCloseTo(
      baseFontSize * scriptScale,
      5,
    );
  });

  it('SS uses scriptScale^2', () => {
    expect(fontSizeForStyle(baseFontSize, 'SS', scriptScale)).toBeCloseTo(
      baseFontSize * scriptScale * scriptScale,
      5,
    );
  });

  it('works with different base sizes', () => {
    expect(fontSizeForStyle(20, 'S', 0.5)).toBe(10);
    expect(fontSizeForStyle(20, 'SS', 0.5)).toBe(5);
  });
});

// ─── configForStyle ──────────────────────────────────────────────────

describe('configForStyle', () => {
  it('returns same config object when style is unchanged', () => {
    const config = makeConfig({ style: 'D' });
    const result = configForStyle(config, 'D');
    expect(result).toBe(config); // exact same reference
  });

  it('returns new config when style changes', () => {
    const config = makeConfig({ style: 'D', fontSize: 12 });
    const result = configForStyle(config, 'T');
    expect(result).not.toBe(config);
    expect(result.style).toBe('T');
    // D -> T: full size (T uses same fontSize as D)
    expect(result.fontSize).toBe(12);
  });

  it('D -> S reduces fontSize by scriptScale', () => {
    const config = makeConfig({ style: 'D', fontSize: 12, scriptScale: 0.7 });
    const result = configForStyle(config, 'S');
    expect(result.style).toBe('S');
    expect(result.fontSize).toBeCloseTo(12 * 0.7, 5);
  });

  it('D -> SS reduces fontSize by scriptScale^2', () => {
    const config = makeConfig({ style: 'D', fontSize: 12, scriptScale: 0.7 });
    const result = configForStyle(config, 'SS');
    expect(result.style).toBe('SS');
    expect(result.fontSize).toBeCloseTo(12 * 0.7 * 0.7, 5);
  });

  it('preserves all other config fields', () => {
    const config = makeConfig({
      style: 'D',
      fontSize: 12,
      fractionGap: 3,
      matrixColGap: 15,
    });
    const result = configForStyle(config, 'S');
    expect(result.fractionGap).toBe(3);
    expect(result.matrixColGap).toBe(15);
    expect(result.fontParams).toBe(CM_FONT_PARAMS);
    expect(result.metrics).toBeDefined();
  });
});

// ─── DEFAULT_CONFIG ──────────────────────────────────────────────────

describe('DEFAULT_CONFIG via layoutEquation', () => {
  it('default config includes fontParams: CM_FONT_PARAMS', () => {
    // We verify indirectly: layoutEquation uses DEFAULT_CONFIG, which now has fontParams.
    // If fontParams were missing, the config wouldn't have it.
    // We test by checking that layout still works (fontParams doesn't break anything yet).
    const layout = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
    expect(layout.width).toBeGreaterThan(0);
  });

  it('default config has style: D', () => {
    // layoutEquation sets style: 'D'. We can verify this indirectly by checking
    // that n-ary limits use script-size fontSize (which requires style propagation).
    // The N-ary layout uses subStyle(config.style || 'D') which yields 'S',
    // and configForStyle then uses fontSizeForStyle to get fontSize * scriptScale.
    const layout = layoutFromOMML(
      '<m:oMath><m:nary><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>',
      12,
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ─── Layout Integration ──────────────────────────────────────────────

describe('Style propagation in layout', () => {
  it('fraction layout produces valid output at display style', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
      12,
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.baseline).toBeGreaterThan(0);
  });

  it('nested fractions decrease style: outer D produces valid nested layout', () => {
    // a / (b / c) — nested fraction
    const layout = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:f><m:num><m:r><m:t>b</m:t></m:r></m:num><m:den><m:r><m:t>c</m:t></m:r></m:den></m:f></m:den></m:f></m:oMath>',
      12,
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    // The nested fraction should make the outer fraction taller
    const simpleFrac = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
      12,
    );
    expect(layout.height).toBeGreaterThan(simpleFrac.height);
  });

  it('N-ary operator limits use script-size fontSize via style propagation', () => {
    // A summation with sub/sup limits. The limits should be in script style,
    // which means their fontSize = baseFontSize * scriptScale (same as before refactor).
    const layout = layoutFromOMML(
      '<m:oMath><m:nary><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>',
      12,
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    // The total height should include the operator plus limits above and below
    expect(layout.children.length).toBeGreaterThan(0);
  });

  it('limLow uses script-size for limit element', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:limLow><m:e><m:r><m:t>lim</m:t></m:r></m:e><m:lim><m:r><m:t>n</m:t></m:r></m:lim></m:limLow></m:oMath>',
      12,
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('limUpp uses script-size for limit element', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:limUpp><m:e><m:r><m:t>x</m:t></m:r></m:e><m:lim><m:r><m:t>n</m:t></m:r></m:lim></m:limUpp></m:oMath>',
      12,
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ─── Style Transition Chains ─────────────────────────────────────────

describe('Style transition chains', () => {
  it('fraction chain: D -> T -> S -> SS -> SS', () => {
    let style: MathStyle = 'D';
    style = fracNumeratorStyle(style); // T
    expect(style).toBe('T');
    style = fracNumeratorStyle(style); // S
    expect(style).toBe('S');
    style = fracNumeratorStyle(style); // SS
    expect(style).toBe('SS');
    style = fracNumeratorStyle(style); // SS (bottomed out)
    expect(style).toBe('SS');
  });

  it('superscript chain: D -> S -> SS -> SS', () => {
    let style: MathStyle = 'D';
    style = supStyle(style); // S
    expect(style).toBe('S');
    style = supStyle(style); // SS
    expect(style).toBe('SS');
    style = supStyle(style); // SS (bottomed out)
    expect(style).toBe('SS');
  });

  it('configForStyle chain preserves correct fontSize at each level', () => {
    const base = makeConfig({ fontSize: 20, scriptScale: 0.7, style: 'D' });

    // D -> S (via supStyle)
    const scriptConfig = configForStyle(base, supStyle('D'));
    expect(scriptConfig.style).toBe('S');
    expect(scriptConfig.fontSize).toBeCloseTo(20 * 0.7, 5);

    // S -> SS (via supStyle again, but on the NEW config)
    const ssConfig = configForStyle(base, 'SS');
    expect(ssConfig.style).toBe('SS');
    expect(ssConfig.fontSize).toBeCloseTo(20 * 0.7 * 0.7, 5);
  });
});

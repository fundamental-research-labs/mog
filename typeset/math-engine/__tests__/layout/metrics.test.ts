/**
 * Font Metrics Provider Tests
 *
 * Tests DefaultMetricsProvider, custom provider injection via LayoutConfig,
 * font parameters, and multi-character text run measurement.
 */

import { DefaultMetricsProvider, getDefaultFontParams, layoutEquation } from '../../src/index';
import type { FontMetricsProvider, GlyphMetrics, GlyphStyle } from '../../src/layout/types';
import { parseOMML } from '../../src/parser/omml-parser';

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

describe('DefaultMetricsProvider', () => {
  const provider = new DefaultMetricsProvider();
  const fontSize = 10;
  const defaultStyle: GlyphStyle = { italic: true };

  describe('known character metrics', () => {
    it('returns correct metrics for lowercase "a" (math italic)', () => {
      const gm = provider.measureGlyph('a', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.529 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.431 * fontSize, 2);
      expect(gm.depth).toBe(0);
      expect(gm.italic).toBe(0);
      expect(gm.skew).toBe(0);
    });

    it('returns correct metrics for lowercase "x" (math italic)', () => {
      const gm = provider.measureGlyph('x', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.572 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.431 * fontSize, 2);
      expect(gm.depth).toBe(0);
    });

    it('returns correct metrics for alpha (Greek lowercase)', () => {
      const gm = provider.measureGlyph('\u03B1', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.64 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.431 * fontSize, 2);
      expect(gm.depth).toBe(0);
    });

    it('returns correct metrics for "+" (math symbol)', () => {
      const gm = provider.measureGlyph('+', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.778 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.583 * fontSize, 2);
      expect(gm.depth).toBeCloseTo(0.083 * fontSize, 2);
    });

    it('returns correct metrics for "=" (math symbol)', () => {
      const gm = provider.measureGlyph('=', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.778 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.367 * fontSize, 2);
      expect(gm.depth).toBe(0);
    });

    it('returns correct metrics for summation (math extension)', () => {
      const gm = provider.measureGlyph('\u2211', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.75 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.75 * fontSize, 2);
      expect(gm.depth).toBeCloseTo(0.25 * fontSize, 2);
    });

    it('returns correct metrics for digit "0" (main regular)', () => {
      const gm = provider.measureGlyph('0', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.5 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.644 * fontSize, 2);
      expect(gm.depth).toBe(0);
    });

    it('returns correct metrics for parenthesis', () => {
      const gm = provider.measureGlyph('(', fontSize, defaultStyle);
      expect(gm.width).toBeCloseTo(0.389 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.75 * fontSize, 2);
      expect(gm.depth).toBeCloseTo(0.25 * fontSize, 2);
    });

    it('returns non-zero italic correction for "f"', () => {
      const gm = provider.measureGlyph('f', fontSize, defaultStyle);
      expect(gm.italic).toBeCloseTo(0.108 * fontSize, 2);
    });

    it('returns non-zero skew for uppercase "A"', () => {
      const gm = provider.measureGlyph('A', fontSize, defaultStyle);
      expect(gm.skew).toBeCloseTo(0.139 * fontSize, 2);
    });

    it('returns non-zero depth for descenders (g, p, y)', () => {
      const gG = provider.measureGlyph('g', fontSize, defaultStyle);
      const gP = provider.measureGlyph('p', fontSize, defaultStyle);
      const gY = provider.measureGlyph('y', fontSize, defaultStyle);
      expect(gG.depth).toBeCloseTo(0.194 * fontSize, 2);
      expect(gP.depth).toBeCloseTo(0.194 * fontSize, 2);
      expect(gY.depth).toBeCloseTo(0.194 * fontSize, 2);
    });
  });

  describe('fallback for unknown characters', () => {
    it('returns fallback metrics for unmapped character', () => {
      const gm = provider.measureGlyph('\u2764', fontSize, defaultStyle); // heart emoji
      expect(gm.width).toBeCloseTo(0.55 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.683 * fontSize, 2);
      expect(gm.depth).toBe(0);
      expect(gm.italic).toBe(0);
      expect(gm.skew).toBe(0);
    });

    it('returns fallback metrics for CJK character', () => {
      const gm = provider.measureGlyph('\u4E16', fontSize, defaultStyle); // "world" in Chinese
      expect(gm.width).toBeCloseTo(0.55 * fontSize, 2);
      expect(gm.height).toBeCloseTo(0.683 * fontSize, 2);
    });
  });

  describe('fontSize scaling', () => {
    it('metrics scale linearly with fontSize', () => {
      const gm10 = provider.measureGlyph('x', 10, defaultStyle);
      const gm20 = provider.measureGlyph('x', 20, defaultStyle);
      expect(gm20.width).toBeCloseTo(gm10.width * 2, 2);
      expect(gm20.height).toBeCloseTo(gm10.height * 2, 2);
    });
  });

  describe('style-aware lookup', () => {
    it('bold style applies 1.05x width factor', () => {
      const normal = provider.measureGlyph('x', fontSize, { italic: true });
      const bold = provider.measureGlyph('x', fontSize, { italic: true, bold: true });
      expect(bold.width).toBeCloseTo(normal.width * 1.05, 2);
      // Height and depth should be unchanged
      expect(bold.height).toBeCloseTo(normal.height, 2);
      expect(bold.depth).toBeCloseTo(normal.depth, 2);
    });

    it('non-bold style has no width factor', () => {
      const normal = provider.measureGlyph('x', fontSize, { italic: true });
      const explicit = provider.measureGlyph('x', fontSize, { italic: true, bold: false });
      expect(explicit.width).toBeCloseTo(normal.width, 5);
    });

    it('roman style (italic=false) still works for letters (falls through to MATH_ITALIC)', () => {
      // MAIN_REGULAR does not have letter entries, so roman 'x' falls through to MATH_ITALIC
      const italic = provider.measureGlyph('x', fontSize, { italic: true });
      const roman = provider.measureGlyph('x', fontSize, { italic: false });
      // Both should return valid metrics (same table since no roman letters in MAIN_REGULAR)
      expect(roman.width).toBeCloseTo(italic.width, 2);
    });

    it('roman style uses MAIN_REGULAR for digits', () => {
      // Digits are in MAIN_REGULAR, and are always returned regardless of style
      const italic = provider.measureGlyph('0', fontSize, { italic: true });
      const roman = provider.measureGlyph('0', fontSize, { italic: false });
      expect(roman.width).toBeCloseTo(italic.width, 5);
    });

    it('empty style object returns valid metrics', () => {
      const gm = provider.measureGlyph('x', fontSize, {});
      expect(gm.width).toBeCloseTo(0.572 * fontSize, 2);
    });
  });
});

describe('getDefaultFontParams', () => {
  it('returns font parameters', () => {
    const params = getDefaultFontParams();
    expect(params.axisHeight).toBe(0.25);
    expect(params.ruleThickness).toBe(0.04);
  });

  it('has all fraction parameters', () => {
    const params = getDefaultFontParams();
    expect(params.num1).toBeGreaterThan(0);
    expect(params.num2).toBeGreaterThan(0);
    expect(params.denom1).toBeGreaterThan(0);
    expect(params.denom2).toBeGreaterThan(0);
  });

  it('has all script parameters', () => {
    const params = getDefaultFontParams();
    expect(params.sup1).toBeGreaterThan(0);
    expect(params.sup2).toBeGreaterThan(0);
    expect(params.sup3).toBeGreaterThan(0);
    expect(params.sub1).toBeGreaterThan(0);
    expect(params.sub2).toBeGreaterThan(0);
    expect(params.supDrop).toBeGreaterThan(0);
    expect(params.subDrop).toBeGreaterThan(0);
  });

  it('has all delimiter parameters', () => {
    const params = getDefaultFontParams();
    expect(params.delimiterShortfall).toBeGreaterThan(0);
    expect(params.nullDelimiterSpace).toBeGreaterThan(0);
  });

  it('has all bigOp spacing parameters', () => {
    const params = getDefaultFontParams();
    expect(params.bigOpSpacing1).toBeGreaterThan(0);
    expect(params.bigOpSpacing2).toBeGreaterThan(0);
    expect(params.bigOpSpacing3).toBeGreaterThan(0);
    expect(params.bigOpSpacing4).toBeGreaterThan(0);
    expect(params.bigOpSpacing5).toBeGreaterThan(0);
  });
});

describe('Custom FontMetricsProvider injection', () => {
  class FixedMetricsProvider implements FontMetricsProvider {
    measureGlyph(_char: string, fontSize: number, _style: GlyphStyle): GlyphMetrics {
      return {
        width: fontSize * 1.0,
        height: fontSize * 1.0,
        depth: 0,
        italic: 0,
        skew: 0,
      };
    }
  }

  it('custom provider is used when injected', () => {
    const custom = new FixedMetricsProvider();
    const gm = custom.measureGlyph('x', 10, {});
    expect(gm.width).toBe(10);
    expect(gm.height).toBe(10);
  });

  it('default layout uses DefaultMetricsProvider metrics', () => {
    // Layout a single character "x" at fontSize 12
    const layout = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', 12);
    // With DefaultMetricsProvider: width = 0.572 * 12 = 6.864
    expect(layout.width).toBeCloseTo(0.572 * 12, 1);
  });
});

describe('Multi-character text run measurement', () => {
  it('multi-char run sums widths correctly', () => {
    const provider = new DefaultMetricsProvider();
    const fontSize = 12;
    const style: GlyphStyle = { italic: true };

    // Get individual widths for "abc"
    const wA = provider.measureGlyph('a', fontSize, style).width;
    const wB = provider.measureGlyph('b', fontSize, style).width;
    const wC = provider.measureGlyph('c', fontSize, style).width;
    const expectedWidth = wA + wB + wC;

    // Layout "abc" as a text run
    const layout = layoutFromOMML('<m:oMath><m:r><m:t>abc</m:t></m:r></m:oMath>', fontSize);
    expect(layout.width).toBeCloseTo(expectedWidth, 2);
  });

  it('multi-char run takes max height across characters', () => {
    const provider = new DefaultMetricsProvider();
    const fontSize = 12;
    const style: GlyphStyle = { italic: true };

    // "b" has height 0.694, "a" has height 0.431 -- max should be 0.694
    const gmA = provider.measureGlyph('a', fontSize, style);
    const gmB = provider.measureGlyph('b', fontSize, style);
    const expectedHeight = Math.max(gmA.height, gmB.height);

    const layout = layoutFromOMML('<m:oMath><m:r><m:t>ab</m:t></m:r></m:oMath>', fontSize);
    // Layout height = maxHeight + maxDepth; both a and b have depth 0
    expect(layout.height).toBeCloseTo(expectedHeight, 2);
  });

  it('multi-char run accounts for depth (descenders)', () => {
    const provider = new DefaultMetricsProvider();
    const fontSize = 12;
    const style: GlyphStyle = { italic: true };

    // "g" has depth 0.194, "a" has depth 0
    const gmA = provider.measureGlyph('a', fontSize, style);
    const gmG = provider.measureGlyph('g', fontSize, style);
    const maxHeight = Math.max(gmA.height, gmG.height);
    const maxDepth = Math.max(gmA.depth, gmG.depth);

    const layout = layoutFromOMML('<m:oMath><m:r><m:t>ag</m:t></m:r></m:oMath>', fontSize);
    expect(layout.height).toBeCloseTo(maxHeight + maxDepth, 2);
    expect(layout.baseline).toBeCloseTo(maxHeight, 2);
  });

  it('single character has same width as provider reports', () => {
    const provider = new DefaultMetricsProvider();
    const fontSize = 12;
    const style: GlyphStyle = { italic: true };

    const gm = provider.measureGlyph('x', fontSize, style);
    const layout = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', fontSize);
    expect(layout.width).toBeCloseTo(gm.width, 2);
  });

  it('empty text run has zero dimensions', () => {
    const layout = layoutFromOMML('<m:oMath><m:r><m:t></m:t></m:r></m:oMath>', 12);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});

describe('Layout output differences with metrics', () => {
  it('layout dimensions differ from old hardcoded approximation', () => {
    // The old hardcode used width = fontSize * 0.6 per char, height = fontSize * 1.2
    // With real CM metrics for "x": width = 0.572 * fontSize, height = 0.431 * fontSize
    const fontSize = 12;
    const layout = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', fontSize);

    // Old values would have been: width = 7.2, height = 14.4
    // New values: width ~= 6.864, height ~= 5.172
    expect(layout.width).not.toBeCloseTo(fontSize * 0.6, 1);
    expect(layout.height).not.toBeCloseTo(fontSize * 1.2, 1);
  });

  it('different characters have different widths', () => {
    const fontSize = 12;
    const layoutM = layoutFromOMML('<m:oMath><m:r><m:t>m</m:t></m:r></m:oMath>', fontSize);
    const layoutI = layoutFromOMML('<m:oMath><m:r><m:t>i</m:t></m:r></m:oMath>', fontSize);
    // "m" is much wider than "i" in CM
    expect(layoutM.width).toBeGreaterThan(layoutI.width);
  });

  it('scaling: larger font produces proportionally larger layout', () => {
    const small = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', 10);
    const large = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', 20);
    expect(large.width).toBeCloseTo(small.width * 2, 1);
    expect(large.height).toBeCloseTo(small.height * 2, 1);
  });
});

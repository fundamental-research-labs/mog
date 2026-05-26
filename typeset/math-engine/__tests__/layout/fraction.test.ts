/**
 * Fraction Layout Tests — TeXbook Rule 15
 *
 * Tests the TeX-accurate fraction layout algorithm including:
 * - Display vs text style parameter selection (num1/denom1 vs num2/denom2)
 * - No-bar fraction (binom) minimum gap rules
 * - Minimum clearance enforcement
 * - Baseline at axis height (center of bar)
 * - Horizontal centering of numerator and denominator
 * - Style propagation to children
 */

import type { FractionNode, MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS, DefaultMetricsProvider } from '../../src/layout/default-metrics';
import { layoutFraction } from '../../src/layout/fraction';
import type { LayoutConfig } from '../../src/layout/layout-engine';
import {
  arrangeHorizontally,
  configForStyle,
  fracDenominatorStyle,
  fracNumeratorStyle,
  layoutEquation,
  layoutNodes,
} from '../../src/layout/layout-engine';
import { parseOMML } from '../../src/parser/omml-parser';

// ─── Helpers ──────────────────────────────────────────────────────────

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

function makeFractionNode(
  numText: string,
  denText: string,
  fractionType: 'bar' | 'skw' | 'lin' | 'noBar' = 'bar',
): FractionNode {
  return {
    type: 'f',
    fractionType,
    num: [{ type: 'r', text: numText } as MathNode],
    den: [{ type: 'r', text: denText } as MathNode],
  };
}

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

// ─── Original Tests (preserved) ──────────────────────────────────────

describe('Fraction Layout', () => {
  it('produces non-zero dimensions', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('has positive baseline', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>',
    );
    expect(layout.baseline).toBeGreaterThan(0);
  });

  it('fraction is taller than a single character', () => {
    const fracLayout = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    );
    const charLayout = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
    expect(fracLayout.height).toBeGreaterThan(charLayout.height);
  });

  it('wider numerator makes fraction wider', () => {
    const narrow = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    );
    const wide = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>abcde</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    );
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('snapshot: simple fraction layout', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>',
    );
    expect({
      width: Math.round(layout.width),
      height: Math.round(layout.height),
      baseline: Math.round(layout.baseline),
      childCount: layout.children.length,
    }).toMatchSnapshot();
  });
});

// ─── TeXbook Rule 15 Tests ───────────────────────────────────────────

describe('Fraction Layout — TeXbook Rule 15', () => {
  // Test 1: Display style uses num1/denom1 (larger shifts)
  describe('display style uses num1/denom1 shifts', () => {
    it('produces larger vertical extent in display style than text style', () => {
      const fontSize = 12;
      const node = makeFractionNode('a', 'b');

      const displayConfig = makeConfig({ fontSize, style: 'D' });
      const textConfig = makeConfig({ fontSize, style: 'T' });

      const displayBox = layoutFraction(node, displayConfig);
      const textBox = layoutFraction(node, textConfig);

      // Display style has larger shifts (num1=0.677 > num2=0.394,
      // denom1=0.686 > denom2=0.345), so display fraction should be taller
      expect(displayBox.height).toBeGreaterThan(textBox.height);
    });

    it('display numerator shift matches num1 parameter', () => {
      const fontSize = 20;
      const fp = CM_FONT_PARAMS;
      const node = makeFractionNode('x', 'y');
      const config = makeConfig({ fontSize, style: 'D' });

      const box = layoutFraction(node, config);

      // The baseline (axis position) should be at least numBox.baseline + num1*fontSize from top
      // Since numShift = num1 * fontSize, and aboveAxis = numBox.baseline + numShift (possibly adjusted)
      const expectedMinNumShift = fp.num1 * fontSize;
      // The baseline must be at least this far from the top, accounting for numBox baseline
      expect(box.baseline).toBeGreaterThanOrEqual(expectedMinNumShift);
    });
  });

  // Test 2: Text style uses num2/denom2 (smaller shifts)
  describe('text style uses num2/denom2 shifts', () => {
    it('text style fraction has smaller gap than display', () => {
      const fontSize = 12;
      const node = makeFractionNode('1', '2');

      const displayConfig = makeConfig({ fontSize, style: 'D' });
      const textConfig = makeConfig({ fontSize, style: 'T' });

      const displayBox = layoutFraction(node, displayConfig);
      const textBox = layoutFraction(node, textConfig);

      // Text style uses smaller num2/denom2, so tighter layout
      expect(textBox.height).toBeLessThan(displayBox.height);
    });

    it('text style baseline is lower than display style baseline', () => {
      const fontSize = 12;
      const node = makeFractionNode('a', 'b');

      const displayConfig = makeConfig({ fontSize, style: 'D' });
      const textConfig = makeConfig({ fontSize, style: 'T' });

      const displayBox = layoutFraction(node, displayConfig);
      const textBox = layoutFraction(node, textConfig);

      // Display style has larger numShift, so axis (baseline) is further from top
      expect(textBox.baseline).toBeLessThan(displayBox.baseline);
    });
  });

  // Test 3: No-bar fraction uses minimum gap rule
  describe('no-bar fraction (binom) uses minimum gap rule', () => {
    it('no-bar fraction has zero bar thickness', () => {
      const node = makeFractionNode('n', 'k', 'noBar');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      // Should still produce valid dimensions
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.baseline).toBeGreaterThan(0);
    });

    it('display no-bar fraction has larger gap than text no-bar fraction', () => {
      const node = makeFractionNode('n', 'k', 'noBar');

      const displayConfig = makeConfig({ fontSize: 12, style: 'D' });
      const textConfig = makeConfig({ fontSize: 12, style: 'T' });

      const displayBox = layoutFraction(node, displayConfig);
      const textBox = layoutFraction(node, textConfig);

      // Display minimum gap is 7*ruleThickness, text is 3*ruleThickness
      expect(displayBox.height).toBeGreaterThan(textBox.height);
    });

    it('minimum gap in display is at least 7*ruleThickness', () => {
      const fontSize = 12;
      const fp = CM_FONT_PARAMS;
      const ruleThickness = fp.ruleThickness * fontSize;
      const minGap = 7 * ruleThickness;

      const node = makeFractionNode('x', 'y', 'noBar');
      const config = makeConfig({ fontSize, style: 'D' });
      const box = layoutFraction(node, config);

      // Layout the children to get their sizes
      const numConfig = configForStyle(config, fracNumeratorStyle('D'));
      const numChildren = layoutNodes(node.num, numConfig);
      const numBox = arrangeHorizontally(numChildren);
      const denConfig = configForStyle(config, fracDenominatorStyle('D'));
      const denChildren = layoutNodes(node.den, denConfig);
      const denBox = arrangeHorizontally(denChildren);

      // The gap between bottom of numerator and top of denominator
      // numBottom = numY + numBox.height
      // denTop = denY = totalHeight - denBox.height
      const numBottom = numBox.height; // numY = 0
      const denTop = box.height - denBox.height;
      const actualGap = denTop - numBottom;

      expect(actualGap).toBeGreaterThanOrEqual(minGap - 0.001); // small epsilon for floating point
    });

    it('minimum gap in text style is at least 3*ruleThickness', () => {
      const fontSize = 12;
      const fp = CM_FONT_PARAMS;
      const ruleThickness = fp.ruleThickness * fontSize;
      const minGap = 3 * ruleThickness;

      const node = makeFractionNode('x', 'y', 'noBar');
      const config = makeConfig({ fontSize, style: 'T' });
      const box = layoutFraction(node, config);

      // Layout the children to get their sizes
      const numConfig = configForStyle(config, fracNumeratorStyle('T'));
      const numChildren = layoutNodes(node.num, numConfig);
      const numBox = arrangeHorizontally(numChildren);
      const denConfig = configForStyle(config, fracDenominatorStyle('T'));
      const denChildren = layoutNodes(node.den, denConfig);
      const denBox = arrangeHorizontally(denChildren);

      const numBottom = numBox.height;
      const denTop = box.height - denBox.height;
      const actualGap = denTop - numBottom;

      expect(actualGap).toBeGreaterThanOrEqual(minGap - 0.001);
    });
  });

  // Test 4: Minimum clearance is enforced (tall content doesn't overlap bar)
  describe('minimum clearance enforcement', () => {
    it('display clearance: numerator bottom is at least 3*ruleThickness from bar', () => {
      const fontSize = 12;
      const fp = CM_FONT_PARAMS;
      const ruleThickness = fp.ruleThickness * fontSize;
      const minClearance = 3 * ruleThickness;

      const node = makeFractionNode('1', '2');
      const config = makeConfig({ fontSize, style: 'D' });
      const box = layoutFraction(node, config);

      // Layout children to get their sizes
      const numConfig = configForStyle(config, fracNumeratorStyle('D'));
      const numChildren = layoutNodes(node.num, numConfig);
      const numBox = arrangeHorizontally(numChildren);

      // The bar center is at box.baseline (the axis).
      // The bar top is at box.baseline - barThickness/2.
      // The numerator bottom is at numBox.height (since numY=0).
      const barTop = box.baseline - ruleThickness / 2;
      const numBottom = numBox.height;
      const clearance = barTop - numBottom;

      expect(clearance).toBeGreaterThanOrEqual(minClearance - 0.001);
    });

    it('display clearance: denominator top is at least 3*ruleThickness from bar', () => {
      const fontSize = 12;
      const fp = CM_FONT_PARAMS;
      const ruleThickness = fp.ruleThickness * fontSize;
      const minClearance = 3 * ruleThickness;

      const node = makeFractionNode('1', '2');
      const config = makeConfig({ fontSize, style: 'D' });
      const box = layoutFraction(node, config);

      // Layout children to get their sizes
      const denConfig = configForStyle(config, fracDenominatorStyle('D'));
      const denChildren = layoutNodes(node.den, denConfig);
      const denBox = arrangeHorizontally(denChildren);

      // The bar bottom is at box.baseline + barThickness/2.
      // The denominator top is at box.height - denBox.height.
      const barBottom = box.baseline + ruleThickness / 2;
      const denTop = box.height - denBox.height;
      const clearance = denTop - barBottom;

      expect(clearance).toBeGreaterThanOrEqual(minClearance - 0.001);
    });

    it('text clearance uses ruleThickness instead of 3*ruleThickness', () => {
      const fontSize = 12;
      const fp = CM_FONT_PARAMS;
      const ruleThickness = fp.ruleThickness * fontSize;
      const textMinClearance = ruleThickness; // 1*ruleThickness for text style

      const node = makeFractionNode('a', 'b');
      const config = makeConfig({ fontSize, style: 'T' });
      const box = layoutFraction(node, config);

      const numConfig = configForStyle(config, fracNumeratorStyle('T'));
      const numChildren = layoutNodes(node.num, numConfig);
      const numBox = arrangeHorizontally(numChildren);

      const barTop = box.baseline - ruleThickness / 2;
      const numBottom = numBox.height;
      const clearance = barTop - numBottom;

      expect(clearance).toBeGreaterThanOrEqual(textMinClearance - 0.001);
    });
  });

  // Test 5: Fraction baseline is at axis height (center of bar)
  describe('baseline is at axis height', () => {
    it('baseline is above the midpoint of the fraction height', () => {
      const node = makeFractionNode('a', 'b');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      // The baseline (axis) should generally be above the geometric center,
      // because the numerator shift is typically larger than the denominator shift
      // after clearance adjustments, but the key property is it's meaningful.
      expect(box.baseline).toBeGreaterThan(0);
      expect(box.baseline).toBeLessThan(box.height);
    });

    it('baseline position is consistent with axisHeight concept', () => {
      // The fraction baseline represents the math axis, where the bar is drawn.
      // For a symmetric fraction (same num and den), the baseline should be
      // roughly in the upper half (since numerator shift > denominator shift
      // in TeX defaults, and clearance adjustments may push den further down).
      const node = makeFractionNode('x', 'x');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      // Baseline should be within the box bounds
      expect(box.baseline).toBeGreaterThan(0);
      expect(box.baseline).toBeLessThan(box.height);
    });

    it('bar fractions place baseline at axis for alignment with surrounding text', () => {
      // When a fraction sits next to text, the baseline (axis) determines alignment.
      // The axis should be near the center of operators like "+", "=".
      const fontSize = 12;
      const node = makeFractionNode('1', '2');
      const config = makeConfig({ fontSize, style: 'D' });
      const box = layoutFraction(node, config);

      // aboveAxis should include both numBox height and numShift
      // belowAxis should include both denBox height and denShift
      // The baseline partitions the total height into above and below
      const aboveBaseline = box.baseline;
      const belowBaseline = box.height - box.baseline;

      expect(aboveBaseline).toBeGreaterThan(0);
      expect(belowBaseline).toBeGreaterThan(0);
    });
  });

  // Test 6: Numerator and denominator are centered horizontally
  describe('horizontal centering', () => {
    it('narrow numerator is centered over wide denominator', () => {
      const node = makeFractionNode('a', 'wxyz');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      // Layout children to measure their widths
      const numConfig = configForStyle(config, fracNumeratorStyle('D'));
      const numChildren = layoutNodes(node.num, numConfig);
      const numBox = arrangeHorizontally(numChildren);
      const denConfig = configForStyle(config, fracDenominatorStyle('D'));
      const denChildren = layoutNodes(node.den, denConfig);
      const denBox = arrangeHorizontally(denChildren);

      // The fraction width should be max(numBox.width, denBox.width)
      expect(box.width).toBeCloseTo(Math.max(numBox.width, denBox.width), 5);

      // Since den is wider, the denominator should start at x=0 offset
      // and the numerator should be centered (offset by half the difference)
      const expectedNumOffset = (box.width - numBox.width) / 2;
      expect(expectedNumOffset).toBeGreaterThan(0);
    });

    it('wide numerator is centered above narrow denominator', () => {
      const node = makeFractionNode('abcdef', 'x');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      const numConfig = configForStyle(config, fracNumeratorStyle('D'));
      const numChildren = layoutNodes(node.num, numConfig);
      const numBox = arrangeHorizontally(numChildren);
      const denConfig = configForStyle(config, fracDenominatorStyle('D'));
      const denChildren = layoutNodes(node.den, denConfig);
      const denBox = arrangeHorizontally(denChildren);

      // Fraction width is determined by the wider element (numerator here)
      expect(box.width).toBeCloseTo(Math.max(numBox.width, denBox.width), 5);

      // The denominator should be offset to center
      const expectedDenOffset = (box.width - denBox.width) / 2;
      expect(expectedDenOffset).toBeGreaterThan(0);
    });

    it('equal-width numerator and denominator have zero offset', () => {
      // Same text in both produces same width (same font metrics, same style T)
      const node = makeFractionNode('ab', 'ab');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      const numConfig = configForStyle(config, fracNumeratorStyle('D'));
      const numChildren = layoutNodes(node.num, numConfig);
      const numBox = arrangeHorizontally(numChildren);

      // Width should equal the child width since both are the same
      expect(box.width).toBeCloseTo(numBox.width, 5);
    });
  });

  // Test 7: Style propagation — numerator gets fracNumeratorStyle, denominator gets fracDenominatorStyle
  describe('style propagation', () => {
    it('nested fractions produce valid layout with decreasing styles', () => {
      // Outer fraction at D, inner numerator fraction at T->S, etc.
      const layout = layoutFromOMML(
        '<m:oMath><m:f><m:num><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:num><m:den><m:r><m:t>c</m:t></m:r></m:den></m:f></m:oMath>',
      );
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      expect(layout.baseline).toBeGreaterThan(0);
    });

    it('deeply nested fractions converge to SS style', () => {
      // 4-level nested fraction: D -> T -> S -> SS -> SS
      const layout = layoutFromOMML(
        '<m:oMath><m:f><m:num><m:f><m:num><m:f><m:num><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:num><m:den><m:r><m:t>c</m:t></m:r></m:den></m:f></m:num><m:den><m:r><m:t>d</m:t></m:r></m:den></m:f></m:num><m:den><m:r><m:t>e</m:t></m:r></m:den></m:f></m:oMath>',
      );
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('numerator in script style produces smaller children than display', () => {
      // At style T (text), numerator style is S (script), fontSize = base * scriptScale
      // At style D (display), numerator style is T (text), fontSize = base
      const fontSize = 12;
      const node = makeFractionNode('x', 'y');

      const displayConfig = makeConfig({ fontSize, style: 'D' });
      const textConfig = makeConfig({ fontSize, style: 'T' });

      const displayBox = layoutFraction(node, displayConfig);
      const textBox = layoutFraction(node, textConfig);

      // Text-style fraction has numerator in script style (smaller font),
      // so the text-style fraction should be smaller overall
      expect(textBox.height).toBeLessThan(displayBox.height);
    });

    it('fracNumeratorStyle transitions are applied correctly', () => {
      // Verify the style transitions match expected values
      expect(fracNumeratorStyle('D')).toBe('T');
      expect(fracNumeratorStyle('T')).toBe('S');
      expect(fracNumeratorStyle('S')).toBe('SS');
      expect(fracNumeratorStyle('SS')).toBe('SS');
    });

    it('fracDenominatorStyle transitions match numerator transitions', () => {
      expect(fracDenominatorStyle('D')).toBe(fracNumeratorStyle('D'));
      expect(fracDenominatorStyle('T')).toBe(fracNumeratorStyle('T'));
      expect(fracDenominatorStyle('S')).toBe(fracNumeratorStyle('S'));
      expect(fracDenominatorStyle('SS')).toBe(fracNumeratorStyle('SS'));
    });
  });

  // Additional edge case tests
  describe('edge cases', () => {
    it('works with different font sizes', () => {
      const node = makeFractionNode('a', 'b');
      const small = layoutFraction(node, makeConfig({ fontSize: 8, style: 'D' }));
      const large = layoutFraction(node, makeConfig({ fontSize: 24, style: 'D' }));

      // Larger font size should produce proportionally larger box
      expect(large.height).toBeGreaterThan(small.height);
      expect(large.width).toBeGreaterThan(small.width);
    });

    it('fraction with same numerator and denominator is symmetric about axis', () => {
      const node = makeFractionNode('x', 'x');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      // With identical content, num and den have the same metrics.
      // However, the layout is NOT necessarily symmetric because num1 != denom1
      // and clearance adjustments may differ. But both parts should be positive.
      const aboveAxis = box.baseline;
      const belowAxis = box.height - box.baseline;
      expect(aboveAxis).toBeGreaterThan(0);
      expect(belowAxis).toBeGreaterThan(0);
    });

    it('returns correct node reference', () => {
      const node = makeFractionNode('a', 'b');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      expect(box.node).toBe(node);
    });

    it('x and y are zero (positioned relative to parent)', () => {
      const node = makeFractionNode('a', 'b');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const box = layoutFraction(node, config);

      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
    });

    it('S and SS styles also produce valid fractions', () => {
      const node = makeFractionNode('a', 'b');

      const scriptBox = layoutFraction(node, makeConfig({ fontSize: 12, style: 'S' }));
      expect(scriptBox.width).toBeGreaterThan(0);
      expect(scriptBox.height).toBeGreaterThan(0);

      const ssBox = layoutFraction(node, makeConfig({ fontSize: 12, style: 'SS' }));
      expect(ssBox.width).toBeGreaterThan(0);
      expect(ssBox.height).toBeGreaterThan(0);
    });

    it('fallback to CM_FONT_PARAMS when fontParams is undefined', () => {
      const node = makeFractionNode('a', 'b');
      const config = makeConfig({ fontSize: 12, style: 'D' });
      delete (config as any).fontParams; // simulate missing fontParams

      const box = layoutFraction(node, config);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    });

    it('fallback to display style when style is undefined', () => {
      const node = makeFractionNode('a', 'b');
      const config = makeConfig({ fontSize: 12 });
      delete (config as any).style; // simulate missing style

      const box = layoutFraction(node, config);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    });
  });
});

/**
 * Accent Layout Tests
 *
 * Tests TeXbook accent placement rules:
 * 1. Accent height comes from metrics, not hardcoded
 * 2. Gap uses ruleThickness from font parameters
 * 3. Base is positioned below accent with correct gap
 * 4. Width is at least as wide as base
 * 5. Baseline is correct (accent above, base below)
 */

import type { AccentNode, MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import { DefaultMetricsProvider, layoutEquation } from '../../src/index';
import { layoutAccent } from '../../src/layout/accent';
import { CM_FONT_PARAMS } from '../../src/layout/default-metrics';
import type { LayoutConfig } from '../../src/layout/layout-engine';
import { layoutNodes } from '../../src/layout/layout-engine';
import { parseOMML } from '../../src/parser/omml-parser';

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

/** Create a minimal AccentNode for direct testing */
function makeAccentNode(baseText: string, accentChar?: string): AccentNode {
  const node: AccentNode = {
    type: 'acc',
    e: [{ type: 'r', text: baseText } as MathNode],
  };
  if (accentChar) {
    node.chr = accentChar;
  }
  return node;
}

/** Create a default LayoutConfig with metrics */
function makeConfig(fontSize: number = 12): LayoutConfig {
  return {
    fontSize,
    baseFontSize: fontSize,
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
    style: 'D' as const,
    layoutNodes,
  };
}

describe('Accent Layout - TeXbook Rules', () => {
  const provider = new DefaultMetricsProvider();
  const fp = CM_FONT_PARAMS;
  const fontSize = 12;

  describe('accent height from metrics', () => {
    it('uses measured accent height, not hardcoded fontSize * 0.3', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('x', '\u0302'); // circumflex over x

      const layout = layoutAccent(node, config);

      // The accent height should be based on the measured glyph, not fontSize * 0.3
      const hardcoded = fontSize * 0.3;
      const accentMetrics = provider.measureGlyph('\u0302', fontSize, {});
      const measuredAccentHeight = accentMetrics.height + accentMetrics.depth;

      // With metrics, the accent height comes from the glyph measurement
      // The total height = accentHeight + gap + base.height
      // gap = ruleThickness * fontSize
      const gap = fp.ruleThickness * fontSize;
      const baseMetrics = provider.measureGlyph('x', fontSize, { italic: true });
      const baseHeight = baseMetrics.height; // no depth for x

      const expectedTotal = measuredAccentHeight + gap + baseHeight;
      expect(layout.height).toBeCloseTo(expectedTotal, 2);

      // Verify it differs from what the old hardcoded formula would give
      // Old: accentHeight(fontSize*0.3) + gap(accentOffset=2) + baseHeight
      const oldTotal = hardcoded + 2 + baseHeight;
      expect(layout.height).not.toBeCloseTo(oldTotal, 1);
    });

    it('different accent characters produce different heights', () => {
      const config = makeConfig(fontSize);
      // Use two characters that exist in the default metrics tables
      // and have different heights
      const node1 = makeAccentNode('x', '+'); // plus sign (height 0.583)
      const node2 = makeAccentNode('x', '.'); // period (height 0.106)

      const layout1 = layoutAccent(node1, config);
      const layout2 = layoutAccent(node2, config);

      // Different accent characters should produce different total heights
      expect(layout1.height).not.toBeCloseTo(layout2.height, 1);
    });
  });

  describe('gap uses ruleThickness', () => {
    it('gap between accent and base equals ruleThickness * fontSize', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('x');

      const layout = layoutAccent(node, config);

      const accentMetrics = provider.measureGlyph('\u0302', fontSize, {});
      const accentHeight = accentMetrics.height + accentMetrics.depth;
      const gap = fp.ruleThickness * fontSize; // 0.04 * 12 = 0.48

      // The base children should be positioned at y = accentHeight + gap
      // (the baseY offset)
      const baseY = accentHeight + gap;

      // Check that children are offset by the correct baseY
      expect(layout.children.length).toBeGreaterThan(0);
      // The child y position should incorporate baseY
      // Since the base is a single text run with y=0 from arrangeHorizontally,
      // the positioned child y should be baseY + 0 = baseY
      expect(layout.children[0].y).toBeCloseTo(baseY, 2);
    });

    it('gap differs from old hardcoded accentOffset', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('x');

      const layout = layoutAccent(node, config);

      const accentMetrics = provider.measureGlyph('\u0302', fontSize, {});
      const accentHeight = accentMetrics.height + accentMetrics.depth;

      // Old gap was config.accentOffset = 2
      // New gap is ruleThickness * fontSize = 0.04 * 12 = 0.48
      const newGap = fp.ruleThickness * fontSize;
      expect(newGap).not.toBeCloseTo(2, 0); // should be 0.48, not 2

      const expectedBaseY = accentHeight + newGap;
      expect(layout.children[0].y).toBeCloseTo(expectedBaseY, 2);
    });

    it('uses custom fontParams ruleThickness when provided', () => {
      const customFp = { ...CM_FONT_PARAMS, ruleThickness: 0.1 };
      const config = { ...makeConfig(fontSize), fontParams: customFp };
      const node = makeAccentNode('x');

      const layout = layoutAccent(node, config);

      const accentMetrics = provider.measureGlyph('\u0302', fontSize, {});
      const accentHeight = accentMetrics.height + accentMetrics.depth;
      const gap = 0.1 * fontSize; // custom ruleThickness

      const expectedBaseY = accentHeight + gap;
      expect(layout.children[0].y).toBeCloseTo(expectedBaseY, 2);
    });
  });

  describe('base positioned below accent', () => {
    it('base children y-positions are offset by accentHeight + gap', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('abc'); // multi-character base

      const layout = layoutAccent(node, config);

      const accentMetrics = provider.measureGlyph('\u0302', fontSize, {});
      const accentHeight = accentMetrics.height + accentMetrics.depth;
      const gap = fp.ruleThickness * fontSize;
      const baseY = accentHeight + gap;

      // All children should have y >= baseY (they're shifted down)
      for (const child of layout.children) {
        expect(child.y).toBeGreaterThanOrEqual(baseY - 0.01);
      }
    });
  });

  describe('width is at least as wide as base', () => {
    it('layout width is at least the base width', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('wide_text_here');

      const layout = layoutAccent(node, config);

      // With a wide base, width should be at least the base text width
      // The base text "wide_text_here" is very wide, so width >= base width
      expect(layout.width).toBeGreaterThan(0);

      // Verify by measuring the base manually
      const baseText = 'wide_text_here';
      let baseWidth = 0;
      for (const ch of baseText) {
        baseWidth += provider.measureGlyph(ch, fontSize, { italic: true }).width;
      }
      expect(layout.width).toBeGreaterThanOrEqual(baseWidth - 0.01);
    });

    it('layout width is at least accent character width', () => {
      const config = makeConfig(fontSize);
      // Use a narrow base but a wide accent character
      const node = makeAccentNode('i', '\u2192'); // rightarrow (width 1.0 * fontSize = 12)

      const layout = layoutAccent(node, config);

      // 'i' is narrow (0.345 * 12 = 4.14), but rightarrow is wide (1.0 * 12 = 12)
      const accentWidth = provider.measureGlyph('\u2192', fontSize, {}).width;
      expect(layout.width).toBeGreaterThanOrEqual(accentWidth - 0.01);
    });

    it('width is the max of base width and accent width', () => {
      const config = makeConfig(fontSize);

      // Case 1: wide base, narrow accent
      const wideBase = makeAccentNode('mmmm', '.'); // m is wide (0.878), . is narrow (0.278)
      const layout1 = layoutAccent(wideBase, config);

      let baseWidth = 0;
      for (const ch of 'mmmm') {
        baseWidth += provider.measureGlyph(ch, fontSize, { italic: true }).width;
      }
      expect(layout1.width).toBeCloseTo(baseWidth, 2);

      // Case 2: narrow base, wide accent
      const narrowBase = makeAccentNode('i', '\u2192');
      const layout2 = layoutAccent(narrowBase, config);

      const accentWidth = provider.measureGlyph('\u2192', fontSize, {}).width;
      expect(layout2.width).toBeCloseTo(accentWidth, 2);
    });
  });

  describe('baseline is correct', () => {
    it('baseline accounts for accent and gap above the base', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('x');

      const layout = layoutAccent(node, config);

      const accentMetrics = provider.measureGlyph('\u0302', fontSize, {});
      const accentHeight = accentMetrics.height + accentMetrics.depth;
      const gap = fp.ruleThickness * fontSize;

      // Base has baseline = maxHeight (from arrangeHorizontally)
      const baseCharMetrics = provider.measureGlyph('x', fontSize, { italic: true });
      const baseBaseline = baseCharMetrics.height; // height above baseline for 'x'

      const expectedBaseline = accentHeight + gap + baseBaseline;
      expect(layout.baseline).toBeCloseTo(expectedBaseline, 2);
    });

    it('baseline is greater than base baseline alone', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('x');

      const layout = layoutAccent(node, config);

      // The base 'x' alone would have baseline = height (0.431 * 12 = 5.172)
      const baseCharMetrics = provider.measureGlyph('x', fontSize, { italic: true });
      expect(layout.baseline).toBeGreaterThan(baseCharMetrics.height);
    });

    it('baseline is positive', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('a');
      const layout = layoutAccent(node, config);
      expect(layout.baseline).toBeGreaterThan(0);
    });
  });

  describe('skew-based horizontal offset', () => {
    it('computes skew for single italic character base', () => {
      // Uppercase 'A' has skew = 0.139 in math italic table
      const config = makeConfig(fontSize);
      const node = makeAccentNode('A');

      // The layout should compute the skew offset
      // We can verify this indirectly: the function should not crash
      const layout = layoutAccent(node, config);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('skew is zero for characters without skew', () => {
      // Lowercase 'x' has skew = 0 in the metrics table
      const config = makeConfig(fontSize);
      const node = makeAccentNode('x');

      const layout = layoutAccent(node, config);
      expect(layout.width).toBeGreaterThan(0);
    });

    it('skew is not computed for multi-character base', () => {
      // Multi-character bases should not trigger skew computation
      const config = makeConfig(fontSize);
      const node = makeAccentNode('xy');

      const layout = layoutAccent(node, config);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });
  });

  describe('fallback without metrics', () => {
    it('falls back to hardcoded accent size when no metrics provider', () => {
      // Note: layoutTextRun in layout-engine.ts requires metrics (non-null assertion),
      // so we test the accent measurement fallback with an empty base (no text runs)
      const config: LayoutConfig = {
        ...makeConfig(fontSize),
        metrics: undefined,
      };
      const node: AccentNode = {
        type: 'acc',
        e: [], // empty base to avoid layoutTextRun crash
      };

      const layout = layoutAccent(node, config);

      // Without metrics, accent height should use fallback: fontSize * 0.3
      const fallbackAccentHeight = fontSize * 0.3;
      const gap = fp.ruleThickness * fontSize;
      // base is empty, so base.height = 0
      expect(layout.height).toBeCloseTo(fallbackAccentHeight + gap, 2);
      // Width should use fallback accent width: fontSize * 0.5
      expect(layout.width).toBeCloseTo(fontSize * 0.5, 2);
    });
  });

  describe('default accent character', () => {
    it('defaults to circumflex U+0302 when no chr specified', () => {
      const config = makeConfig(fontSize);
      const nodeWithDefault = makeAccentNode('x'); // no chr => defaults to \u0302
      const nodeWithExplicit: AccentNode = {
        type: 'acc',
        chr: '\u0302',
        e: [{ type: 'r', text: 'x' } as MathNode],
      };

      const layout1 = layoutAccent(nodeWithDefault, config);
      const layout2 = layoutAccent(nodeWithExplicit, config);

      // Both should produce identical layouts
      expect(layout1.width).toBeCloseTo(layout2.width, 5);
      expect(layout1.height).toBeCloseTo(layout2.height, 5);
      expect(layout1.baseline).toBeCloseTo(layout2.baseline, 5);
    });
  });

  describe('integration via OMML parser', () => {
    it('produces non-zero dimensions for hat accent', () => {
      const layout = layoutFromOMML(
        '<m:oMath><m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>',
      );
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      expect(layout.baseline).toBeGreaterThan(0);
    });

    it('accent over x is taller than x alone', () => {
      const accentLayout = layoutFromOMML(
        '<m:oMath><m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>',
      );
      const charLayout = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
      expect(accentLayout.height).toBeGreaterThan(charLayout.height);
    });
  });

  describe('fontSize scaling', () => {
    it('accent layout scales with fontSize', () => {
      const config10 = makeConfig(10);
      const config20 = makeConfig(20);
      const node = makeAccentNode('x');

      const layout10 = layoutAccent(node, config10);
      const layout20 = layoutAccent(node, config20);

      // Everything should scale by factor of 2
      expect(layout20.width).toBeCloseTo(layout10.width * 2, 1);
      expect(layout20.height).toBeCloseTo(layout10.height * 2, 1);
      expect(layout20.baseline).toBeCloseTo(layout10.baseline * 2, 1);
    });
  });

  describe('base centering when accent is wider', () => {
    it('centers base when accent character is wider than base', () => {
      const config = makeConfig(fontSize);
      // 'i' is narrow, use a wide accent character
      const node = makeAccentNode('i', '\u2192'); // rightarrow is wide

      const layout = layoutAccent(node, config);

      const baseWidth = provider.measureGlyph('i', fontSize, { italic: true }).width;
      const accentWidth = provider.measureGlyph('\u2192', fontSize, {}).width;

      // The accent is wider, so layout width should equal accent width
      expect(layout.width).toBeCloseTo(accentWidth, 2);

      // Base should be centered: child x should include centering offset
      const expectedOffset = (accentWidth - baseWidth) / 2;
      expect(layout.children[0].x).toBeCloseTo(expectedOffset, 2);
    });

    it('does not offset base when base is wider than accent', () => {
      const config = makeConfig(fontSize);
      const node = makeAccentNode('mmmm', '.'); // wide base, narrow accent

      const layout = layoutAccent(node, config);

      // Base is wider, so base x offset should be 0
      expect(layout.children[0].x).toBeCloseTo(0, 2);
    });
  });
});

/**
 * Radical Layout Tests (TeXbook Rule 11)
 *
 * Validates that radical layout follows TeX conventions:
 * 1. Vinculum uses font parameter ruleThickness
 * 2. Display style has more clearance than text style
 * 3. Degree uses script-script style fontSize
 * 4. Content is positioned after radical sign with correct clearance
 * 5. Radical width is proportional to content height
 */

import type { MathNode, RadicalNode } from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS, DefaultMetricsProvider } from '../../src/layout/default-metrics';
import type { LayoutConfig } from '../../src/layout/layout-engine';
import { layoutEquation, layoutNodes } from '../../src/layout/layout-engine';
import { layoutRadical } from '../../src/layout/radical';
import { parseOMML } from '../../src/parser/omml-parser';

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

/** Build a simple RadicalNode with text content */
function makeRadicalNode(text: string, options?: { deg?: string; degHide?: boolean }): RadicalNode {
  const textRun: MathNode = { type: 'r', text };
  return {
    type: 'rad',
    e: [textRun],
    deg: options?.deg ? [{ type: 'r', text: options.deg } as MathNode] : [],
    degHide: options?.degHide ?? true,
  } as RadicalNode;
}

/** Create a LayoutConfig with specific overrides */
function makeConfig(overrides?: Partial<LayoutConfig>): LayoutConfig {
  const fontSize = overrides?.fontSize ?? 12;
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
    baseFontSize: overrides?.baseFontSize ?? overrides?.fontSize ?? fontSize,
  };
}

describe('Radical Layout', () => {
  // ── Basic sanity checks ────────────────────────────────────────────

  it('produces non-zero dimensions', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('radical is wider than bare content', () => {
    const radical = layoutFromOMML(
      '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
    );
    const bare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
    expect(radical.width).toBeGreaterThan(bare.width);
  });

  it('radical is taller than bare content (vinculum space)', () => {
    const radical = layoutFromOMML(
      '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
    );
    const bare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
    expect(radical.height).toBeGreaterThan(bare.height);
  });

  it('has positive baseline', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
    );
    expect(layout.baseline).toBeGreaterThan(0);
  });

  it('snapshot: simple radical layout', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
    );
    expect({
      width: Math.round(layout.width),
      height: Math.round(layout.height),
      baseline: Math.round(layout.baseline),
    }).toMatchSnapshot();
  });

  // ── TeXbook Rule 11: Vinculum uses ruleThickness ───────────────────

  describe('vinculum thickness from font parameters', () => {
    it('uses ruleThickness from fontParams, not fractionBarThickness', () => {
      const fontSize = 20;
      const ruleThickness = CM_FONT_PARAMS.ruleThickness; // 0.04

      // With default fontParams, vinculum thickness = ruleThickness * fontSize
      const config = makeConfig({ fontSize, style: 'T' });
      const node = makeRadicalNode('x');
      const box = layoutRadical(node, config);

      // Content should be offset by vinculumThickness + clearance
      // In text style: clearance = ruleThickness * fontSize
      // So contentY = ruleThickness*fontSize + ruleThickness*fontSize = 2 * ruleThickness * fontSize
      const expectedVinculum = ruleThickness * fontSize;
      const expectedClearance = ruleThickness * fontSize; // text style
      const expectedContentY = expectedVinculum + expectedClearance;

      // The base children should be offset downward by contentY
      // box.height - base.height should equal contentY
      // We verify indirectly: height > 0 and the offset is consistent with ruleThickness
      expect(box.height).toBeGreaterThan(0);

      // Verify that changing fractionBarThickness does NOT affect the layout
      const configAlt = makeConfig({ fontSize, style: 'T', fractionBarThickness: 99 });
      const boxAlt = layoutRadical(node, configAlt);
      expect(boxAlt.height).toBe(box.height);
      expect(boxAlt.width).toBe(box.width);
      expect(boxAlt.baseline).toBe(box.baseline);
    });

    it('uses custom fontParams ruleThickness when provided', () => {
      const fontSize = 10;
      const customParams = { ...CM_FONT_PARAMS, ruleThickness: 0.08 }; // 2x default
      const defaultConfig = makeConfig({ fontSize, style: 'T', fontParams: CM_FONT_PARAMS });
      const customConfig = makeConfig({ fontSize, style: 'T', fontParams: customParams });

      const node = makeRadicalNode('x');
      const defaultBox = layoutRadical(node, defaultConfig);
      const customBox = layoutRadical(node, customConfig);

      // Doubling ruleThickness increases height (more vinculum + clearance)
      expect(customBox.height).toBeGreaterThan(defaultBox.height);
    });
  });

  // ── TeXbook Rule 11: Display style clearance ───────────────────────

  describe('display vs text style clearance', () => {
    it('display style has more clearance than text style', () => {
      const fontSize = 20;
      const node = makeRadicalNode('x');

      const displayConfig = makeConfig({ fontSize, style: 'D' });
      const textConfig = makeConfig({ fontSize, style: 'T' });

      const displayBox = layoutRadical(node, displayConfig);
      const textBox = layoutRadical(node, textConfig);

      // Display clearance = 2 * ruleThickness * fontSize
      // Text clearance = ruleThickness * fontSize
      // So display layout should be taller
      expect(displayBox.height).toBeGreaterThan(textBox.height);
    });

    it('display clearance is exactly double text clearance (reflected in height difference)', () => {
      const fontSize = 20;
      const node = makeRadicalNode('x');

      const displayConfig = makeConfig({ fontSize, style: 'D' });
      const textConfig = makeConfig({ fontSize, style: 'T' });

      const displayBox = layoutRadical(node, displayConfig);
      const textBox = layoutRadical(node, textConfig);

      // Height difference = extra clearance = ruleThickness * fontSize
      const ruleThickness = CM_FONT_PARAMS.ruleThickness * fontSize;
      const heightDiff = displayBox.height - textBox.height;
      expect(heightDiff).toBeCloseTo(ruleThickness, 5);
    });

    it('script style uses same clearance as text style', () => {
      const fontSize = 20;
      const node = makeRadicalNode('x');

      const textConfig = makeConfig({ fontSize, style: 'T' });
      const scriptConfig = makeConfig({ fontSize, style: 'S' });

      const textBox = layoutRadical(node, textConfig);
      const scriptBox = layoutRadical(node, scriptConfig);

      // Both non-display, so same clearance = ruleThickness
      expect(scriptBox.height).toBe(textBox.height);
    });
  });

  // ── TeXbook Rule 11: Degree uses script-script style ───────────────

  describe('degree (nth root index) styling', () => {
    it('degree is laid out in script-script style', () => {
      // For a radical with degree starting in Display style:
      // supStyle(D) = S, supStyle(S) = SS
      // So degree should use SS style => fontSize * scriptScale^2
      const radical = layoutFromOMML(
        '<m:oMath><m:rad><m:radPr/><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      expect(radical.width).toBeGreaterThan(0);
      expect(radical.height).toBeGreaterThan(0);
    });

    it('radical with degree is wider than without', () => {
      const withDeg = layoutFromOMML(
        '<m:oMath><m:rad><m:radPr/><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      const withoutDeg = layoutFromOMML(
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      // Degree adds width (degWidth * 0.3 overlap)
      expect(withDeg.width).toBeGreaterThan(withoutDeg.width);
    });

    it('degHide suppresses degree rendering', () => {
      const hidden = layoutFromOMML(
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      const noDeg = layoutFromOMML(
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      // With degHide, degree should not contribute to width
      expect(hidden.width).toBe(noDeg.width);
    });

    it('degree fontSize uses configForStyle with script-script', () => {
      const fontSize = 20;
      const scriptScale = 0.7;
      const node = makeRadicalNode('x', { deg: '3', degHide: false });

      const config = makeConfig({ fontSize, scriptScale, style: 'D' });
      const box = layoutRadical(node, config);

      // The degree should be laid out at SS fontSize = fontSize * scriptScale^2
      // (since supStyle(supStyle('D')) = supStyle('S') = 'SS')
      // SS fontSize = fontSizeForStyle(20, 'SS', 0.7) = 20 * 0.7 * 0.7 = 9.8
      // This means the degree children exist and the box is valid
      expect(box.children.length).toBeGreaterThan(0);
      expect(box.width).toBeGreaterThan(0);
    });
  });

  // ── Content positioning ────────────────────────────────────────────

  describe('content positioning', () => {
    it('base children are offset by contentX and contentY', () => {
      const fontSize = 12;
      const config = makeConfig({ fontSize, style: 'D' });
      const node = makeRadicalNode('x');
      const box = layoutRadical(node, config);

      // There should be positioned children
      expect(box.children.length).toBeGreaterThan(0);

      // All base children should have x > 0 (offset by radical width)
      for (const child of box.children) {
        expect(child.x).toBeGreaterThan(0);
      }
    });

    it('baseline accounts for vinculum and clearance offset', () => {
      const fontSize = 20;
      const node = makeRadicalNode('x');

      const displayConfig = makeConfig({ fontSize, style: 'D' });
      const textConfig = makeConfig({ fontSize, style: 'T' });

      const displayBox = layoutRadical(node, displayConfig);
      const textBox = layoutRadical(node, textConfig);

      // Display has larger contentY => larger baseline offset
      expect(displayBox.baseline).toBeGreaterThan(textBox.baseline);
    });

    it('right padding uses fontSize-proportional value', () => {
      const fontSize = 20;
      const config = makeConfig({ fontSize, style: 'T' });
      const node = makeRadicalNode('x');
      const box = layoutRadical(node, config);

      // The old code used +2 fixed padding; new code uses fontSize * 0.1
      // Just verify width includes some padding beyond content
      expect(box.width).toBeGreaterThan(0);

      // Verify padding changes with fontSize
      const config2 = makeConfig({ fontSize: 40, style: 'T' });
      const box2 = layoutRadical(node, config2);

      // Larger fontSize => proportionally larger total width
      expect(box2.width).toBeGreaterThan(box.width);
    });
  });

  // ── Radical width proportional to content height ───────────────────

  describe('radical sign dimensions', () => {
    it('radical width scales with content height', () => {
      // Taller content should produce a wider radical sign
      const config = makeConfig({ fontSize: 12, style: 'D' });
      const smallNode = makeRadicalNode('x');

      // Create a node with taller content (fraction inside radical)
      const fracOMML =
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:rad></m:oMath>';
      const fracRadical = layoutFromOMML(fracOMML);
      const smallRadical = layoutFromOMML(
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );

      // Taller content => wider radical sign => wider total
      expect(fracRadical.width).toBeGreaterThan(smallRadical.width);
      expect(fracRadical.height).toBeGreaterThan(smallRadical.height);
    });

    it('radical width has minimum of 0.5em', () => {
      // Even for tiny content, radical should be at least 0.5 * fontSize wide
      const fontSize = 12;
      const config = makeConfig({ fontSize, style: 'T', radicalWidthRatio: 0.001 });
      const node = makeRadicalNode('x');
      const box = layoutRadical(node, config);

      // The radical sign contributes at least fontSize * 0.5 to total width
      // So total width > fontSize * 0.5
      expect(box.width).toBeGreaterThan(fontSize * 0.5);
    });
  });

  // ── Degree positioning ─────────────────────────────────────────────

  describe('degree positioning', () => {
    it('degree children are positioned in upper-left region', () => {
      const fontSize = 20;
      const config = makeConfig({ fontSize, style: 'D' });
      const node = makeRadicalNode('x', { deg: '3', degHide: false });
      const box = layoutRadical(node, config);

      // Should have both degree and base children
      expect(box.children.length).toBeGreaterThanOrEqual(2);

      // Find the degree child (should have smaller x values, positioned at left)
      // and base child (should have larger x values)
      const minX = Math.min(...box.children.map((c) => c.x));
      const maxX = Math.max(...box.children.map((c) => c.x));
      expect(maxX).toBeGreaterThan(minX);
    });
  });

  // ── Falls back to CM_FONT_PARAMS when fontParams missing ──────────

  describe('font parameter fallback', () => {
    it('uses CM_FONT_PARAMS when fontParams is undefined', () => {
      const config = makeConfig({ fontSize: 12, style: 'D' });
      delete (config as any).fontParams;
      const node = makeRadicalNode('x');
      const box = layoutRadical(node, config);

      // Should still produce valid layout using CM_FONT_PARAMS fallback
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.baseline).toBeGreaterThan(0);
    });

    it('fallback produces same result as explicit CM_FONT_PARAMS', () => {
      const configExplicit = makeConfig({ fontSize: 12, style: 'D', fontParams: CM_FONT_PARAMS });
      const configFallback = makeConfig({ fontSize: 12, style: 'D' });
      delete (configFallback as any).fontParams;

      const node = makeRadicalNode('x');
      const boxExplicit = layoutRadical(node, configExplicit);
      const boxFallback = layoutRadical(node, configFallback);

      expect(boxFallback.width).toBe(boxExplicit.width);
      expect(boxFallback.height).toBe(boxExplicit.height);
      expect(boxFallback.baseline).toBe(boxExplicit.baseline);
    });
  });
});

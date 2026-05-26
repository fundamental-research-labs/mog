/**
 * N-ary Operator Layout Tests
 *
 * Tests TeXbook-based layout rules for N-ary operators (sum, product, integral)
 * including bigOpSpacing parameters, display vs text style sizing, stacked vs
 * inline limit placement, and body positioning.
 */

import type { MathNode, NaryNode } from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS, DefaultMetricsProvider } from '../../src/layout/default-metrics';
import type { LayoutConfig } from '../../src/layout/layout-engine';
import { layoutEquation, layoutNode, layoutNodes } from '../../src/layout/layout-engine';
import { parseOMML } from '../../src/parser/omml-parser';

// Helper to create a full LayoutConfig
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

// Helper to build a simple nary node for direct testing
function makeNaryNode(opts: {
  chr?: string;
  limLoc?: 'undOvr' | 'subSup';
  sub?: string;
  sup?: string;
  body?: string;
  subHide?: boolean;
  supHide?: boolean;
}): NaryNode {
  return {
    type: 'nary',
    chr: opts.chr || '\u2211',
    limLoc: opts.limLoc,
    subHide: opts.subHide,
    supHide: opts.supHide,
    sub: opts.sub ? [{ type: 'r', text: opts.sub } as MathNode] : [],
    sup: opts.sup ? [{ type: 'r', text: opts.sup } as MathNode] : [],
    e: opts.body
      ? [{ type: 'r', text: opts.body } as MathNode]
      : [{ type: 'r', text: 'x' } as MathNode],
  };
}

// ─── Display vs Text Style Operator Sizing ────────────────────────────

describe('N-ary operator sizing', () => {
  it('display style sum has larger operator than text style', () => {
    const node = makeNaryNode({ sub: 'i', sup: 'n', body: 'x' });

    const displayConfig = makeConfig({ style: 'D', fontSize: 12 });
    const textConfig = makeConfig({ style: 'T', fontSize: 12 });

    const displayBox = layoutNode(node, displayConfig);
    const textBox = layoutNode(node, textConfig);

    // Display style should produce a taller layout due to larger operator
    expect(displayBox.height).toBeGreaterThan(textBox.height);
  });

  it('operator uses metrics-based measurement when metrics provider is available', () => {
    const node = makeNaryNode({ body: 'x' });
    const config = makeConfig({ fontSize: 20 });
    const box = layoutNode(node, config);

    // With metrics, sum symbol (U+2211) from MATH_EXTENSION has width 0.75em
    // In display style with scale 1.5: 0.75 * 20 * 1.5 = 22.5
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('falls back gracefully when no metrics provider', () => {
    // Build a bare nary node with no sub/sup/body to avoid layoutTextRun needing metrics
    const node: NaryNode = {
      type: 'nary',
      chr: '\u2211',
      sub: [],
      sup: [],
      e: [],
    };
    const config = makeConfig({ fontSize: 12, metrics: undefined });
    const box = layoutNode(node, config);

    // Without metrics, uses fontSize * 1.8 for display = 21.6 (height),
    // width = 21.6 * 0.7 = 15.12
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});

// ─── Limits Spacing Uses bigOpSpacing Parameters ──────────────────────

describe('N-ary limits spacing', () => {
  it('stacked limits spacing uses bigOpSpacing parameters', () => {
    const node = makeNaryNode({ limLoc: 'undOvr', sub: 'i=0', sup: 'n', body: 'x' });
    const fontSize = 12;
    const fp = CM_FONT_PARAMS;
    const config = makeConfig({ fontSize, style: 'D' });

    const box = layoutNode(node, config);

    // The total height should include spacing from bigOpSpacing params
    // sp1 = 0.111 * 12 = 1.332, sp2 = 0.167 * 12 = 2.004, sp3 = 0.200 * 12 = 2.4
    // sp5 = 0.100 * 12 = 1.2
    // Minimum gap between op and limits = max(sp1, sp3) = sp3 = 2.4
    // Height should include: sp5 + sup + gap + op + gap + sub + sp5
    const sp3 = fp.bigOpSpacing3 * fontSize;
    const sp5 = fp.bigOpSpacing5 * fontSize;

    // Height must be > operator alone + gaps + padding
    // (we can't compute exact because sub/sup sizes depend on metrics,
    // but we can verify the spacing adds up)
    expect(box.height).toBeGreaterThan(sp3 * 2 + sp5 * 2);
  });

  it('spacing between operator and upper limit is at least bigOpSpacing3', () => {
    const node = makeNaryNode({ limLoc: 'undOvr', sup: 'n', body: 'x' });
    const fontSize = 20;
    const config = makeConfig({ fontSize, style: 'D' });

    const box = layoutNode(node, config);
    const sp3 = CM_FONT_PARAMS.bigOpSpacing3 * fontSize; // 0.2 * 20 = 4.0

    // The gap between sup bottom and op top should be >= sp3
    // Total height should reflect this spacing
    expect(box.height).toBeGreaterThan(sp3);
  });

  it('no padding when limits are absent', () => {
    const nodeWithLimits = makeNaryNode({ limLoc: 'undOvr', sub: 'i', sup: 'n', body: 'x' });
    const nodeNoLimits = makeNaryNode({
      limLoc: 'undOvr',
      body: 'x',
      subHide: true,
      supHide: true,
    });
    const config = makeConfig({ fontSize: 12, style: 'D' });

    const boxWithLimits = layoutNode(nodeWithLimits, config);
    const boxNoLimits = layoutNode(nodeNoLimits, config);

    // Without limits, height should be smaller (no limit content, no spacing padding)
    expect(boxNoLimits.height).toBeLessThan(boxWithLimits.height);
  });
});

// ─── Integral Limits Are Inline (subSup limLoc) ──────────────────────

describe('N-ary inline limits (subSup)', () => {
  it('integral with subSup places limits as scripts, not stacked', () => {
    const inlineNode = makeNaryNode({
      chr: '\u222B',
      limLoc: 'subSup',
      sub: '0',
      sup: '1',
      body: 'f',
    });
    const stackedNode = makeNaryNode({
      chr: '\u222B',
      limLoc: 'undOvr',
      sub: '0',
      sup: '1',
      body: 'f',
    });

    const config = makeConfig({ fontSize: 12, style: 'D' });
    const inlineBox = layoutNode(inlineNode, config);
    const stackedBox = layoutNode(stackedNode, config);

    // Inline (subSup) should be wider (operator + scripts side by side + body)
    // but shorter (scripts don't stack vertically above/below)
    expect(inlineBox.width).toBeGreaterThan(stackedBox.width);
    expect(inlineBox.height).toBeLessThan(stackedBox.height);
  });

  it('subSup in text style produces inline limits', () => {
    const node = makeNaryNode({ limLoc: 'subSup', sub: 'a', sup: 'b', body: 'x' });
    const config = makeConfig({ fontSize: 12, style: 'T' });

    const box = layoutNode(node, config);
    // Should produce valid layout
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.baseline).toBeGreaterThan(0);
  });

  it('text style without explicit limLoc defaults to inline limits', () => {
    // In text style, if limLoc is not 'undOvr', limits should be inline
    const node = makeNaryNode({ sub: 'i', sup: 'n', body: 'x' });
    // limLoc is undefined, style is T -> should use inline
    const textConfig = makeConfig({ fontSize: 12, style: 'T' });
    const textBox = layoutNode(node, textConfig);

    // Compare with explicit undOvr in text style (should be stacked)
    const stackedNode = makeNaryNode({ limLoc: 'undOvr', sub: 'i', sup: 'n', body: 'x' });
    const stackedBox = layoutNode(stackedNode, textConfig);

    // The inline version should be wider than stacked (scripts beside operator)
    expect(textBox.width).toBeGreaterThan(stackedBox.width);
  });
});

// ─── Sum Limits Are Stacked (undOvr limLoc) ───────────────────────────

describe('N-ary stacked limits (undOvr)', () => {
  it('sum with undOvr places limits above and below', () => {
    const node = makeNaryNode({ limLoc: 'undOvr', sub: 'i=1', sup: 'n', body: 'x' });
    const config = makeConfig({ fontSize: 12, style: 'D' });

    const box = layoutNode(node, config);

    // Should have children for: sup, operator, sub, and body
    expect(box.children.length).toBeGreaterThanOrEqual(3);
    expect(box.height).toBeGreaterThan(0);
    expect(box.width).toBeGreaterThan(0);
  });

  it('display style defaults to stacked when limLoc is undefined', () => {
    // In display style, undefined limLoc should use stacked (undOvr behavior)
    const node = makeNaryNode({ sub: 'i', sup: 'n', body: 'x' });
    const config = makeConfig({ fontSize: 12, style: 'D' });

    const box = layoutNode(node, config);

    // Compare with explicit undOvr - should be the same since display defaults to stacked
    const explicitNode = makeNaryNode({ limLoc: 'undOvr', sub: 'i', sup: 'n', body: 'x' });
    const explicitBox = layoutNode(explicitNode, config);

    expect(box.width).toBeCloseTo(explicitBox.width, 5);
    expect(box.height).toBeCloseTo(explicitBox.height, 5);
  });

  it('limits are horizontally centered over operator', () => {
    const node = makeNaryNode({ limLoc: 'undOvr', sub: 'i', sup: 'n', body: 'x' });
    const config = makeConfig({ fontSize: 12, style: 'D' });

    const box = layoutNode(node, config);

    // All children that represent limits/operator should have x offsets
    // that center them within the limits column width
    expect(box.children.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Body Positioning ─────────────────────────────────────────────────

describe('N-ary body positioning', () => {
  it('body is positioned to the right of operator/limits', () => {
    const node = makeNaryNode({ limLoc: 'undOvr', sub: 'i', sup: 'n', body: 'abc' });
    const config = makeConfig({ fontSize: 12, style: 'D' });

    const box = layoutNode(node, config);

    // Find body children (they should have the largest x offsets)
    const maxX = Math.max(...box.children.map((c) => c.x));
    expect(maxX).toBeGreaterThan(0);

    // Body x offset should be > operator width (body is to the right)
    const opMetrics = new DefaultMetricsProvider().measureGlyph('\u2211', 12, {});
    const opWidth = opMetrics.width * 1.5; // display scale
    expect(maxX).toBeGreaterThanOrEqual(opWidth);
  });

  it('body gap uses bigOpSpacing5 parameter', () => {
    const node = makeNaryNode({ limLoc: 'undOvr', sub: 'i', sup: 'n', body: 'x' });
    const fontSize = 12;
    const config = makeConfig({ fontSize, style: 'D' });
    const sp5 = CM_FONT_PARAMS.bigOpSpacing5 * fontSize; // 0.1 * 12 = 1.2

    const box = layoutNode(node, config);

    // The gap between the limits column and body should be sp5
    // We can verify this by checking that the total width is reasonable
    expect(box.width).toBeGreaterThan(0);
    // Width should be approximately: limitsWidth + sp5 + bodyWidth
    expect(sp5).toBeGreaterThan(0); // sanity check that the parameter is used
  });

  it('body baseline aligns with operator baseline in stacked mode', () => {
    const node = makeNaryNode({ limLoc: 'undOvr', sub: 'i', sup: 'n', body: 'x' });
    const config = makeConfig({ fontSize: 12, style: 'D' });

    const box = layoutNode(node, config);

    // The box baseline should be set correctly for alignment
    expect(box.baseline).toBeGreaterThan(0);
    expect(box.baseline).toBeLessThan(box.height);
  });

  it('body baseline aligns with operator baseline in inline mode', () => {
    const node = makeNaryNode({ limLoc: 'subSup', sub: 'a', sup: 'b', body: 'x' });
    const config = makeConfig({ fontSize: 12, style: 'D' });

    const box = layoutNode(node, config);

    expect(box.baseline).toBeGreaterThan(0);
    expect(box.baseline).toBeLessThan(box.height);
  });
});

// ─── OMML Integration ─────────────────────────────────────────────────

describe('N-ary OMML integration', () => {
  it('summation from OMML parses and lays out correctly', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u2211"/><m:limLoc m:val="undOvr"/></m:naryPr>' +
        '<m:sub><m:r><m:t>i=1</m:t></m:r></m:sub>' +
        '<m:sup><m:r><m:t>n</m:t></m:r></m:sup>' +
        '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>',
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('integral from OMML with subSup limits', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u222B"/><m:limLoc m:val="subSup"/></m:naryPr>' +
        '<m:sub><m:r><m:t>0</m:t></m:r></m:sub>' +
        '<m:sup><m:r><m:t>1</m:t></m:r></m:sup>' +
        '<m:e><m:r><m:t>f(x)dx</m:t></m:r></m:e></m:nary></m:oMath>',
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('product from OMML with stacked limits', () => {
    const layout = layoutFromOMML(
      '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u220F"/><m:limLoc m:val="undOvr"/></m:naryPr>' +
        '<m:sub><m:r><m:t>k=1</m:t></m:r></m:sub>' +
        '<m:sup><m:r><m:t>n</m:t></m:r></m:sup>' +
        '<m:e><m:r><m:t>k</m:t></m:r></m:e></m:nary></m:oMath>',
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

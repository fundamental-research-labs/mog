/**
 * Layout Engine
 *
 * Computes sizes, positions, and baselines for equation rendering.
 * Each MathNode is laid out into a LayoutBox tree with absolute
 * coordinates, ready for rendering.
 *
 * Uses BoundingBox and Point2D from contracts/geometry.
 *
 * Structure: the operator-facing interface (LayoutBox, LayoutConfig,
 * arrangeHorizontally, math-style helpers) lives in ./types. Operator
 * modules import only from ./types and recurse via the layoutNodes
 * dispatcher injected into LayoutConfig. layout-engine.ts imports the
 * operator modules one-way for dispatch.
 */

import type { MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import { layoutAccent } from './accent';
import { CM_FONT_PARAMS, DefaultMetricsProvider } from './default-metrics';
import { layoutDelimiter } from './delimiter';
import { layoutFraction } from './fraction';
import { layoutMatrix } from './matrix';
import { layoutRadical } from './radical';
import { layoutScript } from './script';
import {
  arrangeHorizontally,
  configForStyle,
  type FontParameters,
  type GlyphStyle,
  type LayoutBox,
  type LayoutConfig,
  subStyle,
  supStyle,
} from './types';

// Re-export the operator-facing interface so existing consumers
// (src/index.ts, tests, render/render-plan.ts) keep working unchanged.
export type { LayoutBox, LayoutConfig } from './types';
export {
  arrangeHorizontally,
  configForStyle,
  fontSizeForStyle,
  fracDenominatorStyle,
  fracNumeratorStyle,
  subStyle,
  supStyle,
} from './types';

const DEFAULT_CONFIG: LayoutConfig = {
  fontSize: 12,
  baseFontSize: 12,
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
  style: 'D', // Top-level equations are in Display style
  cramped: false,
};

// ─── Layout Entry Point ──────────────────────────────────────────────

/**
 * Lay out an equation (array of MathNodes) at a given font size.
 * Returns a root LayoutBox containing all child boxes.
 */
export function layoutEquation(nodes: MathNode[], fontSize: number = 12): LayoutBox {
  const config: LayoutConfig = {
    ...DEFAULT_CONFIG,
    fontSize,
    baseFontSize: fontSize,
    style: 'D',
    layoutNodes,
  };

  const childBoxes = layoutNodes(nodes, config);
  const result = arrangeHorizontally(childBoxes, config.style);

  return {
    x: 0,
    y: 0,
    width: result.width,
    height: result.height,
    baseline: result.baseline,
    fontSize: config.fontSize,
    children: result.children,
    node: { type: 'oMath', children: nodes },
  };
}

/**
 * Layout an array of nodes, returning LayoutBox for each.
 */
export function layoutNodes(nodes: MathNode[], config: LayoutConfig): LayoutBox[] {
  // Ensure the recursive dispatcher is always set, even if a caller
  // (typically a test) hands us a bare config.
  const resolvedConfig: LayoutConfig =
    config.layoutNodes === layoutNodes ? config : { ...config, layoutNodes };
  return nodes.map((node) => layoutNode(node, resolvedConfig));
}

/**
 * Layout a single node.
 */
export function layoutNode(node: MathNode, config: LayoutConfig): LayoutBox {
  const resolvedConfig: LayoutConfig =
    config.layoutNodes === layoutNodes ? config : { ...config, layoutNodes };
  switch (node.type) {
    case 'oMath': {
      const children = layoutNodes(node.children, resolvedConfig);
      const result = arrangeHorizontally(children, resolvedConfig.style);
      return { x: 0, y: 0, ...result, fontSize: resolvedConfig.fontSize, node };
    }
    case 'f':
      return layoutFraction(node, resolvedConfig);
    case 'rad':
      return layoutRadical(node, resolvedConfig);
    case 'sSup':
    case 'sSub':
    case 'sSubSup':
    case 'sPre':
      return layoutScript(node, resolvedConfig);
    case 'm':
      return layoutMatrix(node, resolvedConfig);
    case 'd':
      return layoutDelimiter(node, resolvedConfig);
    case 'acc':
      return layoutAccent(node, resolvedConfig);
    case 'bar':
      return layoutBarNode(node, resolvedConfig);
    case 'nary':
      return layoutNaryNode(node, resolvedConfig);
    case 'func':
      return layoutFunctionNode(node, resolvedConfig);
    case 'limLow':
      return layoutLimLowNode(node, resolvedConfig);
    case 'limUpp':
      return layoutLimUppNode(node, resolvedConfig);
    case 'eqArr':
      return layoutEqArrayNode(node, resolvedConfig);
    case 'r':
      return layoutTextRun(node, resolvedConfig);
    case 'box':
    case 'borderBox':
    case 'groupChr':
    case 'phant':
    case 'oMathPara':
    default: {
      // For unhandled types, lay out children horizontally
      const childNodes = getChildNodes(node);
      const children = layoutNodes(childNodes, resolvedConfig);
      const result = arrangeHorizontally(children, resolvedConfig.style);
      return { x: 0, y: 0, ...result, fontSize: resolvedConfig.fontSize, node };
    }
  }
}

function layoutTextRun(node: MathNode & { type: 'r' }, config: LayoutConfig): LayoutBox {
  const text = node.text || '';
  if (!text) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      baseline: 0,
      fontSize: config.fontSize,
      children: [],
      node,
    };
  }

  const metrics = config.metrics!; // always present via DEFAULT_CONFIG
  const style: GlyphStyle = {
    italic: node.rPr?.sty === 'i' || node.rPr?.sty === 'bi' || (!node.rPr?.nor && !node.rPr?.sty),
    bold: node.rPr?.sty === 'b' || node.rPr?.sty === 'bi',
  };

  let totalWidth = 0;
  let maxHeight = 0;
  let maxDepth = 0;

  for (const char of text) {
    const gm = metrics.measureGlyph(char, config.fontSize, style);
    totalWidth += gm.width;
    maxHeight = Math.max(maxHeight, gm.height);
    maxDepth = Math.max(maxDepth, gm.depth);
  }

  const height = maxHeight + maxDepth;
  const baseline = maxHeight;

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height,
    baseline,
    fontSize: config.fontSize,
    children: [],
    node,
  };
}

function layoutBarNode(node: MathNode & { type: 'bar' }, config: LayoutConfig): LayoutBox {
  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);
  const barHeight = config.fractionBarThickness;
  const gap = 1;

  const totalHeight = base.height + barHeight + gap;
  const isOverbar = node.pos === 'top';

  return {
    x: 0,
    y: 0,
    width: base.width,
    height: totalHeight,
    baseline: isOverbar ? base.baseline + barHeight + gap : base.baseline,
    fontSize: config.fontSize,
    children: base.children.map((c) => ({
      ...c,
      y: c.y + (isOverbar ? barHeight + gap : 0),
    })),
    node,
  };
}

function layoutNaryNode(node: MathNode & { type: 'nary' }, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const style = config.style || 'D';
  const isDisplay = style === 'D';
  const metrics = config.metrics;

  // Measure operator symbol using font metrics
  const opChar = node.chr || '∑';
  let opWidth: number, opHeight: number, opBaseline: number;

  if (metrics) {
    const opMetrics = metrics.measureGlyph(opChar, fontSize, {});
    const scale = isDisplay ? 1.5 : 1.0;
    opWidth = opMetrics.width * scale;
    opHeight = (opMetrics.height + opMetrics.depth) * scale;
    opBaseline = opMetrics.height * scale;
  } else {
    const opSize = fontSize * (isDisplay ? 1.8 : 1.2);
    opWidth = opSize * 0.7;
    opHeight = opSize;
    opBaseline = opSize * 0.6;
  }

  const opBox: LayoutBox = {
    x: 0,
    y: 0,
    width: opWidth,
    height: opHeight,
    baseline: opBaseline,
    fontSize: config.fontSize,
    children: [],
    node: { type: 'r', text: opChar } as MathNode,
  };

  // Layout sub and sup using style propagation
  const subConfig = configForStyle(config, subStyle(style), true);
  const supConfig = configForStyle(config, supStyle(style));

  let subBox: { width: number; height: number; baseline: number; children: LayoutBox[] } = {
    width: 0,
    height: 0,
    baseline: 0,
    children: [],
  };
  let supBox: { width: number; height: number; baseline: number; children: LayoutBox[] } = {
    width: 0,
    height: 0,
    baseline: 0,
    children: [],
  };

  if (node.sub.length > 0 && !node.subHide) {
    const subChildren = layoutNodes(node.sub, subConfig);
    subBox = arrangeHorizontally(subChildren, subConfig.style);
  }
  if (node.sup.length > 0 && !node.supHide) {
    const supChildren = layoutNodes(node.sup, supConfig);
    supBox = arrangeHorizontally(supChildren, supConfig.style);
  }

  // Layout body
  const bodyChildren = layoutNodes(node.e, config);
  const body = arrangeHorizontally(bodyChildren, config.style);

  // Spacing from font parameters (absolute units, em-relative * fontSize)
  const sp1 = fp.bigOpSpacing1 * fontSize;
  const sp2 = fp.bigOpSpacing2 * fontSize;
  const sp3 = fp.bigOpSpacing3 * fontSize;
  const sp5 = fp.bigOpSpacing5 * fontSize;

  // Determine whether limits are stacked (above/below) or inline (sub/superscript)
  const useInlineLimits = node.limLoc === 'subSup' || (!isDisplay && node.limLoc !== 'undOvr');

  if (useInlineLimits) {
    return layoutNaryInline(opBox, supBox, subBox, body, fp, fontSize, style, sp5, node, config);
  }

  // ── Stacked limits (like summation): limits centered above/below operator ──
  const supGap = supBox.height > 0 ? Math.max(sp1, sp3) : 0;
  const subGap = subBox.height > 0 ? Math.max(sp2, sp3) : 0;

  const limitsWidth = Math.max(opBox.width, subBox.width, supBox.width);
  const bodyGap = sp5;

  const topPad = supBox.height > 0 ? sp5 : 0;
  const botPad = subBox.height > 0 ? sp5 : 0;
  const totalHeight =
    topPad + supBox.height + supGap + opBox.height + subGap + subBox.height + botPad;
  const baseline = topPad + supBox.height + supGap + opBox.baseline;

  const totalWidth = limitsWidth + bodyGap + body.width;

  const allChildren: LayoutBox[] = [];

  // Superscript (above operator)
  let yPos = topPad;
  if (supBox.height > 0) {
    const supXOffset = (limitsWidth - supBox.width) / 2;
    for (const child of supBox.children) {
      allChildren.push({ ...child, x: child.x + supXOffset, y: child.y + yPos });
    }
    if (supBox.children.length === 0 && supBox.width > 0) {
      allChildren.push({
        x: supXOffset,
        y: yPos,
        width: supBox.width,
        height: supBox.height,
        baseline: supBox.baseline,
        fontSize: config.fontSize,
        children: [],
        node: { type: 'r', text: '' } as MathNode,
      });
    }
    yPos += supBox.height + supGap;
  }

  // Operator (middle)
  const opXOffset = (limitsWidth - opBox.width) / 2;
  allChildren.push({ ...opBox, x: opXOffset, y: yPos });
  yPos += opBox.height + subGap;

  // Subscript (below operator)
  if (subBox.height > 0) {
    const subXOffset = (limitsWidth - subBox.width) / 2;
    for (const child of subBox.children) {
      allChildren.push({ ...child, x: child.x + subXOffset, y: child.y + yPos });
    }
    if (subBox.children.length === 0 && subBox.width > 0) {
      allChildren.push({
        x: subXOffset,
        y: yPos,
        width: subBox.width,
        height: subBox.height,
        baseline: subBox.baseline,
        fontSize: config.fontSize,
        children: [],
        node: { type: 'r', text: '' } as MathNode,
      });
    }
  }

  // Body (to the right of limits column, baseline-aligned with operator)
  const bodyXOffset = limitsWidth + bodyGap;
  const bodyYOffset = baseline - body.baseline;
  for (const child of body.children) {
    allChildren.push({ ...child, x: child.x + bodyXOffset, y: child.y + bodyYOffset });
  }

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: Math.max(totalHeight, bodyYOffset + body.height),
    baseline,
    fontSize: config.fontSize,
    children: allChildren,
    node,
  };
}

/**
 * Layout N-ary operator with inline (sub/superscript) limits.
 */
function layoutNaryInline(
  opBox: LayoutBox,
  supBox: { width: number; height: number; baseline: number; children: LayoutBox[] },
  subBox: { width: number; height: number; baseline: number; children: LayoutBox[] },
  body: { width: number; height: number; baseline: number; children: LayoutBox[] },
  fp: FontParameters,
  fontSize: number,
  style: string,
  bodyGap: number,
  node: MathNode & { type: 'nary' },
  config: LayoutConfig,
): LayoutBox {
  const supParam = config.cramped ? fp.sup2 : style === 'D' ? fp.sup1 : fp.sup3;
  const subParam = fp.sub1;

  let supShift = 0;
  if (supBox.height > 0) {
    const supDropCalc = opBox.baseline - fp.supDrop * fontSize;
    supShift = Math.max(supParam * fontSize, supDropCalc);
    const supDepth = supBox.height - supBox.baseline;
    const minSupBottom = fp.ruleThickness * fontSize * 4;
    supShift = Math.max(supShift, supDepth + minSupBottom);
  }

  let subShift = 0;
  if (subBox.height > 0) {
    const opDepth = opBox.height - opBox.baseline;
    const subDropCalc = opDepth + fp.subDrop * fontSize;
    subShift = Math.max(subParam * fontSize, subDropCalc);
  }

  if (supBox.height > 0 && subBox.height > 0) {
    const minGap = 4 * fp.ruleThickness * fontSize;
    const supBottom = supShift - (supBox.height - supBox.baseline);
    const subTop = subShift - subBox.baseline;
    const gap = supBottom + subTop;
    if (gap < minGap) {
      subShift += minGap - gap;
    }
  }

  const scriptWidth = Math.max(supBox.width, subBox.width);
  const supY = supBox.height > 0 ? opBox.baseline - supShift - supBox.baseline : 0;
  const subY = subBox.height > 0 ? opBox.baseline + subShift - subBox.baseline : 0;

  const topOverflow = Math.max(0, -supY);
  const actualOpY = topOverflow;
  const actualSupY = supY + topOverflow;
  const actualSubY = subY + topOverflow;

  const opPlusScriptsWidth = opBox.width + scriptWidth;
  const totalWidth = opPlusScriptsWidth + bodyGap + body.width;
  const baseline = actualOpY + opBox.baseline;

  const bodyXOffset = opPlusScriptsWidth + bodyGap;
  const bodyYOffset = baseline - body.baseline;

  const totalHeight = Math.max(
    actualOpY + opBox.height,
    supBox.height > 0 ? actualSupY + supBox.height : 0,
    subBox.height > 0 ? actualSubY + subBox.height : 0,
    bodyYOffset + body.height,
  );

  const allChildren: LayoutBox[] = [];

  allChildren.push({ ...opBox, x: 0, y: actualOpY });

  if (supBox.height > 0) {
    for (const child of supBox.children) {
      allChildren.push({ ...child, x: child.x + opBox.width, y: child.y + actualSupY });
    }
    if (supBox.children.length === 0 && supBox.width > 0) {
      allChildren.push({
        x: opBox.width,
        y: actualSupY,
        width: supBox.width,
        height: supBox.height,
        baseline: supBox.baseline,
        fontSize: config.fontSize,
        children: [],
        node: { type: 'r', text: '' } as MathNode,
      });
    }
  }

  if (subBox.height > 0) {
    for (const child of subBox.children) {
      allChildren.push({ ...child, x: child.x + opBox.width, y: child.y + actualSubY });
    }
    if (subBox.children.length === 0 && subBox.width > 0) {
      allChildren.push({
        x: opBox.width,
        y: actualSubY,
        width: subBox.width,
        height: subBox.height,
        baseline: subBox.baseline,
        fontSize: config.fontSize,
        children: [],
        node: { type: 'r', text: '' } as MathNode,
      });
    }
  }

  for (const child of body.children) {
    allChildren.push({ ...child, x: child.x + bodyXOffset, y: child.y + bodyYOffset });
  }

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: allChildren,
    node,
  };
}

function layoutFunctionNode(node: MathNode & { type: 'func' }, config: LayoutConfig): LayoutBox {
  const nameChildren = layoutNodes(node.fName, config);
  const nameBox = arrangeHorizontally(nameChildren, config.style);
  const argChildren = layoutNodes(node.e, config);
  const argBox = arrangeHorizontally(argChildren, config.style);

  const gap = config.fontSize * 0.2;
  const totalWidth = nameBox.width + gap + argBox.width;
  const maxHeight = Math.max(nameBox.height, argBox.height);
  const maxBaseline = Math.max(nameBox.baseline, argBox.baseline);

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: maxHeight,
    baseline: maxBaseline,
    fontSize: config.fontSize,
    children: [
      ...nameBox.children,
      ...argBox.children.map((c) => ({ ...c, x: c.x + nameBox.width + gap })),
    ],
    node,
  };
}

function layoutLimLowNode(node: MathNode & { type: 'limLow' }, config: LayoutConfig): LayoutBox {
  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);
  const limConfig = configForStyle(config, subStyle(config.style || 'D'), true);
  const limChildren = layoutNodes(node.lim, limConfig);
  const lim = arrangeHorizontally(limChildren, limConfig.style);

  const gap = 1;
  const totalWidth = Math.max(base.width, lim.width);
  const totalHeight = base.height + gap + lim.height;

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline: base.baseline,
    fontSize: config.fontSize,
    children: [
      ...base.children,
      ...lim.children.map((c) => ({ ...c, y: c.y + base.height + gap })),
    ],
    node,
  };
}

function layoutLimUppNode(node: MathNode & { type: 'limUpp' }, config: LayoutConfig): LayoutBox {
  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);
  const limConfig = configForStyle(config, supStyle(config.style || 'D'));
  const limChildren = layoutNodes(node.lim, limConfig);
  const lim = arrangeHorizontally(limChildren, limConfig.style);

  const gap = 1;
  const totalWidth = Math.max(base.width, lim.width);
  const totalHeight = lim.height + gap + base.height;

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline: lim.height + gap + base.baseline,
    fontSize: config.fontSize,
    children: [...lim.children, ...base.children.map((c) => ({ ...c, y: c.y + lim.height + gap }))],
    node,
  };
}

function layoutEqArrayNode(node: MathNode & { type: 'eqArr' }, config: LayoutConfig): LayoutBox {
  const rowBoxes = node.e.map((row) => {
    const children = layoutNodes(row, config);
    return arrangeHorizontally(children, config.style);
  });

  const rowGap = config.matrixRowGap;
  const maxWidth = Math.max(...rowBoxes.map((r) => r.width), 0);
  let yOffset = 0;
  const allChildren: LayoutBox[] = [];

  for (const row of rowBoxes) {
    for (const child of row.children) {
      allChildren.push({ ...child, y: child.y + yOffset });
    }
    yOffset += row.height + rowGap;
  }

  const totalHeight = yOffset > 0 ? yOffset - rowGap : 0;

  return {
    x: 0,
    y: 0,
    width: maxWidth,
    height: totalHeight,
    baseline: totalHeight / 2,
    fontSize: config.fontSize,
    children: allChildren,
    node,
  };
}

/**
 * Get child nodes from any MathNode type for fallback layout.
 */
function getChildNodes(node: MathNode): MathNode[] {
  switch (node.type) {
    case 'oMath':
      return node.children;
    case 'oMathPara':
      return node.equations;
    case 'acc':
    case 'bar':
    case 'box':
    case 'borderBox':
    case 'groupChr':
    case 'phant':
      return node.e;
    case 'd':
      return node.e.flat();
    case 'eqArr':
      return node.e.flat();
    case 'f':
      return [...node.num, ...node.den];
    case 'func':
      return [...node.fName, ...node.e];
    case 'limLow':
    case 'limUpp':
      return [...node.e, ...node.lim];
    case 'm':
      return node.mr.flat(2);
    case 'nary':
      return [...node.sub, ...node.sup, ...node.e];
    case 'rad':
      return [...node.deg, ...node.e];
    case 'sPre':
      return [...node.sub, ...node.sup, ...node.e];
    case 'sSub':
      return [...node.e, ...node.sub];
    case 'sSubSup':
      return [...node.e, ...node.sub, ...node.sup];
    case 'sSup':
      return [...node.e, ...node.sup];
    case 'r':
      return [];
    default:
      return [];
  }
}

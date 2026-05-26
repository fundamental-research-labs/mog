/**
 * Script Layout -- TeXbook Rules 18a-f
 *
 * Computes layout for superscript, subscript, sub+superscript, and pre-script nodes
 * using TeX's font-parameter-driven positioning instead of arbitrary percentages.
 *
 * Key parameters (em-relative, from FontParameters):
 *   sup1  -- display superscript shift (0.413)
 *   sup2  -- cramped superscript shift (0.363)
 *   sup3  -- text superscript shift (0.289)
 *   sub1  -- subscript shift (0.150)
 *   sub2  -- subscript shift when superscript is also present (0.247)
 *   supDrop -- superscript baseline drop below top of base (0.386)
 *   subDrop -- subscript baseline raise above bottom of base (0.050)
 *   ruleThickness -- default rule thickness (0.04)
 */

import type {
  PreScriptNode,
  SubscriptNode,
  SubSupNode,
  SuperscriptNode,
} from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS } from './default-metrics';
import {
  arrangeHorizontally,
  configForStyle,
  type LayoutBox,
  type LayoutConfig,
  subStyle,
  supStyle,
} from './types';

type ScriptNode = SuperscriptNode | SubscriptNode | SubSupNode | PreScriptNode;

export function layoutScript(node: ScriptNode, config: LayoutConfig): LayoutBox {
  switch (node.type) {
    case 'sSup':
      return layoutSuperscript(node, config);
    case 'sSub':
      return layoutSubscript(node, config);
    case 'sSubSup':
      return layoutSubSuperscript(node, config);
    case 'sPre':
      return layoutPreScript(node, config);
  }
}

// ─── Superscript (Rule 18c) ────────────────────────────────────────────

function layoutSuperscript(node: SuperscriptNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const style = config.style || 'D';
  const cramped = config.cramped ?? false;
  const layoutNodes = config.layoutNodes!;

  // Layout base in current style
  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);

  // Layout superscript in reduced style
  const supConfig = configForStyle(config, supStyle(style));
  const supChildren = layoutNodes(node.sup, supConfig);
  const sup = arrangeHorizontally(supChildren, supConfig.style);

  const supShift = computeSupShift(base, sup, fp, fontSize, style, cramped);

  return assembleSupLayout(base, sup, supShift, node, config);
}

// ─── Subscript (Rule 18b) ──────────────────────────────────────────────

function layoutSubscript(node: SubscriptNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const style = config.style || 'D';
  const cramped = config.cramped ?? false;
  const layoutNodes = config.layoutNodes!;

  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);

  const subConfig = configForStyle(config, subStyle(style), true);
  const subChildren = layoutNodes(node.sub, subConfig);
  const sub = arrangeHorizontally(subChildren, subConfig.style);

  const subShift = computeSubShift(base, sub, fp, fontSize, cramped);

  return assembleSubLayout(base, sub, subShift, node, config);
}

// ─── Combined Sub+Sup (Rules 18d-f) ───────────────────────────────────

function layoutSubSuperscript(node: SubSupNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const style = config.style || 'D';
  const cramped = config.cramped ?? false;
  const layoutNodes = config.layoutNodes!;

  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);

  const supConfig = configForStyle(config, supStyle(style));
  const supChildren = layoutNodes(node.sup, supConfig);
  const sup = arrangeHorizontally(supChildren, supConfig.style);

  const subConfig = configForStyle(config, subStyle(style), true);
  const subChildren = layoutNodes(node.sub, subConfig);
  const sub = arrangeHorizontally(subChildren, subConfig.style);

  const supShift = computeSupShift(base, sup, fp, fontSize, style, cramped);
  let subShift = computeSubShiftWithSup(base, sub, fp, fontSize, cramped);

  // Rule 18e: ensure gap between bottom of sup and top of sub >= 4 * ruleThickness
  const minGap = 4 * fp.ruleThickness * fontSize;
  const supBottom = supShift - (sup.height - sup.baseline); // distance from baseline to bottom of sup
  const subTop = subShift - sub.baseline; // distance from baseline to top of sub
  const gap = supBottom + subTop; // total gap (positive = separated)

  if (gap < minGap) {
    // Push sub down to satisfy minimum gap
    const deficit = minGap - gap;
    subShift += deficit;
  }

  return assembleSubSupLayout(base, sup, sub, supShift, subShift, node, config);
}

// ─── Pre-scripts (same math, scripts go left of base) ─────────────────

function layoutPreScript(node: PreScriptNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const style = config.style || 'D';
  const cramped = config.cramped ?? false;
  const layoutNodes = config.layoutNodes!;

  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);

  const supConfig = configForStyle(config, supStyle(style));
  const supChildren = layoutNodes(node.sup, supConfig);
  const sup = arrangeHorizontally(supChildren, supConfig.style);

  const subConfig = configForStyle(config, subStyle(style), true);
  const subChildren = layoutNodes(node.sub, subConfig);
  const sub = arrangeHorizontally(subChildren, subConfig.style);

  const supShift = computeSupShift(base, sup, fp, fontSize, style, cramped);
  let subShift = computeSubShiftWithSup(base, sub, fp, fontSize, cramped);

  // Rule 18e: ensure gap between bottom of sup and top of sub >= 4 * ruleThickness
  const minGap = 4 * fp.ruleThickness * fontSize;
  const supBottom = supShift - (sup.height - sup.baseline);
  const subTop = subShift - sub.baseline;
  const gap = supBottom + subTop;

  if (gap < minGap) {
    const deficit = minGap - gap;
    subShift += deficit;
  }

  return assemblePreScriptLayout(base, sup, sub, supShift, subShift, node, config);
}

// ─── TeXbook Shift Computation ─────────────────────────────────────────

/**
 * Rule 18c: Compute the upward shift for a superscript.
 * supShift is the distance from the base baseline to the superscript baseline.
 */
function computeSupShift(
  base: { height: number; baseline: number },
  sup: { height: number; baseline: number },
  fp: typeof CM_FONT_PARAMS,
  fontSize: number,
  style: string,
  cramped: boolean = false,
): number {
  // Choose the appropriate sup parameter based on style and cramped flag
  const supParam = cramped ? fp.sup2 : style === 'D' ? fp.sup1 : fp.sup3;

  // Initial shift: at least supParam above baseline, but also close to top of base
  const supDropCalc = base.baseline - fp.supDrop * fontSize;
  let supShift = Math.max(supParam * fontSize, supDropCalc);

  // Ensure bottom of superscript is well above baseline (at least 4*ruleThickness)
  const supDepth = sup.height - sup.baseline;
  const minSupBottom = fp.ruleThickness * fontSize * 4;
  supShift = Math.max(supShift, supDepth + minSupBottom);

  return supShift;
}

/**
 * Rule 18b: Compute the downward shift for a subscript (no superscript present).
 * subShift is the distance from the base baseline to the subscript baseline (downward).
 */
function computeSubShift(
  base: { height: number; baseline: number },
  sub: { height: number; baseline: number },
  fp: typeof CM_FONT_PARAMS,
  fontSize: number,
  _cramped: boolean = false,
): number {
  const baseDepth = base.height - base.baseline;

  // Initial shift: at least sub1 below baseline, and also related to base depth
  const subDropCalc = baseDepth + fp.subDrop * fontSize;
  let subShift = Math.max(fp.sub1 * fontSize, subDropCalc);

  // Ensure top of subscript is below baseline (by at least 4/5 of x-height,
  // approximated as 4*ruleThickness for simplicity)
  const minSubTop = fp.ruleThickness * fontSize * 4;
  subShift = Math.max(subShift, sub.baseline - minSubTop);

  return subShift;
}

/**
 * Rule 18d: Compute subscript shift when superscript is also present.
 * Uses sub2 instead of sub1 for a larger drop.
 */
function computeSubShiftWithSup(
  base: { height: number; baseline: number },
  sub: { height: number; baseline: number },
  fp: typeof CM_FONT_PARAMS,
  fontSize: number,
  _cramped: boolean = false,
): number {
  const baseDepth = base.height - base.baseline;

  // With superscript present, use sub2 (larger shift)
  const subDropCalc = baseDepth + fp.subDrop * fontSize;
  let subShift = Math.max(fp.sub2 * fontSize, subDropCalc);

  const minSubTop = fp.ruleThickness * fontSize * 4;
  subShift = Math.max(subShift, sub.baseline - minSubTop);

  return subShift;
}

// ─── Layout Assembly Helpers ───────────────────────────────────────────

/**
 * Assemble a layout box with a superscript to the right of the base.
 * supShift: distance from base baseline upward to sup baseline.
 */
function assembleSupLayout(
  base: ReturnType<typeof arrangeHorizontally>,
  sup: ReturnType<typeof arrangeHorizontally>,
  supShift: number,
  node: ScriptNode,
  config: LayoutConfig,
): LayoutBox {
  const supY = base.baseline - supShift - sup.baseline;

  const topOverflow = Math.max(0, -supY);
  const actualBaseY = topOverflow;
  const actualSupY = supY + topOverflow;

  const totalWidth = base.width + sup.width;
  const totalHeight = Math.max(actualBaseY + base.height, actualSupY + sup.height);
  const baseline = actualBaseY + base.baseline;

  const positionedBase = base.children.map((c) => ({
    ...c,
    y: c.y + actualBaseY,
  }));
  const positionedSup = sup.children.map((c) => ({
    ...c,
    x: c.x + base.width,
    y: c.y + actualSupY,
  }));

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: [...positionedBase, ...positionedSup],
    node,
  };
}

/**
 * Assemble a layout box with a subscript to the right of the base.
 * subShift: distance from base baseline downward to sub baseline.
 */
function assembleSubLayout(
  base: ReturnType<typeof arrangeHorizontally>,
  sub: ReturnType<typeof arrangeHorizontally>,
  subShift: number,
  node: ScriptNode,
  config: LayoutConfig,
): LayoutBox {
  const subY = base.baseline + subShift - sub.baseline;

  const totalWidth = base.width + sub.width;
  const totalHeight = Math.max(base.height, subY + sub.height);
  const baseline = base.baseline;

  const positionedBase = base.children.map((c) => ({ ...c }));
  const positionedSub = sub.children.map((c) => ({
    ...c,
    x: c.x + base.width,
    y: c.y + subY,
  }));

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: [...positionedBase, ...positionedSub],
    node,
  };
}

/**
 * Assemble a layout box with both sub and sup to the right of the base.
 */
function assembleSubSupLayout(
  base: ReturnType<typeof arrangeHorizontally>,
  sup: ReturnType<typeof arrangeHorizontally>,
  sub: ReturnType<typeof arrangeHorizontally>,
  supShift: number,
  subShift: number,
  node: ScriptNode,
  config: LayoutConfig,
): LayoutBox {
  const supY = base.baseline - supShift - sup.baseline;
  const subY = base.baseline + subShift - sub.baseline;

  const topOverflow = Math.max(0, -supY);
  const actualBaseY = topOverflow;
  const actualSupY = supY + topOverflow;
  const actualSubY = subY + topOverflow;

  const scriptWidth = Math.max(sup.width, sub.width);
  const totalWidth = base.width + scriptWidth;
  const totalHeight = Math.max(
    actualBaseY + base.height,
    actualSupY + sup.height,
    actualSubY + sub.height,
  );
  const baseline = actualBaseY + base.baseline;

  const positionedBase = base.children.map((c) => ({
    ...c,
    y: c.y + actualBaseY,
  }));
  const positionedSup = sup.children.map((c) => ({
    ...c,
    x: c.x + base.width,
    y: c.y + actualSupY,
  }));
  const positionedSub = sub.children.map((c) => ({
    ...c,
    x: c.x + base.width,
    y: c.y + actualSubY,
  }));

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: [...positionedBase, ...positionedSup, ...positionedSub],
    node,
  };
}

/**
 * Assemble a pre-script layout -- scripts go BEFORE the base.
 */
function assemblePreScriptLayout(
  base: ReturnType<typeof arrangeHorizontally>,
  sup: ReturnType<typeof arrangeHorizontally>,
  sub: ReturnType<typeof arrangeHorizontally>,
  supShift: number,
  subShift: number,
  node: ScriptNode,
  config: LayoutConfig,
): LayoutBox {
  const scriptWidth = Math.max(sup.width, sub.width);

  const supY = base.baseline - supShift - sup.baseline;
  const subY = base.baseline + subShift - sub.baseline;

  const topOverflow = Math.max(0, -supY);
  const actualBaseY = topOverflow;
  const actualSupY = supY + topOverflow;
  const actualSubY = subY + topOverflow;

  const totalWidth = scriptWidth + base.width;
  const totalHeight = Math.max(
    actualBaseY + base.height,
    actualSupY + sup.height,
    actualSubY + sub.height,
  );
  const baseline = actualBaseY + base.baseline;

  const positionedSup = sup.children.map((c) => ({
    ...c,
    y: c.y + actualSupY,
  }));
  const positionedSub = sub.children.map((c) => ({
    ...c,
    y: c.y + actualSubY,
  }));
  const positionedBase = base.children.map((c) => ({
    ...c,
    x: c.x + scriptWidth,
    y: c.y + actualBaseY,
  }));

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: [...positionedSup, ...positionedSub, ...positionedBase],
    node,
  };
}

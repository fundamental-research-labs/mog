/**
 * Radical Layout (TeXbook Rule 11)
 *
 * Computes layout for radical nodes (m:rad).
 * Radical sign sized to content with vinculum (overbar).
 *
 * Key layout rules from TeX:
 * - Vinculum thickness = ruleThickness from font parameters
 * - Clearance above radicand: display = 2 * ruleThickness, text/script = ruleThickness
 * - Radical sign width proportional to total content height (min 0.5em)
 * - Degree (nth root index) laid out in script-script style
 */

import type { RadicalNode } from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS } from './default-metrics';
import {
  arrangeHorizontally,
  configForStyle,
  type LayoutBox,
  type LayoutConfig,
  supStyle,
} from './types';

export function layoutRadical(node: RadicalNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const style = config.style || 'D';
  const isDisplay = style === 'D';
  const layoutNodes = config.layoutNodes!;

  // Layout radicand (content under the radical)
  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);

  // Vinculum and clearance from font parameters (TeXbook Rule 11)
  const ruleThickness = fp.ruleThickness * fontSize;
  const clearance = isDisplay ? 2 * ruleThickness : ruleThickness;
  const vinculumThickness = ruleThickness;

  // Radical sign dimensions: height covers content + clearance + vinculum
  const radicalHeight = base.height + clearance + vinculumThickness;
  const radicalWidth = Math.max(radicalHeight * config.radicalWidthRatio, fontSize * 0.5);

  // Degree (for nth roots) - use script-script style (two levels down)
  let degWidth = 0;
  let degHeight = 0;
  let degChildren: LayoutBox[] = [];
  if (!node.degHide && node.deg.length > 0) {
    const ssStyle = supStyle(supStyle(style));
    const degConfig = configForStyle(config, ssStyle);
    const degChildBoxes = layoutNodes(node.deg, degConfig);
    const degBox = arrangeHorizontally(degChildBoxes, degConfig.style);
    degWidth = degBox.width;
    degHeight = degBox.height;
    degChildren = degBox.children;
  }

  // Content positioning
  const contentX = Math.max(degWidth * 0.3, 0) + radicalWidth;
  const contentY = vinculumThickness + clearance;

  const totalWidth = contentX + base.width + fontSize * 0.1; // small right padding
  const totalHeight = contentY + base.height;
  const baseline = contentY + base.baseline;

  // Position base children
  const positionedBase = base.children.map((c) => ({
    ...c,
    x: c.x + contentX,
    y: c.y + contentY,
  }));

  // Position degree children (upper-left, overlapping radical sign)
  // Degree sits at about 60% up the radical sign
  const degY = Math.max(0, totalHeight * 0.3 - degHeight);
  const positionedDeg = degChildren.map((c) => ({
    ...c,
    x: c.x,
    y: c.y + degY,
  }));

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: [...positionedDeg, ...positionedBase],
    node,
  };
}

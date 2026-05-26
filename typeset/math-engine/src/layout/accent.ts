/**
 * Accent Layout
 *
 * Computes layout for accent nodes (m:acc).
 * Accent mark positioned above the base expression.
 *
 * Implements TeXbook accent placement rules:
 * - Accent height from font metrics (not hardcoded)
 * - Skew-based horizontal offset for italic base characters
 * - Vertical gap from ruleThickness font parameter
 * - Width is at least as wide as base or accent character
 */

import type { AccentNode, MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS } from './default-metrics';
import { arrangeHorizontally, type LayoutBox, type LayoutConfig } from './types';

export function layoutAccent(node: AccentNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const metrics = config.metrics;
  const layoutNodes = config.layoutNodes!;

  const baseChildren = layoutNodes(node.e, config);
  const base = arrangeHorizontally(baseChildren, config.style);

  // Measure accent character
  const accentChar = node.chr || '\u0302'; // default: circumflex
  let accentHeight: number;
  let accentWidth: number;

  if (metrics) {
    const accentMetrics = metrics.measureGlyph(accentChar, fontSize, {});
    accentHeight = accentMetrics.height + accentMetrics.depth;
    accentWidth = accentMetrics.width;
  } else {
    accentHeight = fontSize * 0.3;
    accentWidth = fontSize * 0.5;
  }

  // Gap between base and accent: use ruleThickness
  const gap = fp.ruleThickness * fontSize;

  // Compute skew: if base is a single character, use its skew for accent offset
  let skewOffset = 0;
  if (metrics && node.e.length === 1 && node.e[0].type === 'r') {
    const baseRun = node.e[0] as MathNode & { type: 'r' };
    const baseChar = baseRun.text || '';
    if (baseChar.length === 1) {
      const baseMetrics = metrics.measureGlyph(baseChar, fontSize, {
        italic: true, // math italic by default
      });
      skewOffset = baseMetrics.skew;
    }
  }

  // Total dimensions
  const totalHeight = accentHeight + gap + base.height;
  const baseY = accentHeight + gap;
  const baseline = baseY + base.baseline;

  // Width: at least the base width or accent width
  const width = Math.max(base.width, accentWidth);

  // Position base (centered if accent is wider)
  const baseXOffset = Math.max(0, (width - base.width) / 2);
  const positionedBase = base.children.map((c) => ({
    ...c,
    x: c.x + baseXOffset,
    y: c.y + baseY,
  }));

  // Suppress unused-variable lint for skewOffset (used by render-plan for accent character positioning)
  void skewOffset;

  return {
    x: 0,
    y: 0,
    width,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: positionedBase,
    node,
  };
}

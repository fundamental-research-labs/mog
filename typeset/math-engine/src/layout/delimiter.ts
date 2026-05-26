/**
 * Delimiter Layout — TeXbook Rule 19
 *
 * Computes layout for delimiter nodes (m:d).
 * Implements axis-centered delimiter sizing per Knuth's Rule 19:
 *   - Delimiters are centered on the math axis
 *   - Delimiter height covers content above and below the axis,
 *     minus the delimiter shortfall tolerance
 *   - Null (invisible) delimiters use nullDelimiterSpace width
 *   - Bracket width scales proportionally with delimiter height
 */

import type { DelimiterNode } from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS } from './default-metrics';
import { arrangeHorizontally, type LayoutBox, type LayoutConfig } from './types';

export function layoutDelimiter(node: DelimiterNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const axisHeight = fp.axisHeight * fontSize;
  const layoutNodes = config.layoutNodes!;

  // Layout all content elements
  const contentGroups = node.e.map((group) => {
    const children = layoutNodes(group, config);
    return arrangeHorizontally(children, config.style);
  });

  // Combine content groups with separator spacing
  const sepWidth = node.sepChr ? fontSize * 0.3 : 0;
  let totalContentWidth = 0;
  let maxHeight = 0;
  let maxBaseline = 0;

  for (let i = 0; i < contentGroups.length; i++) {
    const group = contentGroups[i];
    totalContentWidth += group.width;
    if (i > 0) totalContentWidth += sepWidth;
    maxHeight = Math.max(maxHeight, group.height);
    maxBaseline = Math.max(maxBaseline, group.baseline);
  }

  // TeXbook Rule 19: Axis-centered delimiter sizing
  const contentAboveAxis = maxBaseline - axisHeight;
  const contentBelowAxis = maxHeight - maxBaseline + axisHeight;

  const shortfall = fp.delimiterShortfall * fontSize;
  const halfDelim = Math.max(contentAboveAxis, contentBelowAxis) - shortfall;

  // Delimiter height is at least the content height (never shrink below it)
  const delimHeight = Math.max(maxHeight, halfDelim * 2);

  // Bracket width: scale with delimiter height, with a minimum
  const hasBeg = !!node.begChr;
  const hasEnd = !!node.endChr;
  const nullSpace = fp.nullDelimiterSpace * fontSize;

  const bracketWidth = Math.max(fontSize * 0.3, delimHeight * 0.12);

  // Null delimiters (empty begChr/endChr) get nullDelimiterSpace width
  const begWidth = hasBeg ? bracketWidth : nullSpace;
  const endWidth = hasEnd ? bracketWidth : nullSpace;
  const padding = config.delimiterPadding;

  const totalWidth =
    begWidth + (hasBeg ? padding : 0) + totalContentWidth + (hasEnd ? padding : 0) + endWidth;

  // Position content after the beginning delimiter
  let xOffset = begWidth + (hasBeg ? padding : 0);
  const allChildren: LayoutBox[] = [];

  for (let i = 0; i < contentGroups.length; i++) {
    const group = contentGroups[i];
    if (i > 0) xOffset += sepWidth;

    const yOffset = maxBaseline - group.baseline;
    for (const child of group.children) {
      allChildren.push({
        ...child,
        x: child.x + xOffset,
        y: child.y + yOffset,
      });
    }
    xOffset += group.width;
  }

  return {
    x: 0,
    y: 0,
    width: totalWidth,
    height: delimHeight,
    baseline: maxBaseline,
    fontSize: config.fontSize,
    children: allChildren,
    node,
  };
}

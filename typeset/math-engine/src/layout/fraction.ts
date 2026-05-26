/**
 * Fraction Layout — TeXbook Rule 15
 *
 * Implements TeX's fraction layout algorithm. The fraction bar sits on
 * the math axis. Numerator and denominator positions are determined by
 * the current math style (Display vs Text/Script/ScriptScript), using
 * the font parameters num1/num2 and denom1/denom2 from Computer Modern.
 *
 * For bar fractions: minimum clearance between content and bar is enforced
 * (3 * ruleThickness in display, 1 * ruleThickness in text styles).
 *
 * For no-bar fractions (e.g. \binom): a minimum gap is enforced between
 * numerator bottom and denominator top (7 * ruleThickness in display,
 * 3 * ruleThickness in text styles).
 */

import type { FractionNode } from '@mog-sdk/contracts/equation/omml-ast';
import { CM_FONT_PARAMS } from './default-metrics';
import {
  arrangeHorizontally,
  configForStyle,
  fracDenominatorStyle,
  fracNumeratorStyle,
  type LayoutBox,
  type LayoutConfig,
} from './types';

export function layoutFraction(node: FractionNode, config: LayoutConfig): LayoutBox {
  const fp = config.fontParams ?? CM_FONT_PARAMS;
  const fontSize = config.fontSize;
  const style = config.style || 'D';
  const isDisplay = style === 'D';
  const layoutNodes = config.layoutNodes!;

  // 1. Layout children in appropriate sub-styles.
  //    Numerator: D->T, T->S, S->SS, SS->SS (non-cramped)
  //    Denominator: same transitions but cramped
  const numConfig = configForStyle(config, fracNumeratorStyle(style));
  const denConfig = configForStyle(config, fracDenominatorStyle(style), true);

  const numChildren = layoutNodes(node.num, numConfig);
  const denChildren = layoutNodes(node.den, denConfig);
  const numBox = arrangeHorizontally(numChildren, numConfig.style);
  const denBox = arrangeHorizontally(denChildren, denConfig.style);

  // 2. Convert em-relative font parameters to absolute units.
  const ruleThickness = fp.ruleThickness * fontSize;

  // Shift amounts: distance from axis to numerator/denominator baselines.
  // In display style, use the larger num1/denom1 values for more generous spacing.
  const numShift = (isDisplay ? fp.num1 : fp.num2) * fontSize;
  const denShift = (isDisplay ? fp.denom1 : fp.denom2) * fontSize;

  // Bar presence: noBar fractions (like \binom) have no rule drawn.
  const hasBar = node.fractionType !== 'noBar';
  const barThickness = hasBar ? ruleThickness : 0;

  // 3. Width: max of numerator and denominator, centered horizontally.
  const width = Math.max(numBox.width, denBox.width);
  const numXOffset = (width - numBox.width) / 2;
  const denXOffset = (width - denBox.width) / 2;

  // 4. Vertical positioning.
  let aboveAxis: number;
  let belowAxis: number;

  if (hasBar) {
    // ── Bar fraction (standard \frac) ──
    const minClearance = isDisplay ? 3 * ruleThickness : ruleThickness;

    const numDepth = numBox.height - numBox.baseline;
    let adjustedNumShift = numShift;
    const numToBarGap = adjustedNumShift - numDepth - barThickness / 2;
    if (numToBarGap < minClearance) {
      adjustedNumShift += minClearance - numToBarGap;
    }

    let adjustedDenShift = denShift;
    const barToDenGap = adjustedDenShift - denBox.baseline - barThickness / 2;
    if (barToDenGap < minClearance) {
      adjustedDenShift += minClearance - barToDenGap;
    }

    aboveAxis = numBox.baseline + adjustedNumShift;
    belowAxis = adjustedDenShift + (denBox.height - denBox.baseline);
  } else {
    // ── No-bar fraction (e.g. \binom) ──
    const minGap = isDisplay ? 7 * ruleThickness : 3 * ruleThickness;

    const numDepth = numBox.height - numBox.baseline;
    const naturalGap = numShift - numDepth + (denShift - denBox.baseline);

    if (naturalGap < minGap) {
      const deficit = minGap - naturalGap;
      const halfDeficit = deficit / 2;
      aboveAxis = numBox.baseline + numShift + halfDeficit;
      belowAxis = denShift + halfDeficit + (denBox.height - denBox.baseline);
    } else {
      aboveAxis = numBox.baseline + numShift;
      belowAxis = denShift + (denBox.height - denBox.baseline);
    }
  }

  // 5. Compute final positions.
  const totalHeight = aboveAxis + belowAxis;
  const baseline = aboveAxis;

  const numY = 0;
  const denY = totalHeight - denBox.height;

  const numPositioned = numBox.children.map((c) => ({
    ...c,
    x: c.x + numXOffset,
    y: c.y + numY,
  }));
  const denPositioned = denBox.children.map((c) => ({
    ...c,
    x: c.x + denXOffset,
    y: c.y + denY,
  }));

  return {
    x: 0,
    y: 0,
    width,
    height: totalHeight,
    baseline,
    fontSize: config.fontSize,
    children: [...numPositioned, ...denPositioned],
    node,
  };
}

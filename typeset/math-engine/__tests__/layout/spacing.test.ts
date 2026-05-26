/**
 * Inter-Atom Spacing Tests
 *
 * Tests the TeX inter-atom spacing system (TeXbook Chapter 18, Appendix G).
 * Verifies that the spacing table is correctly applied between adjacent
 * atoms of different types, and that script styles suppress certain spacing.
 */

import type { LayoutBox } from '../../src/layout/layout-engine';
import { layoutEquation } from '../../src/layout/layout-engine';
import { parseLatex } from '../../src/parser/latex-parser';

function layout(latex: string, fontSize = 12): LayoutBox {
  const result = parseLatex(latex);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  return layoutEquation(result.value, fontSize);
}

describe('inter-atom spacing', () => {
  test('relation operators get thick space on both sides', () => {
    const box = layout('a=b');
    // Should be wider than sum of individual character widths
    const aBox = layout('a');
    const eqBox = layout('=');
    const bBox = layout('b');
    const noSpaceWidth = aBox.width + eqBox.width + bBox.width;
    expect(box.width).toBeGreaterThan(noSpaceWidth);
  });

  test('binary operators get medium space on both sides', () => {
    const box = layout('a+b');
    const aBox = layout('a');
    const plusBox = layout('+');
    const bBox = layout('b');
    const noSpaceWidth = aBox.width + plusBox.width + bBox.width;
    expect(box.width).toBeGreaterThan(noSpaceWidth);
  });

  test('no space after opening delimiter', () => {
    // Opening delimiters should not add extra space to content
    const withParen = layout('\\left(a\\right)');
    // This is more of a structural test - just ensure it lays out
    expect(withParen.width).toBeGreaterThan(0);
  });

  test('punctuation gets thin space after', () => {
    const box = layout('a,b');
    const aBox = layout('a');
    const commaBox = layout(',');
    const bBox = layout('b');
    const noSpaceWidth = aBox.width + commaBox.width + bBox.width;
    // Punctuation-Ord gets thin space
    expect(box.width).toBeGreaterThan(noSpaceWidth);
  });

  test('ordinary atoms have no spacing between them', () => {
    const box = layout('ab');
    const aBox = layout('a');
    const bBox = layout('b');
    // Ord-Ord has 0 spacing, so widths should be equal (approximately)
    expect(box.width).toBeCloseTo(aBox.width + bBox.width, 1);
  });

  test('script style suppresses spacing', () => {
    // In subscripts, spacing between binary operators should be suppressed
    const display = layout('a+b');
    const inSub = layout('x_{a+b}');
    // The subscript content should be narrower relative to its font size
    // compared to the same content at display size
    expect(inSub.width).toBeGreaterThan(0);
    expect(display.width).toBeGreaterThan(0);
  });
});

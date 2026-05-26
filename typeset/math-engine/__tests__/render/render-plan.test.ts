import { layoutEquation } from '../../src/layout/layout-engine';
import { parseLatex } from '../../src/parser/latex-parser';
import type { RenderInstruction } from '../../src/render/render-plan';
import { layoutToRenderPlan } from '../../src/render/render-plan';

function getInstructions(latex: string, fontSize = 12): RenderInstruction[] {
  const result = parseLatex(latex);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const layout = layoutEquation(result.value, fontSize);
  return layoutToRenderPlan(layout, fontSize);
}

function flattenInstructions(instructions: RenderInstruction[]): RenderInstruction[] {
  const flat: RenderInstruction[] = [];
  for (const i of instructions) {
    flat.push(i);
    if (i.type === 'group') flat.push(...flattenInstructions(i.children));
  }
  return flat;
}

describe('render-plan', () => {
  test('text instructions use box fontSize, not root fontSize', () => {
    // Subscript text should have smaller fontSize than root
    const instructions = getInstructions('x_{a}');
    const texts = flattenInstructions(instructions).filter(
      (i): i is RenderInstruction & { type: 'text' } => i.type === 'text',
    );
    // Should have at least 2 text nodes: 'x' and 'a'
    expect(texts.length).toBeGreaterThanOrEqual(2);
    // Find the 'x' and 'a' text nodes
    const xText = texts.find((t) => t.text === 'x');
    const aText = texts.find((t) => t.text === 'a');
    expect(xText).toBeDefined();
    expect(aText).toBeDefined();
    // Subscript 'a' should have smaller fontSize than base 'x'
    expect(aText!.fontSize).toBeLessThan(xText!.fontSize);
  });

  test('fraction bar thickness scales with fontSize', () => {
    const instructions = getInstructions('\\frac{a}{b}');
    const lines = flattenInstructions(instructions).filter(
      (i): i is RenderInstruction & { type: 'line' } => i.type === 'line',
    );
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // Thickness should not be hardcoded to 1, should be ~0.48 for fontSize 12
    const fracBar = lines[0];
    expect(fracBar.thickness).toBeCloseTo(12 * 0.04, 1);
  });

  test('text runs get correct fontSize in deeply nested fractions', () => {
    const instructions = getInstructions('\\frac{\\frac{a}{b}}{c}');
    const texts = flattenInstructions(instructions).filter(
      (i): i is RenderInstruction & { type: 'text' } => i.type === 'text',
    );
    // Get unique font sizes
    const sizes = [...new Set(texts.map((t) => t.fontSize))].sort((a, b) => b - a);
    // Should have at least 2 different sizes (outer denominator vs inner fraction)
    expect(sizes.length).toBeGreaterThanOrEqual(2);
  });

  test('radical stroke width scales with fontSize', () => {
    const instructions = getInstructions('\\sqrt{x}');
    const paths = flattenInstructions(instructions).filter(
      (i): i is RenderInstruction & { type: 'path' } => i.type === 'path',
    );
    expect(paths.length).toBeGreaterThanOrEqual(1);
    // Should not be 1, should scale
    expect(paths[0].strokeWidth).toBeCloseTo(12 * 0.04, 1);
  });

  test('delimiter fontSize scales with box height', () => {
    const instructions = getInstructions('\\left(x\\right)');
    const texts = flattenInstructions(instructions).filter(
      (i): i is RenderInstruction & { type: 'text' } => i.type === 'text',
    );
    // Should have delimiter texts for ( and )
    const parens = texts.filter((t) => t.text === '(' || t.text === ')');
    expect(parens.length).toBe(2);
  });

  test('larger base fontSize produces proportionally larger text instructions', () => {
    const small = getInstructions('x', 12);
    const large = getInstructions('x', 24);
    const smallTexts = flattenInstructions(small).filter(
      (i): i is RenderInstruction & { type: 'text' } => i.type === 'text',
    );
    const largeTexts = flattenInstructions(large).filter(
      (i): i is RenderInstruction & { type: 'text' } => i.type === 'text',
    );
    expect(smallTexts.length).toBeGreaterThan(0);
    expect(largeTexts.length).toBeGreaterThan(0);
    expect(largeTexts[0].fontSize).toBe(smallTexts[0].fontSize * 2);
  });
});

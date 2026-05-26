/**
 * Render Plan
 *
 * Converts a LayoutBox tree into platform-agnostic render instructions.
 * These instructions can be consumed by Canvas, SVG, or any other renderer.
 */

import type { MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import type { LayoutBox } from '../layout/layout-engine';

/**
 * Platform-agnostic render instruction.
 */
export type RenderInstruction =
  | TextInstruction
  | LineInstruction
  | PathInstruction
  | GroupInstruction;

export interface TextInstruction {
  type: 'text';
  text: string;
  x: number;
  y: number;
  fontSize: number;
  italic?: boolean;
  bold?: boolean;
  fontFamily?: string;
}

export interface LineInstruction {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}

export interface PathInstruction {
  type: 'path';
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface GroupInstruction {
  type: 'group';
  transform?: { tx: number; ty: number };
  children: RenderInstruction[];
}

/**
 * Convert a LayoutBox tree to render instructions.
 */
export function layoutToRenderPlan(
  layout: LayoutBox,
  _baseFontSize: number = 12,
): RenderInstruction[] {
  return renderBox(layout, 0, 0);
}

function renderBox(box: LayoutBox, parentX: number, parentY: number): RenderInstruction[] {
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  const instructions: RenderInstruction[] = [];

  // Render the node itself based on its type, using the box's own fontSize
  const nodeInstructions = renderNode(box.node, absX, absY, box, box.fontSize);
  instructions.push(...nodeInstructions);

  // Render children — each child uses its own box.fontSize
  for (const child of box.children) {
    const childInstructions = renderBox(child, absX, absY);
    instructions.push(...childInstructions);
  }

  return instructions;
}

function renderNode(
  node: MathNode,
  x: number,
  y: number,
  box: LayoutBox,
  fontSize: number,
): RenderInstruction[] {
  switch (node.type) {
    case 'r':
      return renderTextRun(node, x, y, box, fontSize);
    case 'f':
      return renderFractionBar(node, x, y, box, fontSize);
    case 'rad':
      return renderRadicalSign(node, x, y, box, fontSize);
    case 'bar':
      return renderBarLine(node, x, y, box, fontSize);
    case 'acc':
      return renderAccentMark(node, x, y, box, fontSize);
    case 'd':
      return renderDelimiters(node, x, y, box, fontSize);
    default:
      return [];
  }
}

function renderTextRun(
  node: MathNode & { type: 'r' },
  x: number,
  y: number,
  box: LayoutBox,
  fontSize: number,
): RenderInstruction[] {
  if (!node.text) return [];

  const italic =
    node.rPr?.sty === 'i' || node.rPr?.sty === 'bi' || (!node.rPr?.nor && !node.rPr?.sty);
  const bold = node.rPr?.sty === 'b' || node.rPr?.sty === 'bi';

  return [
    {
      type: 'text',
      text: node.text,
      x,
      y: y + box.baseline,
      fontSize,
      italic: italic || undefined,
      bold: bold || undefined,
    },
  ];
}

function renderFractionBar(
  node: MathNode & { type: 'f' },
  x: number,
  y: number,
  box: LayoutBox,
  fontSize: number,
): RenderInstruction[] {
  if (node.fractionType === 'noBar') return [];

  // Draw the fraction bar at the baseline position, thickness scales with fontSize
  return [
    {
      type: 'line',
      x1: x,
      y1: y + box.baseline,
      x2: x + box.width,
      y2: y + box.baseline,
      thickness: fontSize * 0.04,
    },
  ];
}

function renderRadicalSign(
  _node: MathNode & { type: 'rad' },
  x: number,
  y: number,
  box: LayoutBox,
  fontSize: number,
): RenderInstruction[] {
  const radWidth = Math.max(box.height * 0.6 * 0.6, fontSize * 0.5);
  const instructions: RenderInstruction[] = [];

  // Radical sign as a path
  const hookX = x;
  const hookY = y + box.height * 0.6;
  const tailX = x + radWidth * 0.3;
  const tailY = y + box.height;
  const topX = x + radWidth * 0.7;
  const topY = y;
  const vinculumEndX = x + box.width;

  const d = `M ${hookX} ${hookY} L ${tailX} ${tailY} L ${topX} ${topY} L ${vinculumEndX} ${topY}`;

  instructions.push({
    type: 'path',
    d,
    stroke: 'currentColor',
    strokeWidth: fontSize * 0.04,
  });

  return instructions;
}

function renderBarLine(
  node: MathNode & { type: 'bar' },
  x: number,
  y: number,
  box: LayoutBox,
  fontSize: number,
): RenderInstruction[] {
  const barY = node.pos === 'top' ? y : y + box.height;
  return [
    {
      type: 'line',
      x1: x,
      y1: barY,
      x2: x + box.width,
      y2: barY,
      thickness: fontSize * 0.04,
    },
  ];
}

function renderAccentMark(
  node: MathNode & { type: 'acc' },
  x: number,
  y: number,
  box: LayoutBox,
  fontSize: number,
): RenderInstruction[] {
  const chr = node.chr || '\u0302'; // circumflex by default
  const centerX = x + box.width / 2;

  return [
    {
      type: 'text',
      text: chr,
      x: centerX - fontSize * 0.15,
      y: y + fontSize * 0.3,
      fontSize: fontSize * 0.8,
    },
  ];
}

function renderDelimiters(
  node: MathNode & { type: 'd' },
  x: number,
  y: number,
  box: LayoutBox,
  fontSize: number,
): RenderInstruction[] {
  const instructions: RenderInstruction[] = [];
  const bracketWidth = Math.max(fontSize * 0.3, box.height * 0.15);

  if (node.begChr) {
    instructions.push({
      type: 'text',
      text: node.begChr,
      x,
      y: y + box.baseline,
      fontSize: box.height * 0.8,
    });
  }

  if (node.endChr) {
    instructions.push({
      type: 'text',
      text: node.endChr,
      x: x + box.width - bracketWidth,
      y: y + box.baseline,
      fontSize: box.height * 0.8,
    });
  }

  return instructions;
}

/**
 * Mark primitives - fundamental visual building blocks for charts.
 *
 * This module exports all mark types and their rendering functions.
 * All functions are pure with no side effects outside canvas drawing.
 */

// Types (re-exported from parent types.ts)
export type {
  AnyMark,
  ArcMark,
  Mark,
  MarkStyle,
  PathMark,
  RectMark,
  SymbolMark,
  SymbolShape,
  TextAlign,
  TextBaseline,
  TextMark,
} from '../types';

// Rectangle mark
export { applyStyle, createRect, hitTestRect, renderRect, roundRect } from './rect';

// Path mark
export {
  applyPathCommands,
  arcEndpointToCenter,
  areaPathFromPoints,
  createPath,
  linePathFromPoints,
  parsePath,
  renderPath,
} from './path';
export type { PathCommand } from './path';

// Arc mark
export { createArc, createPieArcs, getArcCentroid, hitTestArc, renderArc } from './arc';

// Text mark
export {
  createAxisLabel,
  createText,
  createTitle,
  defaultTextOptions,
  getTextBounds,
  hitTestText,
  measureTextWidth,
  renderText,
  truncateText,
} from './text';

// Symbol mark
export {
  createScatterSymbols,
  createSymbol,
  defaultSymbolSize,
  drawSymbolShape,
  getSymbolShapes,
  hitTestSymbol,
  renderSymbol,
  sizeToRadius,
} from './symbol';

import type { AnyMark } from '../types';
import { renderArc } from './arc';
import { renderPath } from './path';
import { renderRect } from './rect';
import { renderSymbol } from './symbol';
import { renderText } from './text';

/**
 * Render any mark type to canvas.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Any mark type to render
 */
export function renderMark(ctx: CanvasRenderingContext2D, mark: AnyMark): void {
  switch (mark.type) {
    case 'rect':
      renderRect(ctx, mark);
      break;
    case 'path':
      renderPath(ctx, mark);
      break;
    case 'arc':
      renderArc(ctx, mark);
      break;
    case 'text':
      renderText(ctx, mark);
      break;
    case 'symbol':
      renderSymbol(ctx, mark);
      break;
  }
}

/**
 * Render an array of marks to canvas.
 *
 * @param ctx - Canvas 2D rendering context
 * @param marks - Array of marks to render
 */
export function renderMarks(ctx: CanvasRenderingContext2D, marks: AnyMark[]): void {
  for (const mark of marks) {
    renderMark(ctx, mark);
  }
}

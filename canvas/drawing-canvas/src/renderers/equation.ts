/**
 * Equation Renderer
 *
 * Renders EquationScene objects via AstToLatexFn bridge for LaTeX rendering.
 * When the bridge is unavailable, falls back to rendering the raw LaTeX source
 * as plain monospace text centered in the bounds.
 *
 * Pure function with error boundary: try-catch to renderErrorPlaceholder.
 *
 * @module @mog/drawing-canvas/renderers/equation
 */

import type { AstToLatexFn } from '../bridges/types';
import type { EquationScene } from '../scene/types';
import { withRenderContext } from './render-utils';

// =============================================================================
// Equation Renderer
// =============================================================================

/**
 * Render an EquationScene object to the canvas.
 *
 * - If astToLatexFn bridge is available: delegates LaTeX rendering to the bridge.
 * - If bridge is null: renders the raw LaTeX source as plain monospace text
 *   centered on a light gray background (fallback).
 * - On error: renders an error placeholder labeled "Equation".
 */
export function renderEquation(
  ctx: CanvasRenderingContext2D,
  obj: EquationScene,
  astToLatexFn: AstToLatexFn | null,
): void {
  withRenderContext(ctx, obj, 'Equation', () => {
    if (astToLatexFn) {
      astToLatexFn(obj.data.latex, ctx, obj.bounds, obj.data.style);
    } else {
      renderLatexFallback(ctx, obj);
    }
  });
}

// =============================================================================
// Fallback: Plain Text LaTeX Source
// =============================================================================

/**
 * Render the raw LaTeX source string as plain monospace text on a light gray
 * background. Used when the AstToLatexFn bridge is not available.
 */
function renderLatexFallback(ctx: CanvasRenderingContext2D, obj: EquationScene): void {
  const { bounds } = obj;

  // Gray background
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Centered LaTeX source text
  const fontSize = obj.data.style?.fontSize ?? 12;
  const color = obj.data.style?.color ?? '#666666';

  ctx.fillStyle = color;
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    obj.data.latex,
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    bounds.width - 8,
  );
}

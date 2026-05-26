/**
 * Canvas Bridge Types for Grid Renderer
 *
 * These types define the canvas-rendering-specific bridge interfaces used by
 * GridRenderer. They are distinct from the higher-level bridge types in
 * contracts/bridges/ (e.g., ITextEffectRenderingBridge manages lifecycle/caching,
 * while ITextEffectCanvasBridge just renders to a canvas context).
 *
 * Drawing-canvas imports these types for its BridgeRegistry, and grid-renderer
 * passes them through without casts.
 *
 * @module @mog-sdk/contracts/rendering/canvas-bridge-types
 */

// =============================================================================
// Bounds (simple rect for rendering — avoids depending on canvas-engine)
// =============================================================================

/**
 * Simple axis-aligned rectangle for rendering bounds.
 *
 * Intentionally minimal to avoid coupling to canvas-engine's Rect type.
 * Structurally compatible with canvas-engine Rect, so no adapters needed.
 */
export interface RenderBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// =============================================================================
// Equation Rendering Bridge
// =============================================================================

/**
 * Function that renders a LaTeX string onto a canvas context.
 *
 * This is the canvas-rendering counterpart of AstToLatexFn (which converts
 * an AST node to a LaTeX string). The rendering function receives the LaTeX
 * string and draws it into the given bounds.
 *
 * NOTE: Despite the name "AstToLatex" used historically, this function takes
 * a LaTeX string (not an AST node) and renders it to canvas (not to a string).
 */
export type RenderLatexFn = (
  latex: string,
  ctx: CanvasRenderingContext2D,
  bounds: RenderBounds,
  style?: { fontSize?: number; color?: string },
) => void;

// =============================================================================
// TextEffect Canvas Rendering Bridge
// =============================================================================

/**
 * Bridge for rendering TextEffect text effects to canvas.
 *
 * This is the low-level canvas rendering bridge, distinct from
 * ITextEffectRenderingBridge (which manages compute/cache lifecycle).
 * Drawing-canvas calls renderTextEffect() during its render pass.
 */
export interface ITextEffectCanvasBridge {
  renderTextEffect(
    text: string,
    warpPreset: string,
    warpAdjustments: { adj1?: number; adj2?: number } | undefined,
    textFill:
      | {
          type: string;
          color?: string;
          gradient?: {
            type: 'linear' | 'radial';
            angle?: number;
            stops: ReadonlyArray<{ offset: number; color: string }>;
          };
        }
      | undefined,
    textOutline: { style: string; color: string; width: number } | undefined,
    ctx: CanvasRenderingContext2D,
    bounds: RenderBounds,
  ): void;
}

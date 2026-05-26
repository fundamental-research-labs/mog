/**
 * Bridge Interfaces for Drawing Canvas
 *
 * Drawing-canvas delegates to external packages for specialized rendering
 * (Diagram, TextEffect, equations, ink, charts). These bridges define the
 * contract between drawing-canvas and those packages.
 *
 * Required bridges fail-fast on first render if still null.
 * Optional bridges render a gray placeholder when missing.
 *
 * @module @mog/drawing-canvas/bridges/types
 */

import type { Rect } from '@mog/canvas-engine';
import type { InkAccessorForRendering } from '@mog-sdk/contracts/ink';
import type { ITextEffectCanvasBridge, RenderLatexFn } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Re-exports from contracts (shared types used across canvas packages)
// =============================================================================

/**
 * Ink accessor re-exported from contracts.
 * Drawing-canvas stores it in BridgeRegistry but never calls its methods
 * directly — the overlay layer (in grid-canvas) consumes it.
 */
export type IInkAccessorForRendering = InkAccessorForRendering;

/**
 * LaTeX rendering function re-exported from contracts.
 * Renders a LaTeX string onto a CanvasRenderingContext2D.
 */
export type AstToLatexFn = RenderLatexFn;

/**
 * TextEffect canvas rendering bridge re-exported from contracts.
 * Renders TextEffect text effects to a CanvasRenderingContext2D.
 */
export type ITextEffectBridge = ITextEffectCanvasBridge;

// =============================================================================
// Chart Render Bridge (REQUIRED)
// =============================================================================

/**
 * Bridge for rendering charts to canvas.
 * Charts cannot render without this bridge — fail-fast on first render attempt.
 */
export interface IChartRenderBridge {
  renderChart(chartId: string, ctx: CanvasRenderingContext2D, bounds: Rect): void;
}

// =============================================================================
// Diagram Bridge (OPTIONAL)
// =============================================================================

/**
 * Bridge for Diagram diagram rendering.
 * When missing, a gray placeholder with "Diagram" label is rendered.
 */
export interface IDiagramRenderBridge {
  renderDiagram(
    diagramType: string,
    nodes: ReadonlyArray<{ id: string; text: string; level: number }>,
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    objectId?: string,
    quickStyleId?: string,
    colorThemeId?: string,
  ): void;
}

// =============================================================================
// Bridge Config (constructor injection)
// =============================================================================

/**
 * All bridges for drawing-canvas, injected at construction.
 *
 * Required bridges accept null at construction but fail-fast on first render.
 * Optional bridges render graceful placeholders when null.
 */
export interface DrawingBridgeConfig {
  /** REQUIRED — charts cannot render without this */
  chartBridge: IChartRenderBridge | null;
  /** Optional — renders gray placeholder when missing */
  diagramBridge: IDiagramRenderBridge | null;
  /** Optional — falls back to plain text when missing */
  textEffectBridge: ITextEffectBridge | null;
  /** Optional — renders LaTeX as plain text when missing */
  astToLatexFn: AstToLatexFn | null;
  /** Optional — renders gray placeholder when missing */
  inkAccessor: IInkAccessorForRendering | null;
}

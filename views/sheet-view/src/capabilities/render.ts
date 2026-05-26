/**
 * Render Invalidation Capability Implementation
 *
 * Wraps gridRenderer.invalidateAll(), invalidateCells(), and
 * getCurrentSheetId() to provide the ISheetViewRender capability interface.
 *
 * @module @mog-sdk/sheet-view/capabilities/render
 */

import type { CanvasEngineInstance } from '@mog/canvas-engine';
import type { GridRenderer } from '@mog-sdk/contracts/rendering';

import type { ISheetViewRender } from '../capability-interfaces';
import type { CellInvalidationTarget, InvalidationReason } from '../public-types';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface RenderInternals {
  getRenderer(): GridRenderer;
  getEngine(): CanvasEngineInstance;
}

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewRender implements ISheetViewRender {
  constructor(private readonly _internals: RenderInternals) {}

  invalidate(_reason?: InvalidationReason): void {
    const renderer = this._internals.getRenderer();
    renderer.invalidateAll();
  }

  invalidateCells(target: CellInvalidationTarget): void {
    const renderer = this._internals.getRenderer();
    const cells = target.cells.map((c) => ({ row: c.row, col: c.col }));
    renderer.invalidateCells(cells);
  }

  invalidateGeometry(_reason?: InvalidationReason): void {
    // Geometry invalidation marks all layers dirty since headers,
    // cells, and selection all depend on geometry.
    const renderer = this._internals.getRenderer();
    renderer.invalidateAll();
  }

  requestFrame(_reason?: InvalidationReason): void {
    const engine = this._internals.getEngine();
    engine.requestFrame();
  }

  getCurrentSheetId(): string {
    const renderer = this._internals.getRenderer();
    return renderer.getCurrentSheetId();
  }
}

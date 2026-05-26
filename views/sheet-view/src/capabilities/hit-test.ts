/**
 * Hit Test Capability Implementation
 *
 * Wraps gridRenderer.hitTest() to provide the ISheetViewHitTest
 * capability interface, mapping internal UnifiedHitResult to public
 * SheetHitResult.
 *
 * @module @mog-sdk/sheet-view/capabilities/hit-test
 */

import type { GridRenderer } from '@mog-sdk/contracts/rendering';

import type { ISheetViewHitTest } from '../capability-interfaces';
import type { SheetHitResult, SheetPoint } from '../public-types';
import { mapHitResult } from './type-mappers';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface HitTestInternals {
  getRenderer(): GridRenderer;
  getContainer(): HTMLElement;
}

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewHitTest implements ISheetViewHitTest {
  constructor(private readonly _internals: HitTestInternals) {}

  atViewportPoint(point: SheetPoint): SheetHitResult {
    const renderer = this._internals.getRenderer();
    const hit = renderer.hitTest(point.x, point.y);
    return mapHitResult(hit);
  }

  atPagePoint(point: SheetPoint): SheetHitResult {
    const container = this._internals.getContainer();
    const rect = container.getBoundingClientRect();
    const viewportX = point.x - rect.left;
    const viewportY = point.y - rect.top;
    return this.atViewportPoint({ x: viewportX, y: viewportY });
  }
}

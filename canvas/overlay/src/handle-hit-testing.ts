/**
 * Handle Hit Testing
 *
 * Hit testing for selection handles using the CSS-pixel expansion model.
 * Tests are performed against Path2D objects built by handle-paths.ts
 * using `testPointInPath()` from `@mog/spatial`.
 *
 * Test order:
 *   1. Custom handles (warp-adjust, etc.)
 *   2. Group bounding box handles (multi-selection)
 *   3. Per-object handles (single selection)
 *
 * Returns the first hit found, or null if no handle was hit.
 *
 * @module @mog/canvas-overlay/handle-hit-testing
 */

import type { Point } from '@mog/canvas-engine';
import { testPointInPath } from '@mog/spatial';
import type { CustomHandle } from './custom-handles';
import { buildAllHandlePaths, buildCustomHandlePath } from './handle-paths';
import type { OverlayConfig, OverlayHitResult, ScreenBounds } from './types';
import { getHandleVisibility } from './types';

// =============================================================================
// Hit Testing
// =============================================================================

/**
 * Hit test all handles for the current selection state.
 *
 * Tests handles in priority order:
 *   1. Custom handles (e.g., warp-adjust diamond) -- highest priority
 *   2. Group bounding box handles -- if multi-selection (groupBounds provided)
 *   3. Single-object handles -- if exactly one object selected
 *
 * Each handle's hit area is expanded by `config.handleHitExpansion` CSS pixels
 * beyond its visual size, making small handles easier to click.
 *
 * @param ctx - Canvas 2D rendering context (used for testPointInPath)
 * @param screenPoint - Point to test in screen-space CSS pixels
 * @param selectedIds - IDs of currently selected objects
 * @param getObjectBounds - Callback to get screen bounds for an object ID
 * @param isObjectLocked - Callback to check if an object is locked
 * @param groupBounds - Union bounding box for multi-selection (null if single)
 * @param customHandles - Array of custom handles to test
 * @param config - Overlay configuration
 * @returns The first handle hit, or null
 */
export function hitTestHandles(
  ctx: CanvasRenderingContext2D,
  screenPoint: Point,
  selectedIds: ReadonlyArray<string>,
  getObjectBounds: (id: string) => ScreenBounds | null,
  isObjectLocked: (id: string) => boolean,
  groupBounds: ScreenBounds | null,
  customHandles: ReadonlyArray<CustomHandle>,
  config: OverlayConfig,
): OverlayHitResult | null {
  if (selectedIds.length === 0) return null;

  const { x, y } = screenPoint;

  // --- 1. Test custom handles first (highest priority) ---
  for (const handle of customHandles) {
    const path = buildCustomHandlePath(handle, config.handleHitExpansion);
    if (testPointInPath(ctx, path, x, y)) {
      return {
        region: handle.region,
        objectId: handle.id,
      };
    }
  }

  // --- 2. Multi-selection: test group bounding box handles ---
  if (groupBounds !== null && selectedIds.length >= 2) {
    const visibility = getHandleVisibility(groupBounds, false, config);
    const paths = buildAllHandlePaths(groupBounds, visibility, config);

    for (const { region, path } of paths) {
      if (testPointInPath(ctx, path, x, y)) {
        return {
          region,
          objectId: null, // group handle, not a specific object
        };
      }
    }
  }

  // --- 3. Single selection: test per-object handles ---
  if (selectedIds.length === 1) {
    const objectId = selectedIds[0];
    const bounds = getObjectBounds(objectId);
    if (bounds === null) return null;

    const locked = isObjectLocked(objectId);
    const visibility = getHandleVisibility(bounds, locked, config);
    const paths = buildAllHandlePaths(bounds, visibility, config);

    for (const { region, path } of paths) {
      if (testPointInPath(ctx, path, x, y)) {
        return {
          region,
          objectId,
        };
      }
    }
  }

  return null;
}

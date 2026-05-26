/**
 * Drag Preview Rendering
 *
 * Renders semi-transparent dashed outlines of objects at their
 * drag-preview position (originalBounds + dragDelta). Provides
 * visual feedback during drag operations.
 *
 * Ported from grid-canvas/src/layers/overlay/handles/drag-preview.ts
 * but simplified for the canvas overlay's pure-renderer architecture.
 *
 * @module @mog/canvas-overlay/drag-preview
 */

import type { OverlayConfig } from './types';

/**
 * Render drag preview outlines for objects being dragged.
 *
 * For each object in the preview, gets the original bounds from the
 * data source, offsets by the drag delta, and draws a dashed outline
 * at the preview position.
 *
 * All coordinates are in screen-space CSS pixels (post-zoom).
 *
 * @param ctx - Canvas 2D rendering context
 * @param preview - Drag preview state with object IDs and delta
 * @param getObjectBounds - Function to get bounds for a given object ID
 * @param config - Overlay configuration for selection color and drag opacity
 */
export function renderDragPreview(
  ctx: CanvasRenderingContext2D,
  preview: {
    readonly objectIds: ReadonlyArray<string>;
    readonly deltaX: number;
    readonly deltaY: number;
  },
  getObjectBounds: (id: string) => { x: number; y: number; width: number; height: number } | null,
  config: Pick<OverlayConfig, 'selectionColor' | 'dragPreviewOpacity'>,
): void {
  if (preview.objectIds.length === 0) return;

  ctx.save();

  ctx.globalAlpha = config.dragPreviewOpacity;
  ctx.strokeStyle = config.selectionColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);

  for (const objectId of preview.objectIds) {
    const bounds = getObjectBounds(objectId);
    if (!bounds) continue;

    ctx.strokeRect(
      bounds.x + preview.deltaX,
      bounds.y + preview.deltaY,
      bounds.width,
      bounds.height,
    );
  }

  ctx.restore();
}

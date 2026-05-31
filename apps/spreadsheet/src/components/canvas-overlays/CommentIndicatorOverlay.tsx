/**
 * CommentIndicatorOverlay Component
 *
 * Renders an invisible button positioned over a canvas-rendered comment indicator
 * (the red triangle in the corner of a cell). On click, triggers the comment actor
 * to open the CommentPopover (already mounted in OverlayLayer).
 *
 * This is part of the Canvas Interactive Element Layer architecture:
 * 1. Canvas renders comment indicator triangles visually (fast, efficient)
 * 2. ISheetViewInteractiveElements capability emits element positions each frame
 * 3. This overlay provides a clickable DOM element that triggers the comment actor
 * 4. The CommentPopover (in OverlayLayer) renders when the actor enters viewing state
 *
 * @module @mog/spreadsheet/components/canvas-overlays
 */

import { memo, useCallback } from 'react';

import type { InteractiveElementInfo } from '@mog-sdk/sheet-view';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import { useCoordinator } from '../../hooks';
import { CommentEvents } from '../../systems/grid-editing/machines/comment-machine';

type CommentIndicatorElement = Extract<InteractiveElementInfo, { type: 'comment-indicator' }>;

interface CommentIndicatorOverlayProps {
  element: CommentIndicatorElement;
}

/**
 * Renders an invisible button over the comment indicator triangle.
 * On click, sends CLICK_CELL to the comment actor so the already-mounted
 * CommentPopover opens with the correct cell's comments.
 *
 * This is intentionally thin — no subscriptions, no polling. The metadata
 * from the canvas collector already has everything needed to build a
 * CommentTarget. The CommentPopover (mounted in OverlayLayer) handles
 * all state management.
 */
export const CommentIndicatorOverlay = memo(function CommentIndicatorOverlay({
  element,
}: CommentIndicatorOverlayProps) {
  const { metadata } = element;
  const { x, y, width, height } = element.bounds;
  const coordinator = useCoordinator();

  const handleClick = useCallback(() => {
    const commentActor = coordinator.grid.access.actors.comment;
    if (!commentActor) return;

    commentActor.send(
      CommentEvents.clickCell({
        cellId: toCellId(metadata.cellId),
        sheetId: metadata.sheetId as SheetId,
        row: metadata.row,
        col: metadata.col,
      }),
    );
  }, [coordinator, metadata.cellId, metadata.sheetId, metadata.row, metadata.col]);

  const handlePointerEnter = useCallback(() => {
    coordinator.grid.commentHover.handleIndicatorMouseEnter?.({
      sheetId: metadata.sheetId,
      row: metadata.row,
      col: metadata.col,
    });
  }, [coordinator, metadata.sheetId, metadata.row, metadata.col]);

  const handlePointerLeave = useCallback(() => {
    coordinator.grid.commentHover.handleIndicatorMouseLeave?.({
      sheetId: metadata.sheetId,
      row: metadata.row,
      col: metadata.col,
    });
  }, [coordinator, metadata.sheetId, metadata.row, metadata.col]);

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerEnter}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      onMouseMove={handlePointerEnter}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: width,
        height: height,
        // Invisible but clickable
        opacity: 0,
        cursor: 'pointer',
        // Enable pointer events on this element (parent has pointer-events-none)
        pointerEvents: 'auto',
        // Reset default button styles
        border: 'none',
        background: 'transparent',
        padding: 0,
        margin: 0,
      }}
      aria-label={`Comment on cell at row ${metadata.row + 1}, column ${metadata.col + 1}`}
      aria-haspopup="dialog"
      data-no-grid-pointer="true"
      className="focus:outline focus:outline-2 focus:outline-ss-primary focus:outline-offset-1"
    />
  );
});

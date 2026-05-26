/**
 * DragTerminator Interface
 *
 * The architectural keystone of the system decomposition.
 * Decouples pointer-up handling from machine state knowledge.
 *
 * Each system implements this interface internally — it checks its own
 * actor states and sends the correct events. The coordinator doesn't
 * know or care what machine states exist.
 *
 * @example
 * // In coordinator's handlePointerUp():
 * this.grid.dragTerminator.endDrag();
 * this.objects.dragTerminator.endDrag();
 * this.renderer.pageBreakDragTerminator.endDrag();
 * this.ink.dragTerminator.endDrag();
 * this.input.clearActivePointerId();
 */
export interface DragTerminator {
  /**
   * End the current drag operation (if any).
   * Called on pointer-up. Each system checks its own actor states
   * internally and sends the appropriate completion events.
   */
  endDrag(): void;

  /**
   * Cancel the current drag operation (if any).
   * Called on pointer-cancel or escape. Each system reverts its
   * own drag state without committing the operation.
   */
  cancelDrag(): void;
}

/**
 * No-op DragTerminator for systems that don't have active drag operations.
 * Avoids null checks in the coordinator's pointer-up dispatch.
 */
export const NOOP_DRAG_TERMINATOR: DragTerminator = {
  endDrag(): void {},
  cancelDrag(): void {},
};

/**
 * useKanbanDrag Hook
 *
 * Handles drag and drop functionality for Kanban cards.
 * Uses HTML5 Drag and Drop API for cross-browser compatibility.
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import { useCallback, useRef } from 'react';
import type { KanbanActor } from '../machines';
import { KanbanEvents } from '../machines';

/**
 * Data transferred during drag operations.
 */
interface DragData {
  cardId: RowId;
  sourceColumn: string;
}

const DRAG_DATA_TYPE = 'application/x-kanban-card';

/**
 * Hook to handle Kanban drag and drop.
 *
 * @param actor - Kanban state machine actor
 * @param onDrop - Callback when card is dropped (updates data)
 * @returns Drag handlers and state
 */
export function useKanbanDrag(
  actor: KanbanActor | null,
  onDrop: (cardId: RowId, targetColumn: string, targetIndex: number) => void,
) {
  const dragDataRef = useRef<DragData | null>(null);

  /**
   * Handle drag start on a card.
   */
  const handleDragStart = useCallback(
    (event: React.DragEvent, cardId: RowId, sourceColumn: string) => {
      if (!actor) return;

      // Set drag data
      const data: DragData = { cardId, sourceColumn };
      dragDataRef.current = data;

      // Set data for transfer (for external drop targets)
      event.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify(data));
      event.dataTransfer.effectAllowed = 'move';

      // Set drag image (optional - browser handles by default)
      // const dragImage = event.currentTarget.cloneNode(true) as HTMLElement;
      // document.body.appendChild(dragImage);
      // event.dataTransfer.setDragImage(dragImage, 0, 0);

      // Update state machine
      actor.send(KanbanEvents.dragStart(cardId));
    },
    [actor],
  );

  /**
   * Handle drag over a column (for drop zone indication).
   */
  const handleDragOver = useCallback(
    (event: React.DragEvent, column: string, index: number) => {
      if (!actor) return;

      // Allow drop
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      // Update state machine with drop position
      actor.send(KanbanEvents.dragOver(column, index));
    },
    [actor],
  );

  /**
   * Handle drag enter on a column.
   */
  const handleDragEnter = useCallback(
    (event: React.DragEvent, column: string) => {
      if (!actor) return;
      event.preventDefault();

      // Update state machine
      actor.send(KanbanEvents.dragOver(column, 0));
    },
    [actor],
  );

  /**
   * Handle drag leave from a column.
   */
  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Only handle if leaving the column entirely
    // (not entering a child element)
    const relatedTarget = event.relatedTarget as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;

    if (!currentTarget.contains(relatedTarget)) {
      // Left the column
    }
  }, []);

  /**
   * Handle drop on a column.
   */
  const handleDrop = useCallback(
    (event: React.DragEvent, targetColumn: string, targetIndex: number) => {
      if (!actor) return;

      event.preventDefault();

      // Get drag data
      const data = dragDataRef.current;
      if (!data) {
        // Try to get from dataTransfer (external drag)
        try {
          const transferData = event.dataTransfer.getData(DRAG_DATA_TYPE);
          if (transferData) {
            const parsed = JSON.parse(transferData) as DragData;
            onDrop(parsed.cardId, targetColumn, targetIndex);
          }
        } catch {
          // Invalid data
        }
        return;
      }

      // Call drop handler
      onDrop(data.cardId, targetColumn, targetIndex);

      // Update state machine
      actor.send(KanbanEvents.drop());

      // Clear drag data
      dragDataRef.current = null;
    },
    [actor, onDrop],
  );

  /**
   * Handle drag end (cleanup).
   */
  const handleDragEnd = useCallback(
    (_event: React.DragEvent) => {
      if (!actor) return;

      // Clear drag data
      dragDataRef.current = null;

      // Update state machine
      actor.send(KanbanEvents.dragEnd());
    },
    [actor],
  );

  /**
   * Handle keyboard-based drag cancellation.
   */
  const cancelDrag = useCallback(() => {
    if (!actor) return;

    dragDataRef.current = null;
    actor.send(KanbanEvents.cancelDrag());
  }, [actor]);

  return {
    handleDragStart,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    cancelDrag,
  };
}

/**
 * Hook for card-level drag props.
 * Simplified interface for individual cards.
 */
export function useCardDrag(
  actor: KanbanActor | null,
  cardId: RowId,
  sourceColumn: string,
  onDrop: (cardId: RowId, targetColumn: string, targetIndex: number) => void,
) {
  const { handleDragStart: baseDragStart, handleDragEnd: baseDragEnd } = useKanbanDrag(
    actor,
    onDrop,
  );

  const onDragStart = useCallback(
    (event: React.DragEvent) => {
      baseDragStart(event, cardId, sourceColumn);
    },
    [baseDragStart, cardId, sourceColumn],
  );

  const onDragEnd = useCallback(
    (event: React.DragEvent) => {
      baseDragEnd(event);
    },
    [baseDragEnd],
  );

  return {
    draggable: true,
    onDragStart,
    onDragEnd,
  };
}

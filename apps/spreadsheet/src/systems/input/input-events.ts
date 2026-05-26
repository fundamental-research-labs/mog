/**
 * Input Event Actions
 *
 * Functions for handling input events (pointer events, header clicks, etc.)
 *
 */

import type { ActorManager } from '../shared/actor-manager';
import type { SheetInputEvent } from './machines/input-types';

// =============================================================================
// TYPES
// =============================================================================

export interface InputEventDependencies {
  actors: ActorManager;
  getActiveSheetId: () => string;
  startEditing: (
    cell: { row: number; col: number },
    sheetId: string,
    initialValue?: string,
  ) => void;
}

// =============================================================================
// INPUT EVENT HANDLER
// =============================================================================

/**
 * Handle input events from the input coordinator.
 * Routes events to appropriate actors.
 */
export function handleInputEventAction(deps: InputEventDependencies, event: SheetInputEvent): void {
  const { actors, getActiveSheetId, startEditing } = deps;

  switch (event.type) {
    case 'CELL_POINTER_DOWN':
      actors.selection.send({
        type: 'MOUSE_DOWN',
        cell: { row: event.row, col: event.col },
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
      });
      break;
    case 'CELL_POINTER_MOVE': {
      const snap = actors.selection.getSnapshot();
      if (snap.matches('draggingFillHandle')) {
        actors.selection.send({
          type: 'FILL_HANDLE_DRAG',
          cell: { row: event.row, col: event.col },
        });
      } else if (snap.matches('rightDraggingFillHandle')) {
        actors.selection.send({
          type: 'RIGHT_FILL_HANDLE_DRAG',
          cell: { row: event.row, col: event.col },
        });
      } else {
        actors.selection.send({
          type: 'MOUSE_MOVE',
          cell: { row: event.row, col: event.col },
        });
      }
      break;
    }
    case 'CELL_POINTER_UP':
      actors.selection.send({ type: 'MOUSE_UP' });
      break;
    case 'CELL_DOUBLE_CLICK':
      startEditing({ row: event.row, col: event.col }, getActiveSheetId(), '');
      break;
    case 'FILL_HANDLE_START':
      actors.selection.send({ type: 'START_FILL_HANDLE_DRAG' });
      break;
    // Right-click fill handle shows context menu on release
    case 'RIGHT_FILL_HANDLE_START':
      actors.selection.send({ type: 'START_RIGHT_FILL_HANDLE_DRAG' });
      break;
    case 'HEADER_CLICK':
      if (event.col !== undefined) {
        actors.selection.send({
          type: 'SET_SELECTION',
          ranges: [{ startRow: 0, startCol: event.col, endRow: 999, endCol: event.col }],
          activeCell: { row: 0, col: event.col },
        });
      } else if (event.row !== undefined) {
        actors.selection.send({
          type: 'SET_SELECTION',
          ranges: [{ startRow: event.row, startCol: 0, endRow: event.row, endCol: 25 }],
          activeCell: { row: event.row, col: 0 },
        });
      }
      break;
  }
}

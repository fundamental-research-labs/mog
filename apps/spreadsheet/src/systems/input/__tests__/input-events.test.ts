/**
 * Input Event Routing Tests
 *
 * Tests that handleInputEventAction correctly routes CELL_POINTER_MOVE events
 * based on the selection machine's current state.
 *
 * Bug #14: Fill handle drag was broken because CELL_POINTER_MOVE always sent
 * MOUSE_MOVE, but the draggingFillHandle state only handles FILL_HANDLE_DRAG.
 */

import { handleInputEventAction, type InputEventDependencies } from '../input-events';

// =============================================================================
// HELPERS
// =============================================================================

function createMockDeps(stateValue: string = 'idle'): {
  deps: InputEventDependencies;
  sentEvents: Array<{ type: string; [key: string]: unknown }>;
} {
  const sentEvents: Array<{ type: string; [key: string]: unknown }> = [];

  const deps: InputEventDependencies = {
    actors: {
      selection: {
        getSnapshot: () => ({
          matches: (state: string) => state === stateValue,
        }),
        send: (event: { type: string; [key: string]: unknown }) => {
          sentEvents.push(event);
        },
      },
    } as unknown as InputEventDependencies['actors'],
    getActiveSheetId: () => 'sheet-1',
    startEditing: () => {},
  };

  return { deps, sentEvents };
}

// =============================================================================
// TESTS
// =============================================================================

describe('handleInputEventAction - CELL_POINTER_MOVE routing', () => {
  it('sends MOUSE_MOVE when selection machine is idle', () => {
    const { deps, sentEvents } = createMockDeps('idle');

    handleInputEventAction(deps, {
      type: 'CELL_POINTER_MOVE',
      row: 5,
      col: 3,
      event: {} as PointerEvent,
    });

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]).toEqual({
      type: 'MOUSE_MOVE',
      cell: { row: 5, col: 3 },
    });
  });

  it('sends FILL_HANDLE_DRAG when selection machine is in draggingFillHandle', () => {
    const { deps, sentEvents } = createMockDeps('draggingFillHandle');

    handleInputEventAction(deps, {
      type: 'CELL_POINTER_MOVE',
      row: 8,
      col: 1,
      event: {} as PointerEvent,
    });

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]).toEqual({
      type: 'FILL_HANDLE_DRAG',
      cell: { row: 8, col: 1 },
    });
  });

  it('sends RIGHT_FILL_HANDLE_DRAG when selection machine is in rightDraggingFillHandle', () => {
    const { deps, sentEvents } = createMockDeps('rightDraggingFillHandle');

    handleInputEventAction(deps, {
      type: 'CELL_POINTER_MOVE',
      row: 3,
      col: 7,
      event: {} as PointerEvent,
    });

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]).toEqual({
      type: 'RIGHT_FILL_HANDLE_DRAG',
      cell: { row: 3, col: 7 },
    });
  });

  it('sends MOUSE_MOVE when selection machine is in any other state (e.g. selecting)', () => {
    const { deps, sentEvents } = createMockDeps('selecting');

    handleInputEventAction(deps, {
      type: 'CELL_POINTER_MOVE',
      row: 2,
      col: 4,
      event: {} as PointerEvent,
    });

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]).toEqual({
      type: 'MOUSE_MOVE',
      cell: { row: 2, col: 4 },
    });
  });
});

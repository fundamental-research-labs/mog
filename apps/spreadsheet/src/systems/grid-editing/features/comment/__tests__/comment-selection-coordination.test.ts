/**
 * Comment-Selection Coordination Tests
 *
 * Verifies that the coordination module:
 * - Does NOT auto-open the comment popover when selecting a commented cell
 * - DOES auto-close the popover when navigating to a non-commented cell
 * - Respects editing/composing states (doesn't close during active editing)
 *
 * Bug #26: Left-click was opening comment form because the coordination module
 * sent CLICK_CELL on any cell selection. After the fix, only close behavior remains.
 */

import { setupCommentSelectionCoordination } from '../comment-selection-coordination';

// =============================================================================
// MOCK HELPERS
// =============================================================================

type SubscriptionCallback = (state: {
  matches: (value: string) => boolean;
  context: { activeCell: { row: number; col: number } };
}) => void;

/**
 * Create a mock selection actor that allows manual emission of state changes.
 */
function createMockSelectionActor() {
  const subscribers: SubscriptionCallback[] = [];

  return {
    subscribe: (callback: SubscriptionCallback) => {
      subscribers.push(callback);
      return {
        unsubscribe: () => {
          const idx = subscribers.indexOf(callback);
          if (idx >= 0) subscribers.splice(idx, 1);
        },
      };
    },
    /** Emit a state change to all subscribers */
    emit: (state: {
      matches: (value: string) => boolean;
      context: { activeCell: { row: number; col: number } };
    }) => {
      for (const sub of subscribers) {
        sub(state);
      }
    },
  };
}

/**
 * Create a mock comment actor that records sent events.
 */
function createMockCommentActor(currentState: string = 'closed') {
  const sentEvents: Array<{ type: string; [key: string]: unknown }> = [];

  return {
    send: (event: { type: string; [key: string]: unknown }) => {
      sentEvents.push(event);
    },
    getSnapshot: () => ({
      value: currentState,
      context: { target: null },
    }),
    sentEvents,
    /** Update the current state for subsequent getSnapshot calls */
    setState: (state: string) => {
      currentState = state;
    },
  };
}

/**
 * Create a mock worksheet with configurable hasComment behavior.
 */
function createMockWorksheet(hasComment: (row: number, col: number) => boolean) {
  return {
    viewport: {
      hasComment,
      getCellData: () => ({ cellId: 'cell-1' }),
    },
  } as any;
}

/**
 * Helper to create an idle state emission.
 */
function idleState(row: number, col: number) {
  return {
    matches: (value: string) => value === 'idle',
    context: { activeCell: { row, col } },
  };
}

/**
 * Helper to create a non-idle (e.g., selecting) state emission.
 */
function selectingState(row: number, col: number) {
  return {
    matches: (value: string) => value === 'selecting',
    context: { activeCell: { row, col } },
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Comment Selection Coordination', () => {
  describe('should NOT auto-open comment popover', () => {
    it('does not send CLICK_CELL when navigating to a commented cell', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('closed');
      const ws = createMockWorksheet(() => true); // all cells have comments

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      // Simulate selecting a commented cell
      selectionActor.emit(idleState(1, 1));

      // Should NOT have sent CLICK_CELL
      const clickCellEvents = commentActor.sentEvents.filter((e) => e.type === 'CLICK_CELL');
      expect(clickCellEvents).toHaveLength(0);
    });

    it('does not send any event when navigating between commented cells', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('closed');
      const ws = createMockWorksheet(() => true); // all cells have comments

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      selectionActor.emit(idleState(1, 1));
      selectionActor.emit(idleState(2, 2));
      selectionActor.emit(idleState(3, 3));

      // No events should have been sent at all
      expect(commentActor.sentEvents).toHaveLength(0);
    });
  });

  describe('should auto-close comment popover', () => {
    it('sends CLOSE when navigating to a non-commented cell while popover is viewing', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('viewing');
      const ws = createMockWorksheet(() => false); // no cells have comments

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      selectionActor.emit(idleState(2, 2));

      const closeEvents = commentActor.sentEvents.filter((e) => e.type === 'CLOSE');
      expect(closeEvents).toHaveLength(1);
    });

    it('does not send CLOSE when popover is already closed', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('closed');
      const ws = createMockWorksheet(() => false);

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      selectionActor.emit(idleState(2, 2));

      // Should not send CLOSE when already closed
      expect(commentActor.sentEvents).toHaveLength(0);
    });

    it('does not send CLOSE when user is editing a comment', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('editing');
      const ws = createMockWorksheet(() => false);

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      selectionActor.emit(idleState(2, 2));

      // Should not close while editing
      expect(commentActor.sentEvents).toHaveLength(0);
    });

    it('does not send CLOSE when user is composing a new comment', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('composing');
      const ws = createMockWorksheet(() => false);

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      selectionActor.emit(idleState(2, 2));

      // Should not close while composing
      expect(commentActor.sentEvents).toHaveLength(0);
    });
  });

  describe('state guards', () => {
    it('ignores non-idle states (e.g., during drag selection)', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('viewing');
      const ws = createMockWorksheet(() => false);

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      // Emit a selecting state — should be ignored
      selectionActor.emit(selectingState(2, 2));

      expect(commentActor.sentEvents).toHaveLength(0);
    });

    it('skips duplicate idle emissions for the same cell', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('viewing');
      const ws = createMockWorksheet(() => false);

      setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      selectionActor.emit(idleState(2, 2));
      selectionActor.emit(idleState(2, 2)); // duplicate

      // Only one CLOSE event, not two
      expect(commentActor.sentEvents).toHaveLength(1);
    });
  });

  describe('cleanup', () => {
    it('unsubscribes from selection actor on cleanup', () => {
      const selectionActor = createMockSelectionActor();
      const commentActor = createMockCommentActor('viewing');
      const ws = createMockWorksheet(() => false);

      const { cleanup } = setupCommentSelectionCoordination({
        selectionActor: selectionActor as any,
        commentActor: commentActor as any,
        ws,
      });

      cleanup();

      // After cleanup, emissions should not trigger events
      selectionActor.emit(idleState(2, 2));
      expect(commentActor.sentEvents).toHaveLength(0);
    });
  });
});

/**
 * Selection Context Coordination Tests (Cross-Machine Communication)
 *
 * Tests for the centralized selection exclusivity coordination.
 * Verifies that selecting one context (cells, objects) clears the other.
 *
 * ARCHITECTURE NOTE: Charts are now handled via objectInteractionActor (single owner principle).
 * The objectInteractionActor owns selection for ALL floating objects including charts.
 * Chart state sync happens separately via chart-coordination.
 *
 * Test Cases:
 * 1. Cell selection clears object selection (includes charts since charts are objects)
 * 2. Object selection clears cell selection
 * 3. Protected operations (fill drag, cell drag) are NOT interrupted
 * 4. Rapid context switching doesn't cause infinite loops
 * 5. Multi-step scenarios work correctly
 *
 */

import { createActor } from 'xstate';
import { selectionSelectors } from '../../../../selectors';
import { chartMachine } from '../../../objects/machines/chart-machine';
import { objectInteractionMachine } from '../../../objects/machines/object-interaction-machine';
import { selectionMachine } from '../../machines/grid-selection-machine';
import {
  setupSelectionContextCoordination,
  type SelectionContextCoordinationConfig,
} from '../selection-context-coordination';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create all three actors for testing selection context coordination.
 */
function createTestActors() {
  const selectionActor = createActor(selectionMachine);
  const objectInteractionActor = createActor(objectInteractionMachine);
  const chartActor = createActor(chartMachine);

  selectionActor.start();
  objectInteractionActor.start();
  chartActor.start();

  return { selectionActor, objectInteractionActor, chartActor };
}

/**
 * Set up coordination and return cleanup function.
 */
function setupCoordination(config: SelectionContextCoordinationConfig) {
  return setupSelectionContextCoordination(config);
}

/**
 * Wait for all actors to process events.
 * XState actors process events asynchronously on microtask queue.
 */
async function waitForProcessing(): Promise<void> {
  // Wait for microtask queue to flush
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// =============================================================================
// BASIC CONTEXT SWITCHING TESTS
// =============================================================================

describe('Selection Context Coordination', () => {
  describe('Cell selection clears other contexts', () => {
    it('clears object selection when cells are selected', async () => {
      const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
      const { cleanup } = setupCoordination({
        selectionActor,
        objectInteractionActor,
      });

      // Select an object first
      objectInteractionActor.send({
        type: 'SELECT_OBJECT',
        objectId: 'obj1',
        shiftKey: false,
        ctrlKey: false,
      });
      await waitForProcessing();
      expect(objectInteractionActor.getSnapshot().matches('selected')).toBe(true);

      // Now start cell selection (enters 'selecting' state)
      selectionActor.send({
        type: 'MOUSE_DOWN',
        cell: { row: 0, col: 0 },
        shiftKey: false,
        ctrlKey: false,
      });
      await waitForProcessing();

      // Object should be deselected
      expect(objectInteractionActor.getSnapshot().matches('idle')).toBe(true);
      expect(objectInteractionActor.getSnapshot().context.selectedIds).toEqual([]);

      cleanup();
      selectionActor.stop();
      objectInteractionActor.stop();
      chartActor.stop();
    });

    it('clears object selection when a user SET_SELECTION replaces the idle cell range', async () => {
      const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
      const { cleanup } = setupCoordination({
        selectionActor,
        objectInteractionActor,
      });

      objectInteractionActor.send({
        type: 'SELECT_OBJECT',
        objectId: 'obj1',
        shiftKey: false,
        ctrlKey: false,
      });
      await waitForProcessing();
      expect(objectInteractionActor.getSnapshot().matches('selected')).toBe(true);

      selectionActor.send({
        type: 'SET_SELECTION',
        ranges: [{ startRow: 2, startCol: 11, endRow: 20, endCol: 27 }],
        activeCell: { row: 2, col: 11 },
      });
      await waitForProcessing();

      expect(objectInteractionActor.getSnapshot().matches('idle')).toBe(true);
      expect(objectInteractionActor.getSnapshot().context.selectedIds).toEqual([]);

      cleanup();
      selectionActor.stop();
      objectInteractionActor.stop();
      chartActor.stop();
    });
  });

  describe('Object selection clears other contexts', () => {
    it('clears cell selection when object is selected', async () => {
      const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
      const { cleanup } = setupCoordination({
        selectionActor,
        objectInteractionActor,
      });

      // Cells start with default selection - verify initial state
      expect(selectionSelectors.ranges(selectionActor.getSnapshot())).toHaveLength(1);

      // Select an object
      objectInteractionActor.send({
        type: 'SELECT_OBJECT',
        objectId: 'obj1',
        shiftKey: false,
        ctrlKey: false,
      });
      await waitForProcessing();

      // Cell selection should be reset to A1 (default initial state)
      const selState = selectionActor.getSnapshot();
      expect(selState.context.activeCell).toEqual({ row: 0, col: 0 });
      expect(selectionSelectors.ranges(selState)[0]).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });

      cleanup();
      selectionActor.stop();
      objectInteractionActor.stop();
      chartActor.stop();
    });

    // Note: Test for "clears chart selection when object is selected" removed.
    // Charts are now selected via objectInteractionActor (single owner principle).
    // When a chart is selected, it goes through objectInteractionActor, not chartActor.
    // The chartActor is only used for chart-specific editing state, not selection.
  });
});

// =============================================================================
// PROTECTED OPERATION TESTS
// =============================================================================

describe('Protected Operations - NOT interrupted by external selection', () => {
  it('fill handle drag is NOT interrupted', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Start fill handle drag
    selectionActor.send({ type: 'START_FILL_HANDLE_DRAG' });
    await waitForProcessing();
    expect(selectionActor.getSnapshot().matches('draggingFillHandle')).toBe(true);

    // Try to select an object - should NOT interrupt fill drag
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // Fill drag should still be in progress
    expect(selectionActor.getSnapshot().matches('draggingFillHandle')).toBe(true);

    // Finish the drag
    selectionActor.send({ type: 'END_FILL_HANDLE_DRAG' });
    await waitForProcessing();
    expect(selectionActor.getSnapshot().matches('idle')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('cell drag (draggingCells) is NOT interrupted', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Start cell drag
    selectionActor.send({
      type: 'START_DRAG_CELLS',
      cell: { row: 0, col: 0 },
      ctrlKey: false,
    });
    await waitForProcessing();
    expect(selectionActor.getSnapshot().matches('draggingCells')).toBe(true);

    // Try to select a chart - should NOT interrupt cell drag
    chartActor.send({ type: 'SYNC_SELECTION', chartIds: ['chart1'] });
    await waitForProcessing();

    // Cell drag should still be in progress
    expect(selectionActor.getSnapshot().matches('draggingCells')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('formula range selection is NOT interrupted', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Enter formula range mode
    selectionActor.send({ type: 'ENTER_FORMULA_RANGE_MODE', color: '#ff0000' });
    await waitForProcessing();
    expect(selectionActor.getSnapshot().matches('selectingRangeForFormula')).toBe(true);

    // Try to select an object - should NOT interrupt formula range picking
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // Formula range mode should still be active
    expect(selectionActor.getSnapshot().matches('selectingRangeForFormula')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('object operating (drag) is NOT interrupted', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Select and start drag operation
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    objectInteractionActor.send({
      type: 'START_DRAG',
      objectIds: ['obj1'],
      position: { x: 100, y: 100 },
      originalStates: new Map([
        ['obj1', { bounds: { x: 50, y: 50, width: 100, height: 100, rotation: 0 }, rotation: 0 }],
      ]),
    });
    await waitForProcessing();
    expect(objectInteractionActor.getSnapshot().matches('operating')).toBe(true);

    // Try to start cell selection - should NOT interrupt object operation
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 0, col: 0 },
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // Object operation should still be in progress
    expect(objectInteractionActor.getSnapshot().matches('operating')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('object operating (resize) is NOT interrupted', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Select and start resize operation
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    objectInteractionActor.send({
      type: 'START_RESIZE',
      objectIds: ['obj1'],
      position: { x: 200, y: 200 },
      handle: 'se',
      originalStates: new Map([
        ['obj1', { bounds: { x: 50, y: 50, width: 100, height: 100, rotation: 0 }, rotation: 0 }],
      ]),
    });
    await waitForProcessing();
    expect(objectInteractionActor.getSnapshot().matches('operating')).toBe(true);

    // Try to select a chart - should NOT interrupt resize
    chartActor.send({ type: 'SYNC_SELECTION', chartIds: ['chart1'] });
    await waitForProcessing();

    // Resize should still be in progress
    expect(objectInteractionActor.getSnapshot().matches('operating')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('object operating (rotate) is NOT interrupted', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Select and start rotate operation
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    objectInteractionActor.send({
      type: 'START_ROTATE',
      objectIds: ['obj1'],
      position: { x: 150, y: 50 },
      rotationCenter: { x: 100, y: 100 },
      originalStates: new Map([
        ['obj1', { bounds: { x: 50, y: 50, width: 100, height: 100, rotation: 0 }, rotation: 0 }],
      ]),
    });
    await waitForProcessing();
    expect(objectInteractionActor.getSnapshot().matches('operating')).toBe(true);

    // Try to start cell selection - should NOT interrupt rotation
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 0, col: 0 },
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // Rotation should still be in progress
    expect(objectInteractionActor.getSnapshot().matches('operating')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });
});

// =============================================================================
// RAPID CONTEXT SWITCHING TESTS
// =============================================================================

describe('Rapid Context Switching - No Infinite Loops', () => {
  it('handles rapid cell→object→cell transitions', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Rapid transitions
    for (let i = 0; i < 10; i++) {
      selectionActor.send({
        type: 'MOUSE_DOWN',
        cell: { row: i, col: 0 },
        shiftKey: false,
        ctrlKey: false,
      });
      selectionActor.send({ type: 'MOUSE_UP' });
      await waitForProcessing();

      objectInteractionActor.send({
        type: 'SELECT_OBJECT',
        objectId: `obj${i}`,
        shiftKey: false,
        ctrlKey: false,
      });
      await waitForProcessing();
    }

    // Should end in a valid state (no infinite loops, no crashes)
    const objState = objectInteractionActor.getSnapshot();
    expect(objState.matches('selected')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('handles rapid context cycling: cell→chart→object→cell', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    for (let i = 0; i < 5; i++) {
      // Cell selection
      selectionActor.send({
        type: 'MOUSE_DOWN',
        cell: { row: i, col: i },
        shiftKey: false,
        ctrlKey: false,
      });
      selectionActor.send({ type: 'MOUSE_UP' });
      await waitForProcessing();

      // Chart selection
      chartActor.send({ type: 'SYNC_SELECTION', chartIds: [`chart${i}`] });
      await waitForProcessing();

      // Object selection
      objectInteractionActor.send({
        type: 'SELECT_OBJECT',
        objectId: `obj${i}`,
        shiftKey: false,
        ctrlKey: false,
      });
      await waitForProcessing();
    }

    // Should complete without hanging
    expect(objectInteractionActor.getSnapshot().matches('selected')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });
});

// =============================================================================
// MULTI-STEP SCENARIO TESTS
// =============================================================================

describe('Multi-Step Scenarios', () => {
  it('full workflow: cell→object(multi)→cell', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup, getActiveContext } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Step 1: Select cells
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 5, col: 5 },
      shiftKey: false,
      ctrlKey: false,
    });
    selectionActor.send({ type: 'MOUSE_UP' });
    await waitForProcessing();
    expect(getActiveContext()).toBe('cells');

    // Step 2: Select multiple objects (charts are now objects too)
    objectInteractionActor.send({ type: 'SELECT_MULTIPLE', objectIds: ['obj1', 'obj2', 'obj3'] });
    await waitForProcessing();
    expect(getActiveContext()).toBe('objects');
    expect(objectInteractionActor.getSnapshot().context.selectedIds).toEqual([
      'obj1',
      'obj2',
      'obj3',
    ]);

    // Step 3: Back to cells
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 10, col: 10 },
      shiftKey: false,
      ctrlKey: false,
    });
    selectionActor.send({ type: 'MOUSE_UP' });
    await waitForProcessing();
    expect(getActiveContext()).toBe('cells');
    expect(objectInteractionActor.getSnapshot().context.selectedIds).toEqual([]);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('text editing in object is cleared by cell selection', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Select object and start text editing
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'textbox1',
      shiftKey: false,
      ctrlKey: false,
    });
    objectInteractionActor.send({ type: 'DOUBLE_CLICK', objectId: 'textbox1' });
    await waitForProcessing();
    expect(objectInteractionActor.getSnapshot().matches('editingText')).toBe(true);

    // Click a cell - should exit text editing and deselect object
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 0, col: 0 },
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    expect(objectInteractionActor.getSnapshot().matches('idle')).toBe(true);
    expect(objectInteractionActor.getSnapshot().context.editingObjectId).toBeNull();

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });
});

// =============================================================================
// COLUMN/ROW HEADER SELECTION TESTS
// =============================================================================

describe('Header Selection Context Switching', () => {
  it('column selection clears object selection', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Select an object
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();
    expect(objectInteractionActor.getSnapshot().matches('selected')).toBe(true);

    // Select a column
    selectionActor.send({ type: 'SELECT_COLUMN', col: 5, shiftKey: false, ctrlKey: false });
    await waitForProcessing();

    // Object should be deselected
    expect(objectInteractionActor.getSnapshot().matches('idle')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });
});

// =============================================================================
// ACTIVE CONTEXT TRACKING TESTS
// =============================================================================

describe('Active Context Tracking (Debugging/Observability)', () => {
  it('tracks active context correctly through transitions', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup, getActiveContext } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Initially null (no active context detected)
    expect(getActiveContext()).toBeNull();

    // Cell selection
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 0, col: 0 },
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();
    expect(getActiveContext()).toBe('cells');

    // Object selection (charts are now selected via objectInteractionActor)
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();
    expect(getActiveContext()).toBe('objects');

    // Note: No separate 'chart' context anymore - charts use 'objects' context
    // via objectInteractionActor (single owner principle)

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });
});

// =============================================================================
// CLEANUP AND RESOURCE MANAGEMENT TESTS
// =============================================================================

describe('Cleanup and Resource Management', () => {
  it('cleanup function properly unsubscribes from all actors', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Clean up coordination
    cleanup();

    // After cleanup, context switching should NOT happen
    // Select an object
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();
    expect(objectInteractionActor.getSnapshot().matches('selected')).toBe(true);

    // Cell selection should NOT clear object (no coordination active)
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 0, col: 0 },
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // Object should STILL be selected (coordination was cleaned up)
    expect(objectInteractionActor.getSnapshot().matches('selected')).toBe(true);

    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('handles actor stop gracefully', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Stop actors while coordination is still active
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();

    // Cleanup should not throw
    expect(() => cleanup()).not.toThrow();
  });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('Edge Cases', () => {
  it('handles EXTERNAL_SELECTION_ACTIVE event with correct context field', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Select object
    objectInteractionActor.send({
      type: 'SELECT_OBJECT',
      objectId: 'obj1',
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // Select cells - the EXTERNAL_SELECTION_ACTIVE event sent to objects should have context: 'cells'
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 0, col: 0 },
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // Object should be deselected by event with context: 'cells'
    expect(objectInteractionActor.getSnapshot().matches('idle')).toBe(true);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });

  it('multi-selected objects are all cleared when cells are selected', async () => {
    const { selectionActor, objectInteractionActor, chartActor } = createTestActors();
    const { cleanup } = setupCoordination({
      selectionActor,
      objectInteractionActor,
    });

    // Multi-select objects
    objectInteractionActor.send({
      type: 'SELECT_MULTIPLE',
      objectIds: ['obj1', 'obj2', 'obj3', 'obj4'],
    });
    await waitForProcessing();
    expect(objectInteractionActor.getSnapshot().context.selectedIds).toHaveLength(4);

    // Select cells
    selectionActor.send({
      type: 'MOUSE_DOWN',
      cell: { row: 0, col: 0 },
      shiftKey: false,
      ctrlKey: false,
    });
    await waitForProcessing();

    // All objects should be deselected
    expect(objectInteractionActor.getSnapshot().context.selectedIds).toEqual([]);

    cleanup();
    selectionActor.stop();
    objectInteractionActor.stop();
    chartActor.stop();
  });
});

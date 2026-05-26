/**
 * Find-Replace Wiring Tests
 *
 * Verifies that the FindReplaceCoordinator is properly wired so that
 * search/replace operations complete instead of hanging permanently
 * in 'searching' or 'replacing' state.
 *
 * Bug #28: Cmd+F search hangs at "Searching..." because the coordinator
 * was never instantiated — only a stub { cleanup() {} } was wired.
 *
 * ARCHITECTURE: Find-replace coordination is wired at the SheetCoordinator
 * level (not inside GridEditingSystem) to avoid cross-system coupling with
 * RendererActor. These tests wire the coordination manually to validate
 * the same behavior.
 *
 * @see ../../features/find-replace/find-replace-coordination.ts
 * @see ../../machines/find-replace-machine.ts
 */

import { jest } from '@jest/globals';

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import { sheetId, type SheetId } from '@mog-sdk/contracts/core';

import { GridEditingSystem } from '../../grid-editing-system';
import { setupFindReplaceCoordination } from '../../features/find-replace/find-replace-coordination';

// =============================================================================
// Mock Workbook Factory
// =============================================================================

/**
 * Create a minimal mock Workbook that supports search operations.
 * Returns cell data for a single sheet with the given values.
 */
function createMockWorkbook(
  sheetId: SheetId,
  cells: Array<{ row: number; col: number; value: string; cellId: string }>,
): WorkbookInternal {
  const mockWorksheet = {
    getSheetId: () => sheetId,
    getUsedRange: async () =>
      cells.length > 0
        ? `A1:${String.fromCharCode(65 + Math.max(...cells.map((c) => c.col)))}${Math.max(...cells.map((c) => c.row)) + 1}`
        : null,
    getRangeWithIdentity: async () =>
      cells.map((c) => ({
        cellId: c.cellId,
        row: c.row,
        col: c.col,
        value: c.value,
        displayString: c.value,
        formulaText: null,
      })),
    setCell: jest.fn().mockResolvedValue(undefined),
    setCells: jest.fn().mockResolvedValue({ updatedCount: 0 }),
    getDisplayValue: jest.fn().mockImplementation(async () => ''),
    layout: {
      getHiddenRowsBitmap: jest.fn().mockResolvedValue(new Set<number>()),
      getHiddenColumnsBitmap: jest.fn().mockResolvedValue(new Set<number>()),
    },
    structure: {
      getMergedRegions: jest.fn().mockResolvedValue([]),
    },
    viewport: {
      getMerges: jest.fn().mockReturnValue([]),
      getCellData: jest.fn().mockReturnValue(null),
      hasComment: jest.fn().mockReturnValue(false),
    },
  };

  return {
    getSheetNames: async () => ['Sheet1'],
    getSheet: async () => mockWorksheet,
    getSheetById: () => mockWorksheet,
    on: () => () => {},
    undoGroup: async <T>(fn: (wb: WorkbookInternal) => Promise<T>) => {
      return fn({} as WorkbookInternal);
    },
  } as unknown as WorkbookInternal;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Wire find-replace coordination externally (as SheetCoordinator does).
 * Returns cleanup function.
 */
function wireFindReplace(
  system: GridEditingSystem,
  workbook: WorkbookInternal,
  initialSheetId: string,
): () => void {
  const result = setupFindReplaceCoordination({
    findReplaceActor: system.access.actors.findReplace,
    selectionActor: system.access.actors.selection,
    invalidateRenderer: jest.fn(),
    resolveCellPosition: async () => null,
    getActiveSheetId: () => sheetId(initialSheetId),
    workbook,
  });
  return result.cleanup;
}

/**
 * Wait for the find-replace machine to reach the target state.
 * Times out after maxWait ms to prevent test hangs.
 */
async function waitForState(
  system: GridEditingSystem,
  stateName: string,
  maxWait = 2000,
): Promise<void> {
  const actor = system.access.actors.findReplace;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const snap = actor.getSnapshot();
    if (snap.matches(stateName as any)) return;
    await new Promise((r) => setTimeout(r, 10));
  }

  const finalSnap = actor.getSnapshot();
  throw new Error(
    `Timed out waiting for state '${stateName}'. Current state value: ${JSON.stringify(finalSnap.value)}`,
  );
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Find-Replace Wiring (Bug #28)', () => {
  let system: GridEditingSystem;
  let cleanupFindReplace: (() => void) | null = null;

  afterEach(() => {
    cleanupFindReplace?.();
    cleanupFindReplace = null;
    system?.dispose();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Search completes instead of hanging
  // ---------------------------------------------------------------------------

  it('search transitions to hasResults instead of hanging in searching', async () => {
    const mockWorkbook = createMockWorkbook(sheetId('sheet-1'), [
      { row: 0, col: 0, value: 'hello', cellId: 'cell-1' },
      { row: 1, col: 0, value: 'world', cellId: 'cell-2' },
      { row: 2, col: 0, value: 'hello world', cellId: 'cell-3' },
    ]);

    system = new GridEditingSystem({
      initialSheetId: 'sheet-1',
      workbook: mockWorkbook,
    });
    system.start();

    // Wire find-replace externally (as SheetCoordinator does)
    cleanupFindReplace = wireFindReplace(system, mockWorkbook, 'sheet-1');

    const actor = system.access.actors.findReplace;

    // Open the dialog
    actor.send({ type: 'OPEN' });

    // Set query and trigger search (mimics FindReplaceDialog useEffect)
    actor.send({ type: 'SET_QUERY', query: 'hello' });
    actor.send({ type: 'SEARCH' });

    // The machine should now be in 'searching'
    expect(actor.getSnapshot().matches('searching' as any)).toBe(true);

    // Wait for coordinator to send SEARCH_COMPLETE (debounce + async execution)
    await waitForState(system, 'hasResults');

    // Verify results
    const snap = actor.getSnapshot();
    expect(snap.context.results.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Empty search completes immediately
  // ---------------------------------------------------------------------------

  it('empty search resolves to hasResults with 0 results', async () => {
    const mockWorkbook = createMockWorkbook(sheetId('sheet-1'), [
      { row: 0, col: 0, value: 'data', cellId: 'cell-1' },
    ]);

    system = new GridEditingSystem({
      initialSheetId: 'sheet-1',
      workbook: mockWorkbook,
    });
    system.start();

    cleanupFindReplace = wireFindReplace(system, mockWorkbook, 'sheet-1');

    const actor = system.access.actors.findReplace;

    actor.send({ type: 'OPEN' });
    actor.send({ type: 'SET_QUERY', query: 'nonexistent-string-xyz' });
    actor.send({ type: 'SEARCH' });

    await waitForState(system, 'hasResults');

    expect(actor.getSnapshot().context.results).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Search error transitions back to idle (not hanging)
  // ---------------------------------------------------------------------------

  it('search error transitions to idle instead of hanging in searching', async () => {
    // Create a workbook that throws on getSheetNames
    const failingWorkbook = {
      getSheetNames: async () => {
        throw new Error('IPC failure');
      },
      getSheet: () => ({}),
      getSheetById: () => ({
        layout: {
          getHiddenRowsBitmap: async () => new Set<number>(),
          getHiddenColumnsBitmap: async () => new Set<number>(),
        },
        structure: { getMergedRegions: async () => [] },
        viewport: { hasComment: () => false },
      }),
      on: () => () => {},
    } as unknown as WorkbookInternal;

    system = new GridEditingSystem({
      initialSheetId: 'sheet-1',
      workbook: failingWorkbook,
    });
    system.start();

    cleanupFindReplace = wireFindReplace(system, failingWorkbook, 'sheet-1');

    const actor = system.access.actors.findReplace;

    actor.send({ type: 'OPEN' });
    actor.send({ type: 'SET_QUERY', query: 'test' });
    actor.send({ type: 'SEARCH' });

    expect(actor.getSnapshot().matches('searching' as any)).toBe(true);

    // Coordinator should catch the error and send SEARCH_ERROR -> idle
    await waitForState(system, 'idle');

    // Should be back in idle, not stuck in searching
    expect(actor.getSnapshot().matches('idle' as any)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Without coordination wired, search hangs (documents the dep)
  // ---------------------------------------------------------------------------

  it('without coordination wired, search stays in searching', async () => {
    system = new GridEditingSystem({
      initialSheetId: 'sheet-1',
      // No workbook — coordinator not wired
    });
    system.start();

    const actor = system.access.actors.findReplace;

    actor.send({ type: 'OPEN' });
    actor.send({ type: 'SET_QUERY', query: 'test' });
    actor.send({ type: 'SEARCH' });

    // Without the coordinator, searching state has no exit
    expect(actor.getSnapshot().matches('searching' as any)).toBe(true);

    // Wait a bit to confirm it stays stuck
    await new Promise((r) => setTimeout(r, 300));
    expect(actor.getSnapshot().matches('searching' as any)).toBe(true);
  });
});

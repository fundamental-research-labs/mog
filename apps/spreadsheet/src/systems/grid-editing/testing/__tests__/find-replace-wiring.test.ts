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
  options: { hiddenRows?: number[]; hiddenCols?: number[] } = {},
): WorkbookInternal {
  const hiddenRows = new Set(options.hiddenRows ?? []);
  const hiddenCols = new Set(options.hiddenCols ?? []);
  const mockWorksheet = {
    getSheetId: () => sheetId,
    getUsedRange: async () =>
      cells.length > 0
        ? {
            startRow: Math.min(...cells.map((c) => c.row)),
            startCol: Math.min(...cells.map((c) => c.col)),
            endRow: Math.max(...cells.map((c) => c.row)),
            endCol: Math.max(...cells.map((c) => c.col)),
          }
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
    setCell: jest.fn().mockImplementation(async (row: number, col: number, value: string) => {
      const cell = cells.find((c) => c.row === row && c.col === col);
      if (cell) {
        cell.value = value;
      }
    }),
    setCells: jest.fn().mockResolvedValue({ updatedCount: 0 }),
    getDisplayValue: jest.fn().mockImplementation(async (row: number, col: number) => {
      return cells.find((c) => c.row === row && c.col === col)?.value ?? '';
    }),
    layout: {
      getHiddenRowsBitmap: jest.fn().mockResolvedValue(hiddenRows),
      getHiddenColumnsBitmap: jest.fn().mockResolvedValue(hiddenCols),
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

async function waitForFindReplace(
  system: GridEditingSystem,
  predicate: (snapshot: any) => boolean,
  maxWait = 2000,
): Promise<void> {
  const actor = system.access.actors.findReplace;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const snap = actor.getSnapshot();
    if (predicate(snap)) return;
    await new Promise((r) => setTimeout(r, 10));
  }

  const finalSnap = actor.getSnapshot();
  throw new Error(
    `Timed out waiting for find/replace condition. Current context: ${JSON.stringify(finalSnap.context)}`,
  );
}

function getActiveCell(system: GridEditingSystem): { row: number; col: number } {
  return system.access.actors.selection.getSnapshot().context.activeCell;
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
  // Test 4: Replace can target the first result before explicit navigation
  // ---------------------------------------------------------------------------

  it('single replace targets the first result when a replacement query has no selected match', async () => {
    const mockWorkbook = createMockWorkbook(sheetId('sheet-1'), [
      { row: 0, col: 0, value: 'Apple', cellId: 'cell-1' },
      { row: 1, col: 0, value: 'Banana', cellId: 'cell-2' },
    ]);

    system = new GridEditingSystem({
      initialSheetId: 'sheet-1',
      workbook: mockWorkbook,
    });
    system.start();

    cleanupFindReplace = wireFindReplace(system, mockWorkbook, 'sheet-1');

    const actor = system.access.actors.findReplace;

    actor.send({ type: 'OPEN', showReplace: true });
    actor.send({ type: 'SET_QUERY', query: 'Apple' });
    actor.send({ type: 'SEARCH' });
    await waitForFindReplace(
      system,
      (snap) => snap.matches('hasResults' as any) && snap.context.query === 'Apple',
    );

    actor.send({ type: 'SET_QUERY', query: 'Banana' });
    actor.send({ type: 'SEARCH' });
    await waitForFindReplace(
      system,
      (snap) =>
        snap.matches('hasResults' as any) &&
        snap.context.query === 'Banana' &&
        snap.context.results.length === 1 &&
        snap.context.currentIndex === -1,
    );

    actor.send({ type: 'SET_REPLACEMENT', replacement: 'Mango' });
    const worksheet = mockWorkbook.getSheetById(sheetId('sheet-1')) as any;
    actor.send({ type: 'REPLACE' });

    await waitForFindReplace(
      system,
      (snap) => worksheet.setCell.mock.calls.length > 0 && !snap.matches('replacing' as any),
    );

    expect(worksheet.setCell).toHaveBeenCalledWith(1, 0, 'Mango');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Hidden rows/columns are skipped by search navigation
  // ---------------------------------------------------------------------------

  it('skips hidden-column matches and keeps Enter on the first visible live-search result', async () => {
    const mockWorkbook = createMockWorkbook(
      sheetId('sheet-1'),
      [
        { row: 2, col: 15, value: '1Q', cellId: 'hidden-p3' },
        { row: 2, col: 19, value: '1Q', cellId: 'hidden-t3' },
        { row: 2, col: 23, value: '1Q', cellId: 'hidden-x3' },
        { row: 2, col: 27, value: '1Q', cellId: 'visible-ab3' },
        { row: 2, col: 31, value: '1Q', cellId: 'visible-af3' },
      ],
      { hiddenCols: [15, 19, 23] },
    );

    system = new GridEditingSystem({
      initialSheetId: 'sheet-1',
      workbook: mockWorkbook,
    });
    system.start();

    cleanupFindReplace = wireFindReplace(system, mockWorkbook, 'sheet-1');

    system.access.actors.selection.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 20, startCol: 15, endRow: 20, endCol: 15 }],
      activeCell: { row: 20, col: 15 },
    });

    const actor = system.access.actors.findReplace;

    actor.send({ type: 'OPEN' });
    actor.send({ type: 'SET_QUERY', query: '1Q' });
    actor.send({ type: 'SEARCH' });

    await waitForFindReplace(
      system,
      (snap) =>
        snap.matches('hasResults' as any) &&
        snap.context.results.length === 2 &&
        getActiveCell(system).row === 2 &&
        getActiveCell(system).col === 27,
    );

    expect(actor.getSnapshot().context.results.map((result) => result.cellId)).toEqual([
      'visible-ab3',
      'visible-af3',
    ]);
    expect(actor.getSnapshot().context.currentIndex).toBe(-1);

    actor.send({ type: 'FIND_NEXT' });

    await waitForFindReplace(
      system,
      (snap) =>
        snap.context.currentIndex === 0 &&
        getActiveCell(system).row === 2 &&
        getActiveCell(system).col === 27,
    );

    actor.send({ type: 'FIND_NEXT' });

    await waitForFindReplace(
      system,
      (snap) =>
        snap.context.currentIndex === 1 &&
        getActiveCell(system).row === 2 &&
        getActiveCell(system).col === 31,
    );
  });

  it('prefers exact whole-cell matches over substring header matches on a fresh find', async () => {
    const mockWorkbook = createMockWorkbook(sheetId('sheet-1'), [
      { row: 2, col: 9, value: 'FY11/25E', cellId: 'partial-j3' },
      { row: 2, col: 11, value: 'FY11/25', cellId: 'exact-l3' },
      { row: 2, col: 12, value: 'FY11/25', cellId: 'exact-m3' },
    ]);

    system = new GridEditingSystem({
      initialSheetId: 'sheet-1',
      workbook: mockWorkbook,
    });
    system.start();

    cleanupFindReplace = wireFindReplace(system, mockWorkbook, 'sheet-1');

    system.access.actors.selection.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 6, startCol: 12, endRow: 6, endCol: 12 }],
      activeCell: { row: 6, col: 12 },
    });

    const actor = system.access.actors.findReplace;

    actor.send({ type: 'OPEN' });
    actor.send({ type: 'SET_QUERY', query: 'FY11/25' });
    actor.send({ type: 'SEARCH' });

    await waitForFindReplace(
      system,
      (snap) =>
        snap.matches('hasResults' as any) &&
        snap.context.results.length === 3 &&
        getActiveCell(system).row === 2 &&
        getActiveCell(system).col === 11,
    );

    expect(actor.getSnapshot().context.results.map((result) => result.cellId)).toEqual([
      'exact-l3',
      'exact-m3',
      'partial-j3',
    ]);
    expect(actor.getSnapshot().context.currentIndex).toBe(-1);

    actor.send({ type: 'FIND_NEXT' });

    await waitForFindReplace(
      system,
      (snap) =>
        snap.context.currentIndex === 0 &&
        getActiveCell(system).row === 2 &&
        getActiveCell(system).col === 11,
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: Without coordination wired, search hangs (documents the dep)
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

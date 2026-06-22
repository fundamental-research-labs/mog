/**
 * Data-Edge Selection Extension Integration Tests
 *
 * Integration tests for the ACTUAL extendToDataEdge handlers to verify that
 * pressing Cmd+Shift+Left followed by Cmd+Shift+Up correctly creates a
 * rectangular selection (preserving both horizontal and vertical extensions).
 *
 * These tests mock ws.findDataEdge() which delegates to the Rust compute-core
 * bridge for the actual data-edge algorithm. The mock uses a local data map
 * to simulate the same algorithm behavior.
 *
 * @see ../data-edge.ts - The extendToDataEdge function
 */

import { jest } from '@jest/globals';

import { MAX_COLS, MAX_ROWS, sheetId } from '@mog-sdk/contracts/core';
import { findDataEdge, type CellValueGetter } from '../../../../infra/utils';
import {
  EXTEND_TO_EDGE_DOWN,
  EXTEND_TO_EDGE_LEFT,
  EXTEND_TO_EDGE_RIGHT,
  EXTEND_TO_EDGE_UP,
  MOVE_TO_EDGE_LEFT,
  MOVE_TO_EDGE_RIGHT,
} from '../data-edge';
import type { ActionDependencies, CellCoord, CellRange } from '../helpers';
import { createMockPlatform, createMockShellService } from '../../__tests__/test-helpers';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a sparse grid of test data.
 */
function createTestData(): Map<string, unknown> {
  return new Map<string, unknown>([
    // Column A data (rows 0-4)
    ['0,0', 'A1 data'],
    ['1,0', 'A2 data'],
    ['2,0', 'A3 data'],
    ['3,0', 'A4 data'],
    ['4,0', 'A5 data'],
    // Column B data (rows 0-4)
    ['0,1', 'B1 data'],
    ['1,1', 'B2 data'],
    ['2,1', 'B3 data'],
    ['3,1', 'B4 data'],
    ['4,1', 'B5 data'], // Starting cell
  ]);
}

/**
 * Create a mock findDataEdge that uses the sync TS algorithm with local test data.
 */
function createMockFindDataEdge(testData: Map<string, unknown>) {
  const getCellValue: CellValueGetter = (row, col) =>
    testData.get(`${row},${col}`) as ReturnType<CellValueGetter>;
  return async (row: number, col: number, direction: 'up' | 'down' | 'left' | 'right') => {
    return findDataEdge({ row, col }, direction, getCellValue, 1048575, 16383);
  };
}

function createMoveMockDeps(options: {
  activeCell: CellCoord;
  hiddenRows?: number[];
  hiddenCols?: number[];
  findDataEdge: (
    row: number,
    col: number,
    direction: 'up' | 'down' | 'left' | 'right',
  ) => Promise<CellCoord>;
}): {
  deps: ActionDependencies;
  goTo: jest.Mock;
  getActiveCell: () => CellCoord;
} {
  let activeCell = options.activeCell;
  const activeSheet = {
    findDataEdge: options.findDataEdge,
    layout: {
      getHiddenRowsBitmap: jest.fn(async () => new Set(options.hiddenRows ?? [])),
      getHiddenColumnsBitmap: jest.fn(async () => new Set(options.hiddenCols ?? [])),
    },
  };
  const goTo = jest.fn((cell: CellCoord) => {
    activeCell = cell;
  });

  const deps: ActionDependencies = {
    workbook: {
      activeSheet,
      getSheetById: jest.fn(() => activeSheet),
      setPendingUndoDescription: jest.fn(),
    } as any,
    uiStore: {} as any,
    coordinator: {} as any,
    getActiveSheetId: () => sheetId('sheet-1'),
    onUIAction: jest.fn(),
    accessors: {
      selection: {
        getActiveCell: () => activeCell,
        getRanges: () => [
          {
            startRow: activeCell.row,
            startCol: activeCell.col,
            endRow: activeCell.row,
            endCol: activeCell.col,
          },
        ],
        getAnchor: () => activeCell,
      },
    } as any,
    commands: {
      selection: {
        goTo,
        setSelection: jest.fn(),
      },
    } as any,
    platform: createMockPlatform(),
    shellService: createMockShellService(),
  };

  return { deps, goTo, getActiveCell: () => activeCell };
}

/**
 * Create mock ActionDependencies for testing.
 */
function createMockDeps(
  testData: Map<string, unknown>,
  activeCell: CellCoord,
  ranges: CellRange[],
  anchor: CellCoord | null,
): {
  deps: ActionDependencies;
  getCapturedSelection: () => {
    ranges: CellRange[];
    activeCell: CellCoord;
    anchor: CellCoord | null | undefined;
    anchorCol: number | null | undefined;
    anchorRow: number | null | undefined;
  } | null;
} {
  const captureBox: {
    value: {
      ranges: CellRange[];
      activeCell: CellCoord;
      anchor: CellCoord | null | undefined;
      anchorCol: number | null | undefined;
      anchorRow: number | null | undefined;
    } | null;
  } = {
    value: null,
  };

  const mockFindDataEdge = createMockFindDataEdge(testData);

  const mockAccessors = {
    selection: {
      getActiveCell: () => activeCell,
      getRanges: () => ranges,
      getAnchor: () => anchor,
    },
  };

  const mockCommands = {
    selection: {
      setSelection: (
        newRanges: CellRange[],
        newActiveCell: CellCoord,
        newAnchor?: CellCoord | null,
        newAnchorCol?: number | null,
        newAnchorRow?: number | null,
      ) => {
        captureBox.value = {
          ranges: newRanges,
          activeCell: newActiveCell,
          anchor: newAnchor,
          anchorCol: newAnchorCol,
          anchorRow: newAnchorRow,
        };
      },
      goTo: jest.fn(),
    },
  };

  const deps: ActionDependencies = {
    workbook: {
      activeSheet: { findDataEdge: mockFindDataEdge },
      setPendingUndoDescription: jest.fn(),
    } as any,
    uiStore: {} as any,
    coordinator: {} as any,
    getActiveSheetId: () => sheetId('sheet-1'),
    onUIAction: jest.fn(),
    accessors: mockAccessors as any,
    commands: mockCommands as any,
    // required deps.
    platform: createMockPlatform(),
    shellService: createMockShellService(),
  };

  return {
    deps,
    getCapturedSelection: () => captureBox.value,
  };
}

// =============================================================================
// ACTUAL BUG REPRODUCTION TESTS
// =============================================================================

describe('extendToDataEdge - Integration tests with ACTUAL handlers', () => {
  describe('moveToDataEdge', () => {
    it('delegates opposite commands to findDataEdge from the current active cell', async () => {
      const findEdge = jest.fn(
        async (_row: number, _col: number, direction: 'up' | 'down' | 'left' | 'right') =>
          direction === 'right' ? { row: 463, col: 9 } : { row: 463, col: 4 },
      );
      const { deps, goTo } = createMoveMockDeps({
        activeCell: { row: 463, col: 6 },
        findDataEdge: findEdge,
      });

      await MOVE_TO_EDGE_RIGHT(deps);
      await MOVE_TO_EDGE_LEFT(deps);

      expect(goTo).toHaveBeenNthCalledWith(1, { row: 463, col: 9 });
      expect(goTo).toHaveBeenNthCalledWith(2, { row: 463, col: 4 });
      expect(findEdge).toHaveBeenCalledTimes(2);
      expect(findEdge).toHaveBeenNthCalledWith(1, 463, 6, 'right');
      expect(findEdge).toHaveBeenNthCalledWith(2, 463, 9, 'left');
    });
  });

  describe('Cmd+Shift+Left then Cmd+Shift+Up creates rectangular selection', () => {
    const testData = createTestData();

    it('Step 1: Cmd+Shift+Left from B5 extends to A5:B5', async () => {
      const activeCell: CellCoord = { row: 4, col: 1 };
      const ranges: CellRange[] = [{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord | null = null;

      const { deps, getCapturedSelection } = createMockDeps(testData, activeCell, ranges, anchor);

      const result = await EXTEND_TO_EDGE_LEFT(deps);

      expect(result.handled).toBe(true);

      const capturedSelection = getCapturedSelection();
      expect(capturedSelection).not.toBeNull();
      expect(capturedSelection!.ranges).toHaveLength(1);

      const range = capturedSelection!.ranges[0];
      expect(range.startRow).toBe(4);
      expect(range.endRow).toBe(4);
      expect(range.startCol).toBe(0);
      expect(range.endCol).toBe(1);

      expect(capturedSelection!.activeCell).toEqual({ row: 4, col: 1 });
      expect(capturedSelection!.anchor).toEqual({ row: 4, col: 1 });
    });

    it('Step 2: Cmd+Shift+Up from A5:B5 creates A1:B5 (rectangular)', async () => {
      const activeCell: CellCoord = { row: 4, col: 1 };
      const ranges: CellRange[] = [{ startRow: 4, startCol: 0, endRow: 4, endCol: 1 }];
      const anchor: CellCoord = { row: 4, col: 1 };

      const { deps, getCapturedSelection } = createMockDeps(testData, activeCell, ranges, anchor);

      const result = await EXTEND_TO_EDGE_UP(deps);

      expect(result.handled).toBe(true);

      const capturedSelection = getCapturedSelection();
      expect(capturedSelection).not.toBeNull();
      expect(capturedSelection!.ranges).toHaveLength(1);

      const range = capturedSelection!.ranges[0];

      expect(range.startRow).toBe(0);
      expect(range.endRow).toBe(4);
      expect(range.startCol).toBe(0);
      expect(range.endCol).toBe(1);

      expect(capturedSelection!.activeCell).toEqual({ row: 4, col: 1 });
      expect(capturedSelection!.anchor).toEqual({ row: 4, col: 1 });
    });
  });

  describe('Cmd+Shift+Up then Cmd+Shift+Left creates rectangular selection', () => {
    const testData = createTestData();

    it('Step 1: Cmd+Shift+Up from B5 extends to B1:B5', async () => {
      const activeCell: CellCoord = { row: 4, col: 1 };
      const ranges: CellRange[] = [{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord | null = null;

      const { deps, getCapturedSelection } = createMockDeps(testData, activeCell, ranges, anchor);

      const result = await EXTEND_TO_EDGE_UP(deps);

      expect(result.handled).toBe(true);
      const capturedSelection = getCapturedSelection();
      expect(capturedSelection).not.toBeNull();
      expect(capturedSelection!.ranges).toHaveLength(1);

      const range = capturedSelection!.ranges[0];
      expect(range.startRow).toBe(0);
      expect(range.endRow).toBe(4);
      expect(range.startCol).toBe(1);
      expect(range.endCol).toBe(1);
      expect(capturedSelection!.activeCell).toEqual({ row: 4, col: 1 });
      expect(capturedSelection!.anchor).toEqual({ row: 4, col: 1 });
    });

    it('Step 2: Cmd+Shift+Left from B1:B5 creates A1:B5 (rectangular)', async () => {
      const activeCell: CellCoord = { row: 4, col: 1 };
      const ranges: CellRange[] = [{ startRow: 0, startCol: 1, endRow: 4, endCol: 1 }];
      const anchor: CellCoord = { row: 4, col: 1 };

      const { deps, getCapturedSelection } = createMockDeps(testData, activeCell, ranges, anchor);

      const result = await EXTEND_TO_EDGE_LEFT(deps);

      expect(result.handled).toBe(true);
      const capturedSelection = getCapturedSelection();
      expect(capturedSelection).not.toBeNull();
      expect(capturedSelection!.ranges).toHaveLength(1);

      const range = capturedSelection!.ranges[0];

      expect(range.startCol).toBe(0);
      expect(range.endCol).toBe(1);
      expect(range.startRow).toBe(0);
      expect(range.endRow).toBe(4);
      expect(capturedSelection!.activeCell).toEqual({ row: 4, col: 1 });
      expect(capturedSelection!.anchor).toEqual({ row: 4, col: 1 });
    });
  });

  describe('OTHER DIRECTIONS: Same bug pattern', () => {
    const testData = createTestData();

    it('Cmd+Shift+Right then Cmd+Shift+Down works correctly', async () => {
      const activeCell: CellCoord = { row: 0, col: 0 };
      let ranges: CellRange[] = [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }];
      let anchor: CellCoord | null = null;

      const { deps: deps1, getCapturedSelection: getCaptured1 } = createMockDeps(
        testData,
        activeCell,
        ranges,
        anchor,
      );
      await EXTEND_TO_EDGE_RIGHT(deps1);

      const captured1 = getCaptured1();
      expect(captured1).not.toBeNull();
      const rangeAfterRight = captured1!.ranges[0];
      expect(rangeAfterRight.startCol).toBe(0);
      expect(rangeAfterRight.endCol).toBe(1);
      expect(captured1!.activeCell).toEqual(activeCell);
      expect(captured1!.anchor).toEqual(activeCell);

      ranges = [rangeAfterRight];
      anchor = activeCell;

      const { deps: deps2, getCapturedSelection: getCaptured2 } = createMockDeps(
        testData,
        activeCell,
        ranges,
        anchor,
      );
      await EXTEND_TO_EDGE_DOWN(deps2);

      const captured2 = getCaptured2();
      expect(captured2).not.toBeNull();
      const finalRange = captured2!.ranges[0];

      expect(finalRange.startRow).toBe(0);
      expect(finalRange.endRow).toBe(4);
      expect(finalRange.startCol).toBe(0);
      expect(finalRange.endCol).toBe(1);
      expect(captured2!.activeCell).toEqual(activeCell);
      expect(captured2!.anchor).toEqual(activeCell);
    });
  });

  describe('full-row and full-column header selections', () => {
    const vendorMonthData = new Map<string, unknown>([
      ['0,0', 'Vendor'],
      ['0,1', 'Jan'],
      ['0,2', 'Feb'],
      ['0,3', 'Mar'],
      ['1,0', 'Northwind'],
      ['2,0', 'Contoso'],
      ['3,0', 'Fabrikam'],
      ['4,0', 'Adventure'],
      ['5,0', 'Tailspin'],
      ['6,0', 'Wingtip'],
      ['7,0', 'Litware'],
    ]);

    it('Cmd+Shift+Right from selected column A selects full columns A:D', async () => {
      const activeCell: CellCoord = { row: 0, col: 0 };
      const ranges: CellRange[] = [
        {
          startRow: 0,
          startCol: 0,
          endRow: MAX_ROWS - 1,
          endCol: 0,
          isFullColumn: true,
        },
      ];

      const { deps, getCapturedSelection } = createMockDeps(
        vendorMonthData,
        activeCell,
        ranges,
        null,
      );

      const result = await EXTEND_TO_EDGE_RIGHT(deps);

      expect(result.handled).toBe(true);
      expect(getCapturedSelection()).toEqual({
        ranges: [
          {
            startRow: 0,
            startCol: 0,
            endRow: MAX_ROWS - 1,
            endCol: 3,
            isFullColumn: true,
          },
        ],
        activeCell,
        anchor: activeCell,
        anchorCol: 0,
        anchorRow: null,
      });
    });

    it('Cmd+Shift+Left from selected column D selects full columns A:D', async () => {
      const activeCell: CellCoord = { row: 0, col: 3 };
      const ranges: CellRange[] = [
        {
          startRow: 0,
          startCol: 3,
          endRow: MAX_ROWS - 1,
          endCol: 3,
          isFullColumn: true,
        },
      ];

      const { deps, getCapturedSelection } = createMockDeps(
        vendorMonthData,
        activeCell,
        ranges,
        null,
      );

      const result = await EXTEND_TO_EDGE_LEFT(deps);

      expect(result.handled).toBe(true);
      expect(getCapturedSelection()).toEqual({
        ranges: [
          {
            startRow: 0,
            startCol: 0,
            endRow: MAX_ROWS - 1,
            endCol: 3,
            isFullColumn: true,
          },
        ],
        activeCell,
        anchor: activeCell,
        anchorCol: 3,
        anchorRow: null,
      });
    });

    it('Cmd+Shift+Down from selected row 1 selects full rows 1:8', async () => {
      const activeCell: CellCoord = { row: 0, col: 0 };
      const ranges: CellRange[] = [
        {
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: MAX_COLS - 1,
          isFullRow: true,
        },
      ];

      const { deps, getCapturedSelection } = createMockDeps(
        vendorMonthData,
        activeCell,
        ranges,
        null,
      );

      const result = await EXTEND_TO_EDGE_DOWN(deps);

      expect(result.handled).toBe(true);
      expect(getCapturedSelection()).toEqual({
        ranges: [
          {
            startRow: 0,
            startCol: 0,
            endRow: 7,
            endCol: MAX_COLS - 1,
            isFullRow: true,
          },
        ],
        activeCell,
        anchor: activeCell,
        anchorCol: null,
        anchorRow: 0,
      });
    });
  });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('extendToDataEdge - Edge cases', () => {
  it('Single cell with no surrounding data extends to grid edge', async () => {
    const testData = new Map<string, unknown>([['4,1', 'B5 data']]);

    const activeCell: CellCoord = { row: 4, col: 1 };
    const ranges: CellRange[] = [{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }];
    const anchor: CellCoord | null = null;

    const { deps, getCapturedSelection } = createMockDeps(testData, activeCell, ranges, anchor);

    await EXTEND_TO_EDGE_UP(deps);

    const capturedSelection = getCapturedSelection();
    expect(capturedSelection).not.toBeNull();
    const range = capturedSelection!.ranges[0];

    expect(range.startRow).toBe(0);
    expect(range.endRow).toBe(4);
  });

  it('Extending into empty region stops at empty boundary', async () => {
    const testData = new Map<string, unknown>([
      ['0,1', 'B1 data'],
      ['1,1', 'B2 data'],
      // Gap at row 2
      ['3,1', 'B4 data'],
      ['4,1', 'B5 data'],
    ]);

    const activeCell: CellCoord = { row: 4, col: 1 };
    const ranges: CellRange[] = [{ startRow: 4, startCol: 1, endRow: 4, endCol: 1 }];
    const anchor: CellCoord | null = null;

    const { deps, getCapturedSelection } = createMockDeps(testData, activeCell, ranges, anchor);

    await EXTEND_TO_EDGE_UP(deps);

    const capturedSelection = getCapturedSelection();
    expect(capturedSelection).not.toBeNull();
    const range = capturedSelection!.ranges[0];

    expect(range.startRow).toBe(3); // B4
    expect(range.endRow).toBe(4); // B5
  });
});

/**
 * Tests for OPEN_DELETE_CELLS_DIALOG and OPEN_INSERT_CELLS_DIALOG action handlers.
 *
 * Verifies that:
 * - Opens the delete/insert cells dialog with the first selection range
 * - Returns notHandled when no ranges are selected
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { OPEN_DELETE_CELLS_DIALOG, OPEN_INSERT_CELLS_DIALOG } from '../dialog-handlers';

function createMockDeps(overrides?: {
  ranges?: Array<{ startRow: number; endRow: number; startCol: number; endCol: number }>;
}): ActionDependencies {
  const openDeleteCellsDialog = jest.fn();
  const openInsertCellsDialog = jest.fn();

  const ranges = overrides?.ranges ?? [];

  const deps = {
    accessors: {
      selection: {
        getActiveCell: () => ({ row: 0, col: 0 }),
        getRanges: () => ranges,
      },
    },
    uiStore: {
      getState: () => ({
        openDeleteCellsDialog,
        openInsertCellsDialog,
      }),
    },
  } as unknown as ActionDependencies;

  return deps;
}

function getUIStoreMocks(deps: ActionDependencies) {
  const state = (deps as any).uiStore.getState();
  return {
    openDeleteCellsDialog: state.openDeleteCellsDialog as jest.Mock,
    openInsertCellsDialog: state.openInsertCellsDialog as jest.Mock,
  };
}

describe('OPEN_DELETE_CELLS_DIALOG', () => {
  it('should open delete cells dialog with the first selection range', async () => {
    const range = { startRow: 0, endRow: 2, startCol: 0, endCol: 1 };
    const deps = createMockDeps({ ranges: [range] });
    const mocks = getUIStoreMocks(deps);

    const result = await OPEN_DELETE_CELLS_DIALOG(deps);

    expect(result.handled).toBe(true);
    expect(mocks.openDeleteCellsDialog).toHaveBeenCalledWith(range);
  });

  it('should return notHandled when no ranges are selected', async () => {
    const deps = createMockDeps({ ranges: [] });
    const mocks = getUIStoreMocks(deps);

    const result = await OPEN_DELETE_CELLS_DIALOG(deps);

    expect(result.handled).toBe(false);
    expect(mocks.openDeleteCellsDialog).not.toHaveBeenCalled();
  });
});

describe('OPEN_INSERT_CELLS_DIALOG', () => {
  it('should open insert cells dialog with the first selection range', async () => {
    const range = { startRow: 1, endRow: 3, startCol: 0, endCol: 0 };
    const deps = createMockDeps({ ranges: [range] });
    const mocks = getUIStoreMocks(deps);

    const result = await OPEN_INSERT_CELLS_DIALOG(deps);

    expect(result.handled).toBe(true);
    expect(mocks.openInsertCellsDialog).toHaveBeenCalledWith(range);
  });

  it('should return notHandled when no ranges are selected', async () => {
    const deps = createMockDeps({ ranges: [] });
    const mocks = getUIStoreMocks(deps);

    const result = await OPEN_INSERT_CELLS_DIALOG(deps);

    expect(result.handled).toBe(false);
    expect(mocks.openInsertCellsDialog).not.toHaveBeenCalled();
  });
});

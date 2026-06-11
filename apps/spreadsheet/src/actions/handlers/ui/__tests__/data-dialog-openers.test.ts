import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellCoord, CellRange } from '@mog-sdk/contracts/core';
import {
  OPEN_CUSTOM_SORT_DIALOG,
  OPEN_REMOVE_DUPLICATES_DIALOG,
  OPEN_SUBTOTAL_DIALOG,
  OPEN_TEXT_TO_COLUMNS_DIALOG,
} from '../dialog-handlers';

function makeDeps(opts: {
  selectionRange: CellRange;
  activeCell?: CellCoord;
  currentRegion?: CellRange;
  values?: Record<string, unknown>;
  filterSummaries?: Array<{
    id: string;
    filterKind: 'autoFilter';
    range: CellRange;
    tableId?: string;
    activeColumnCount: number;
    hasActiveCriteria: boolean;
  }>;
}) {
  const activeCell = opts.activeCell ?? {
    row: opts.selectionRange.startRow,
    col: opts.selectionRange.startCol,
  };
  const getCurrentRegion = jest
    .fn()
    .mockResolvedValue((opts.currentRegion ?? opts.selectionRange) as never);
  const getCell = jest.fn((row: number, col: number) =>
    Promise.resolve({ value: opts.values?.[`${row},${col}`] ?? null }),
  );
  const listSummaries = jest.fn().mockResolvedValue((opts.filterSummaries ?? []) as never);
  const openSortDialog = jest.fn();
  const openRemoveDuplicatesDialog = jest.fn();
  const openSubtotalDialog = jest.fn();
  const openTextToColumnsDialog = jest.fn();

  const deps = {
    workbook: {
      getSheetById: jest.fn().mockReturnValue({
        getCurrentRegion,
        getCell,
        filters: { listSummaries },
      }),
    },
    uiStore: {
      getState: () => ({
        openSortDialog,
        openRemoveDuplicatesDialog,
        openSubtotalDialog,
        openTextToColumnsDialog,
      }),
    },
    accessors: {
      selection: {
        getActiveCell: () => activeCell,
        getRanges: () => [opts.selectionRange],
      },
    },
    getActiveSheetId: () => 'sheet1' as any,
  } as unknown as ActionDependencies;

  return {
    deps,
    getCurrentRegion,
    listSummaries,
    openSortDialog,
    openRemoveDuplicatesDialog,
    openSubtotalDialog,
    openTextToColumnsDialog,
  };
}

describe('data dialog openers capture resolved command targets', () => {
  test('custom sort stores range, headers, and active relative column', async () => {
    const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 2 };
    const setup = makeDeps({
      selectionRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
      activeCell: { row: 4, col: 1 },
      currentRegion: range,
      values: {
        '0,0': 'Name',
        '0,1': 'Score',
        '0,2': 'Team',
        '1,0': 'Ada',
        '1,1': 10,
      },
    });

    await OPEN_CUSTOM_SORT_DIALOG(setup.deps);

    expect(setup.openSortDialog).toHaveBeenCalledWith(
      range,
      true,
      {
        type: 'custom',
        criterion: { sortBy: 'value', columnIndex: 1, direction: 'asc' },
      },
      false,
    );
  });

  test('custom sort opened inside an active AutoFilter stores visible-row sorting', async () => {
    const filterRange = { startRow: 2, startCol: 11, endRow: 20, endCol: 27 };
    const setup = makeDeps({
      selectionRange: filterRange,
      activeCell: { row: 2, col: 11 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 99, endCol: 30 },
      filterSummaries: [
        {
          id: 'filter-1',
          filterKind: 'autoFilter',
          range: filterRange,
          activeColumnCount: 1,
          hasActiveCriteria: true,
        },
      ],
    });

    await OPEN_CUSTOM_SORT_DIALOG(setup.deps);

    expect(setup.listSummaries).toHaveBeenCalledWith({ scope: 'available' });
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.openSortDialog).toHaveBeenCalledWith(
      filterRange,
      true,
      {
        type: 'custom',
        criterion: { sortBy: 'value', columnIndex: 0, direction: 'asc' },
      },
      true,
    );
  });

  test('remove duplicates stores the captured range and header hint', async () => {
    const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 1 };
    const setup = makeDeps({
      selectionRange: { startRow: 3, startCol: 0, endRow: 3, endCol: 0 },
      currentRegion: range,
      values: {
        '0,0': 'Name',
        '0,1': 'Score',
        '1,0': 'Ada',
        '1,1': 10,
      },
    });

    await OPEN_REMOVE_DUPLICATES_DIALOG(setup.deps);

    expect(setup.openRemoveDuplicatesDialog).toHaveBeenCalledWith({
      range,
      hasHeaders: true,
    });
  });

  test('subtotal stores the captured range and header hint', async () => {
    const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 1 };
    const setup = makeDeps({
      selectionRange: { startRow: 3, startCol: 0, endRow: 3, endCol: 0 },
      currentRegion: range,
      values: {
        '0,0': 'Region',
        '0,1': 'Sales',
        '1,0': 'West',
        '1,1': 10,
      },
    });

    await OPEN_SUBTOTAL_DIALOG(setup.deps);

    expect(setup.openSubtotalDialog).toHaveBeenCalledWith({
      range,
      hasHeaders: true,
    });
  });

  test('custom sort opens on an empty selected cell using the raw selection', async () => {
    const single = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const setup = makeDeps({
      selectionRange: single,
      currentRegion: single,
    });

    await expect(OPEN_CUSTOM_SORT_DIALOG(setup.deps)).resolves.toMatchObject({ handled: true });

    expect(setup.openSortDialog).toHaveBeenCalledWith(
      single,
      false,
      {
        type: 'custom',
        criterion: { sortBy: 'value', columnIndex: 0, direction: 'asc' },
      },
      false,
    );
  });

  test('subtotal opens on an empty selected cell using the raw selection', async () => {
    const single = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const setup = makeDeps({
      selectionRange: single,
      currentRegion: single,
    });

    await expect(OPEN_SUBTOTAL_DIALOG(setup.deps)).resolves.toMatchObject({ handled: true });

    expect(setup.openSubtotalDialog).toHaveBeenCalledWith({
      range: single,
      hasHeaders: false,
    });
  });

  test('remove duplicates opens on an empty selected cell using the raw selection', async () => {
    const single = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const setup = makeDeps({
      selectionRange: single,
      currentRegion: single,
    });

    await expect(OPEN_REMOVE_DUPLICATES_DIALOG(setup.deps)).resolves.toMatchObject({
      handled: true,
    });

    expect(setup.openRemoveDuplicatesDialog).toHaveBeenCalledWith({
      range: single,
      hasHeaders: false,
    });
  });

  test('text to columns opens on an empty selected cell using the raw selection', async () => {
    const single = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const setup = makeDeps({
      selectionRange: single,
      currentRegion: single,
    });

    await expect(OPEN_TEXT_TO_COLUMNS_DIALOG(setup.deps)).resolves.toMatchObject({
      handled: true,
    });

    expect(setup.openTextToColumnsDialog).toHaveBeenCalledWith({ range: single });
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('text to columns stores only the captured range', async () => {
    const selection = { startRow: 3, startCol: 0, endRow: 3, endCol: 0 };
    const currentRegion = { startRow: 0, startCol: 0, endRow: 9, endCol: 1 };
    const setup = makeDeps({
      selectionRange: selection,
      currentRegion,
    });

    await OPEN_TEXT_TO_COLUMNS_DIALOG(setup.deps);

    expect(setup.openTextToColumnsDialog).toHaveBeenCalledWith({ range: selection });
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
  });
});

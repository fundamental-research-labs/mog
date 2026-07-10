import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { KernelError, translateNativeSlicerError } from '../../errors';
import { WorksheetSlicersImpl } from '../worksheet/slicers';

jest.mock('../../domain/sorting/filters', () => ({
  getTableFilter: jest.fn().mockResolvedValue(null),
  createFilter: jest.fn().mockResolvedValue({ id: 'filter-1' }),
  applyFilter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bridges/compute/compute-core', () => ({
  extractMutationData: jest.fn((result: any) => result?.data),
}));

const SHEET_ID = sheetId('sheet-1');
const OTHER_SHEET_ID = sheetId('sheet-2');

function storedSlicer(id: string, owner = SHEET_ID) {
  return {
    id,
    sheetId: String(owner),
    caption: 'Region',
    name: 'RegionSlicer',
    source: { type: 'table' as const, tableId: 'table-1', columnCellId: 'column-1' },
    style: null,
    position: null,
    zIndex: 0,
    locked: false,
    showHeader: true,
    multiSelect: true,
    selectedValues: [],
  };
}

function createBridge(state: ReturnType<typeof storedSlicer> | null = null) {
  return {
    getSlicerState: jest.fn().mockResolvedValue(state),
    getAllSlicers: jest.fn().mockResolvedValue(state ? [state] : []),
    getAllSlicersWorkbook: jest.fn().mockResolvedValue(state ? [state] : []),
    getAllTablesInSheet: jest.fn().mockResolvedValue([]),
    getAllTablesWorkbook: jest.fn().mockResolvedValue([]),
    getTableByName: jest.fn().mockResolvedValue(null),
    getCellsInRangeYrs: jest.fn().mockResolvedValue([]),
    getCellPosition: jest.fn().mockResolvedValue(null),
    pivotGet: jest.fn().mockResolvedValue(null),
    pivotGetAllItems: jest.fn().mockResolvedValue([]),
    getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
    getFiltersInSheet: jest.fn().mockResolvedValue([]),
    deleteSlicer: jest.fn(),
    updateSlicerConfig: jest.fn(),
    setSlicerSelection: jest.fn(),
    createSlicer: jest.fn(),
  };
}

function createSlicers(bridge: ReturnType<typeof createBridge>) {
  return new WorksheetSlicersImpl(
    {
      computeBridge: bridge,
      eventBus: { emit: jest.fn() },
      writeGate: { assertWritable: jest.fn() },
    } as any,
    SHEET_ID,
  );
}

describe('WorksheetSlicersImpl target contract', () => {
  it.each([
    ['missing', null],
    ['name-as-id', null],
    ['wrong-sheet', storedSlicer('wrong-sheet', OTHER_SHEET_ID)],
  ])('preserves tolerant and strict query semantics for %s targets', async (id, state) => {
    const slicers = createSlicers(createBridge(state));

    await expect(slicers.get(id)).resolves.toBeNull();
    await expect(slicers.has(id)).resolves.toBe(false);
    await expect(slicers.getItems(id)).resolves.toEqual([]);
    await expect(slicers.getItemOrNullObject(id, 'East')).resolves.toBeNull();
    await expect(slicers.getByName('RegionSlicer')).resolves.toBeNull();
    for (const action of [() => slicers.getItem(id, 'East'), () => slicers.getState(id)]) {
      await expect(action()).rejects.toMatchObject<Partial<KernelError>>({
        code: 'SLICER_NOT_FOUND',
      });
    }
  });

  it('distinguishes an absent slicer from an absent item on an existing slicer', async () => {
    const slicers = createSlicers(createBridge(storedSlicer('existing')));

    await expect(slicers.getItemOrNullObject('existing', 'missing-item')).resolves.toBeNull();
    await expect(slicers.getItem('existing', 'missing-item')).rejects.toMatchObject<
      Partial<KernelError>
    >({ code: 'COMPUTE_ERROR' });
  });

  it('rejects every singular mutation before any bridge write for a missing target', async () => {
    const bridge = createBridge(null);
    const slicers = createSlicers(bridge);

    for (const action of [
      () => slicers.remove('missing'),
      () => slicers.update('missing', { caption: 'Missing' }),
      () => slicers.setSelection('missing', ['East']),
      () => slicers.clearSelection('missing'),
      () => slicers.duplicate('missing'),
    ]) {
      await expect(action()).rejects.toMatchObject<Partial<KernelError>>({
        code: 'SLICER_NOT_FOUND',
      });
    }

    expect(bridge.deleteSlicer).not.toHaveBeenCalled();
    expect(bridge.updateSlicerConfig).not.toHaveBeenCalled();
    expect(bridge.setSlicerSelection).not.toHaveBeenCalled();
    expect(bridge.createSlicer).not.toHaveBeenCalled();
  });

  it.each([
    ['SlicerNotFound', 'SLICER_NOT_FOUND'],
    ['SlicerIdConflict', 'SLICER_ID_EXISTS'],
    ['SlicerSheetMismatch', 'SLICER_SHEET_MISMATCH'],
  ] as const)('translates native %s envelopes to %s', (kind, code) => {
    const translated = translateNativeSlicerError(
      new Error(
        `[BRIDGE_ERROR]${JSON.stringify({
          kind,
          slicerId: 'slicer-1',
          receiverSheetId: String(SHEET_ID),
          requestedSheetId: String(OTHER_SHEET_ID),
        })}`,
      ),
      SHEET_ID,
      'slicer-1',
    );

    expect(translated).toMatchObject({ code });
    expect((translated as KernelError).cause).toBeInstanceOf(Error);
  });

  it('preserves SLICER_NOT_FOUND when native authority rejects after preflight', async () => {
    const bridge = createBridge(storedSlicer('slicer-1'));
    bridge.deleteSlicer.mockRejectedValue(
      new Error(
        `[BRIDGE_ERROR]${JSON.stringify({
          kind: 'SlicerNotFound',
          sheetId: String(SHEET_ID),
          slicerId: 'slicer-1',
        })}`,
      ),
    );

    await expect(createSlicers(bridge).remove('slicer-1')).rejects.toMatchObject<
      Partial<KernelError>
    >({ code: 'SLICER_NOT_FOUND' });
  });

  it('rejects a conflicting create owner before protection or bridge mutation', async () => {
    const bridge = createBridge(null);

    await expect(
      createSlicers(bridge).add({
        id: 'slicer-1',
        sheetId: String(OTHER_SHEET_ID),
        tableName: 'Sales',
        columnName: 'Region',
      }),
    ).rejects.toMatchObject({ code: 'SLICER_SHEET_MISMATCH' });
    expect(bridge.createSlicer).not.toHaveBeenCalled();
    expect(bridge.getSheetProtectionOptions).not.toHaveBeenCalled();
  });
});

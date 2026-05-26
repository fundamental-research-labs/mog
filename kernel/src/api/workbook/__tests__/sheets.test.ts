/**
 * WorkbookSheetsImpl — focused unit tests for sheet rename duplicate name validation.
 *
 * Tests the WorkbookSheetsImpl class directly with minimal mocks,
 * avoiding deep kernel import chains that break in test environments.
 */

import { jest } from '@jest/globals';

import { sheetId as makeSheetId, type SheetId } from '@mog-sdk/contracts/core';

import { KernelError } from '../../../errors';
import type { WorkbookSheetsDeps } from '../sheets';

const createSheetMock = jest.fn();
const removeSheetMock = jest.fn();
const moveSheetMock = jest.fn();
const renameSheetMock = jest.fn().mockResolvedValue(undefined);
const copySheetMock = jest.fn();
const setSheetHiddenMock = jest.fn();
const getOrderMock = jest.fn();
const setSelectedSheetIdsMock = jest.fn();
const isOperationAllowedMock = jest.fn().mockResolvedValue(true);
const worksheetImplMock = jest.fn().mockImplementation((sheetId: string) => ({
  _sheetId: sheetId,
  getName: jest.fn().mockReturnValue('MockSheet'),
  getSheetId: jest.fn().mockReturnValue(sheetId),
}));

// Mock sheet-crud-operations to avoid compute bridge deep imports
jest.unstable_mockModule('../operations/sheet-crud-operations', () => ({
  createSheet: createSheetMock,
  removeSheet: removeSheetMock,
  moveSheet: moveSheetMock,
  renameSheet: renameSheetMock,
  copySheet: copySheetMock,
  setSheetHidden: setSheetHiddenMock,
}));

// Mock sheet-meta domain module
jest.unstable_mockModule('../../../domain/sheets/sheet-meta', () => ({
  getOrder: getOrderMock,
}));

// Mock workbook domain module
jest.unstable_mockModule('../../../domain/workbook/workbook', () => ({
  setSelectedSheetIds: setSelectedSheetIdsMock,
  isOperationAllowed: isOperationAllowedMock,
}));

// Mock WorksheetImpl to avoid deep import chains
jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

const SheetOps = await import('../operations/sheet-crud-operations');
const { WorkbookSheetsImpl } = await import('../sheets');

// =============================================================================
// Helpers
// =============================================================================

function createMockDeps(sheets: Record<string, string>): WorkbookSheetsDeps {
  // sheets: { sheetId: 'DisplayName', ... }
  const ids = Object.keys(sheets);

  const mockEventBus = {
    emit: jest.fn(),
  };

  const mockBridge = {
    getSheetName: jest.fn().mockImplementation((id: string) => {
      return Promise.resolve(sheets[id] ?? null);
    }),
    getAllSheetIds: jest.fn().mockResolvedValue(ids),
  };

  // getOrder mock returns the sheet IDs
  getOrderMock.mockResolvedValue(ids);

  const mockWorkbook = {
    _getOrCreateWorksheet: jest.fn().mockImplementation((id: string, name?: string) => ({
      _sheetId: id,
      getName: jest.fn().mockReturnValue(name ?? 'MockSheet'),
      getSheetId: jest.fn().mockReturnValue(id),
    })),
    refreshSheetMetadata: jest.fn().mockResolvedValue(undefined),
  };

  return {
    ctx: {
      computeBridge: mockBridge,
      eventBus: mockEventBus,
      writeGate: { assertWritable: jest.fn() },
    } as any,
    resolveTarget: jest.fn().mockImplementation(async (target: number | string) => {
      if (typeof target === 'number') return makeSheetId(ids[target]);
      // Case-insensitive name lookup
      const lower = (target as string).toLowerCase();
      for (const [id, name] of Object.entries(sheets)) {
        if (name.toLowerCase() === lower) return makeSheetId(id);
      }
      throw new KernelError('API_SHEET_NOT_FOUND', `Sheet not found: ${target}`, {
        context: { target },
      });
    }),
    getSheetName: jest.fn().mockImplementation(async (id: SheetId) => {
      return sheets[id as string] ?? undefined;
    }),
    getSheetCount: jest.fn().mockResolvedValue(ids.length),
    setActiveSheetId: jest.fn(),
    workbook: mockWorkbook as any,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('WorkbookSheetsImpl.add()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the new sheet as active after adding', async () => {
    const deps = createMockDeps({ s1: 'Sheet1' });
    const newSheetId = makeSheetId('s2');
    (SheetOps.createSheet as jest.Mock).mockResolvedValue(newSheetId);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.add('Revenue');

    expect(deps.setActiveSheetId).toHaveBeenCalledWith(newSheetId);
  });

  it('emits sheet:activated event after adding', async () => {
    const deps = createMockDeps({ s1: 'Sheet1' });
    const newSheetId = makeSheetId('s2');
    (SheetOps.createSheet as jest.Mock).mockResolvedValue(newSheetId);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.add('Revenue');

    expect(deps.ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sheet:activated',
        sheetId: newSheetId,
        name: 'Revenue',
        source: 'user',
      }),
    );
  });
});

describe('WorkbookSheetsImpl.rename()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to renameSheet when new name is unique', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet2' });
    const impl = new WorkbookSheetsImpl(deps);

    await impl.rename('Sheet1', 'MySheet');

    expect(SheetOps.renameSheet).toHaveBeenCalledWith(deps.ctx, 's1', 'MySheet');
  });

  it('throws KernelError when new name exactly matches another sheet', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet2' });
    const impl = new WorkbookSheetsImpl(deps);

    await expect(impl.rename('Sheet1', 'Sheet2')).rejects.toThrow(KernelError);
    await expect(impl.rename('Sheet1', 'Sheet2')).rejects.toThrow(/already exists/);
    expect(SheetOps.renameSheet).not.toHaveBeenCalled();
  });

  it('throws KernelError when new name matches case-insensitively', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet2' });
    const impl = new WorkbookSheetsImpl(deps);

    await expect(impl.rename('Sheet1', 'sheet2')).rejects.toThrow(KernelError);
    await expect(impl.rename('Sheet1', 'SHEET2')).rejects.toThrow(/already exists/);
    expect(SheetOps.renameSheet).not.toHaveBeenCalled();
  });

  it('allows renaming a sheet to its own name with different casing', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet2' });
    const impl = new WorkbookSheetsImpl(deps);

    // Renaming "Sheet1" → "SHEET1" should succeed (same sheet, case change only)
    await impl.rename('Sheet1', 'SHEET1');
    expect(SheetOps.renameSheet).toHaveBeenCalledWith(deps.ctx, 's1', 'SHEET1');
  });

  it('allows renaming to a completely new name', async () => {
    const deps = createMockDeps({ s1: 'Alpha', s2: 'Beta', s3: 'Gamma' });
    const impl = new WorkbookSheetsImpl(deps);

    await impl.rename('Alpha', 'Delta');
    expect(SheetOps.renameSheet).toHaveBeenCalledWith(deps.ctx, 's1', 'Delta');
  });

  it('rejects rename by index when target name is taken', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet2' });
    const impl = new WorkbookSheetsImpl(deps);

    // Rename sheet at index 0 to "Sheet2" — should fail
    await expect(impl.rename(0, 'Sheet2')).rejects.toThrow(/already exists/);
    expect(SheetOps.renameSheet).not.toHaveBeenCalled();
  });

  it('works with many sheets — only blocks on actual collision', async () => {
    const deps = createMockDeps({
      s1: 'Jan',
      s2: 'Feb',
      s3: 'Mar',
      s4: 'Apr',
      s5: 'May',
    });
    const impl = new WorkbookSheetsImpl(deps);

    // No collision
    await impl.rename('Jan', 'January');
    expect(SheetOps.renameSheet).toHaveBeenCalledWith(deps.ctx, 's1', 'January');

    jest.clearAllMocks();

    // Collision with "Mar"
    await expect(impl.rename('Feb', 'mar')).rejects.toThrow(/already exists/);
    expect(SheetOps.renameSheet).not.toHaveBeenCalled();
  });
});

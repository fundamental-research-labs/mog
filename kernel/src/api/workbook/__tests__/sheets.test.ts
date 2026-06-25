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

function expectVersionOperationOptions({
  operationIdPrefix,
  sheetIds,
  groupId,
}: {
  operationIdPrefix: string;
  sheetIds?: readonly string[];
  groupId?: unknown;
}) {
  const operationContext: Record<string, unknown> = {
    operationId: expect.stringMatching(new RegExp(`^${escapeRegExp(operationIdPrefix)}:`)),
    kind: 'mutation',
    author: expect.objectContaining({ actorKind: 'user' }),
    domainIds: ['sheets'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  };
  if (sheetIds) operationContext.sheetIds = sheetIds;
  if (groupId !== undefined) operationContext.groupId = groupId;
  return expect.objectContaining({
    operationContext: expect.objectContaining(operationContext),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    isSheetHidden: jest.fn().mockResolvedValue(false),
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

  it('passes version operation options when adding a sheet', async () => {
    const deps = createMockDeps({ s1: 'Sheet1' });
    const newSheetId = makeSheetId('s2');
    (SheetOps.createSheet as jest.Mock).mockResolvedValue(newSheetId);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.add('Revenue');

    expect(SheetOps.createSheet).toHaveBeenCalledWith(
      deps.ctx,
      'Revenue',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.add',
      }),
    );
  });

  it('groups add and optional move as one user operation', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Revenue' });
    const newSheetId = makeSheetId('s2');
    (SheetOps.createSheet as jest.Mock).mockResolvedValue(newSheetId);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.add('Revenue', 0);

    const createOptions = (SheetOps.createSheet as jest.Mock).mock.calls[0][2] as {
      operationContext: { groupId?: string };
    };
    const groupId = createOptions.operationContext.groupId;
    expect(groupId).toEqual(expect.any(String));
    expect(SheetOps.createSheet).toHaveBeenCalledWith(
      deps.ctx,
      'Revenue',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.add',
        groupId,
      }),
    );
    expect(SheetOps.moveSheet).toHaveBeenCalledWith(
      deps.ctx,
      's2',
      0,
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.add',
        sheetIds: ['s2'],
        groupId,
      }),
    );
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

describe('WorkbookSheetsImpl.remove()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes version operation options when removing a sheet', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet2' });
    (SheetOps.removeSheet as jest.Mock).mockResolvedValue(true);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.remove('Sheet1');

    expect(SheetOps.removeSheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.remove',
        sheetIds: ['s1'],
      }),
    );
  });
});

describe('WorkbookSheetsImpl.move()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes version operation options when moving a sheet', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet2' });
    (SheetOps.moveSheet as jest.Mock).mockResolvedValue(true);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.move('Sheet1', 1);

    expect(SheetOps.moveSheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      1,
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.move',
        sheetIds: ['s1'],
      }),
    );
  });
});

describe('WorkbookSheetsImpl.copy()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes version operation options when copying a sheet', async () => {
    const deps = createMockDeps({ s1: 'Sheet1' });
    const newSheetId = makeSheetId('s2');
    (SheetOps.copySheet as jest.Mock).mockResolvedValue(newSheetId);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.copy('Sheet1', 'Revenue Copy');

    expect(SheetOps.copySheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      'Revenue Copy',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.copy',
        sheetIds: ['s1'],
      }),
    );
  });

  it('groups copy and optional move as one user operation', async () => {
    const deps = createMockDeps({ s1: 'Sheet1', s2: 'Sheet1 (Copy)' });
    const newSheetId = makeSheetId('s2');
    (SheetOps.copySheet as jest.Mock).mockResolvedValue(newSheetId);
    const impl = new WorkbookSheetsImpl(deps);

    await impl.copy('Sheet1', undefined, 0);

    const copyOptions = (SheetOps.copySheet as jest.Mock).mock.calls[0][3] as {
      operationContext: { groupId?: string };
    };
    const groupId = copyOptions.operationContext.groupId;
    expect(groupId).toEqual(expect.any(String));
    expect(SheetOps.copySheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      'Sheet1 (Copy)',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.copy',
        sheetIds: ['s1'],
        groupId,
      }),
    );
    expect(SheetOps.moveSheet).toHaveBeenCalledWith(
      deps.ctx,
      's2',
      0,
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.copy',
        sheetIds: ['s2'],
        groupId,
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

    expect(SheetOps.renameSheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      'MySheet',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.rename',
        sheetIds: ['s1'],
      }),
    );
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
    expect(SheetOps.renameSheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      'SHEET1',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.rename',
        sheetIds: ['s1'],
      }),
    );
  });

  it('allows renaming to a completely new name', async () => {
    const deps = createMockDeps({ s1: 'Alpha', s2: 'Beta', s3: 'Gamma' });
    const impl = new WorkbookSheetsImpl(deps);

    await impl.rename('Alpha', 'Delta');
    expect(SheetOps.renameSheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      'Delta',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.rename',
        sheetIds: ['s1'],
      }),
    );
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
    expect(SheetOps.renameSheet).toHaveBeenCalledWith(
      deps.ctx,
      's1',
      'January',
      expectVersionOperationOptions({
        operationIdPrefix: 'workbook.sheets.rename',
        sheetIds: ['s1'],
      }),
    );

    jest.clearAllMocks();

    // Collision with "Mar"
    await expect(impl.rename('Feb', 'mar')).rejects.toThrow(/already exists/);
    expect(SheetOps.renameSheet).not.toHaveBeenCalled();
  });
});

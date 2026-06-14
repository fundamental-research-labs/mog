import { jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react';
import type { SheetId } from '@mog-sdk/contracts/core';

type ImportDurabilityMock = {
  readonly isImportDurabilityPending: boolean;
  awaitMaterialized?: jest.Mock<Promise<void>, [SheetId | 'allSheets'?]>;
  awaitImportDurability: jest.Mock<Promise<void>, []>;
};

const setActiveSheetMock = jest.fn();
const openDeleteSheetConfirmDialogMock = jest.fn();
const workbookOnMock = jest.fn().mockReturnValue(jest.fn());
let activeSheetId = 'sheet-1' as SheetId;
let importDurabilityMock: ImportDurabilityMock | undefined;

const sheetNames = new Map<SheetId, string>([
  ['sheet-1' as SheetId, 'Sheet1'],
  ['sheet-2' as SheetId, 'Sheet2'],
  ['sheet-3' as SheetId, 'Sheet3'],
]);

const workbookMock = {
  mirror: {
    getSheetIds: () => Array.from(sheetNames.keys()),
    getSheetMeta: (sheetId: SheetId) => ({
      name: sheetNames.get(sheetId) ?? null,
      hidden: false,
      tabColor: null,
    }),
  },
  on: workbookOnMock,
  sheets: {
    add: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
    move: jest.fn(),
    copy: jest.fn(),
    hide: jest.fn(),
    show: jest.fn(),
  },
  getSheetById: jest.fn(),
};

jest.unstable_mockModule('../../../infra/context', () => ({
  useActiveSheetId: () => activeSheetId,
  useDocumentContext: () => ({ importDurability: importDurabilityMock }),
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({
      setActiveSheet: setActiveSheetMock,
      openDeleteSheetConfirmDialog: openDeleteSheetConfirmDialogMock,
    }),
  useWorkbook: () => workbookMock,
}));

const { useSheetTabActions } = await import('../use-sheet-tab-actions');

describe('useSheetTabActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    activeSheetId = 'sheet-1' as SheetId;
    importDurabilityMock = undefined;
    workbookOnMock.mockReturnValue(jest.fn());
  });

  it('materializes a pending imported sheet before activating it', async () => {
    const awaitMaterialized = jest
      .fn<Promise<void>, [SheetId | 'allSheets'?]>()
      .mockResolvedValue(undefined);
    importDurabilityMock = {
      isImportDurabilityPending: true,
      awaitMaterialized,
      awaitImportDurability: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    };

    const { result } = renderHook(() => useSheetTabActions());

    await act(async () => {
      result.current.handleSelectSheet('sheet-2' as SheetId);
    });

    expect(awaitMaterialized).toHaveBeenCalledWith('sheet-2');
    expect(importDurabilityMock.awaitImportDurability).not.toHaveBeenCalled();
    expect(setActiveSheetMock).toHaveBeenCalledWith('sheet-2');
  });

  it('only activates the latest requested imported sheet after materialization', async () => {
    let resolveFirst!: () => void;
    const firstMaterialization = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const awaitMaterialized = jest
      .fn<Promise<void>, [SheetId | 'allSheets'?]>()
      .mockReturnValueOnce(firstMaterialization)
      .mockResolvedValueOnce(undefined);
    importDurabilityMock = {
      isImportDurabilityPending: true,
      awaitMaterialized,
      awaitImportDurability: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    };

    const { result } = renderHook(() => useSheetTabActions());

    await act(async () => {
      result.current.handleSelectSheet('sheet-2' as SheetId);
      result.current.handleSelectSheet('sheet-3' as SheetId);
    });

    expect(awaitMaterialized).toHaveBeenNthCalledWith(1, 'sheet-2');
    expect(awaitMaterialized).toHaveBeenNthCalledWith(2, 'sheet-3');
    expect(importDurabilityMock.awaitImportDurability).not.toHaveBeenCalled();
    expect(setActiveSheetMock).toHaveBeenCalledTimes(1);
    expect(setActiveSheetMock).toHaveBeenCalledWith('sheet-3');

    await act(async () => {
      resolveFirst();
      await firstMaterialization;
    });

    expect(setActiveSheetMock).toHaveBeenCalledTimes(1);
  });
});

import { jest } from '@jest/globals';
import { createActor } from 'xstate';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { ClipboardData } from '../../shared/types';
import { createDefaultPasteOptions, type PasteStoreOperations } from '../../../../domain/clipboard';
import { clipboardMachine } from '../../machines/clipboard-machine';
import { setupClipboardPasteIntegration } from '../paste-integration';
import { waitForPendingClipboardPaste } from '../pending-clipboard-paste';

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Clipboard Paste Integration', () => {
  it('stores external paste options on machine context before integration consumes them', () => {
    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    clipboardActor.send({
      type: 'EXTERNAL_PASTE',
      text: 'A',
      targetCell: { row: 2, col: 3 },
      options: { values: true, skipHiddenRows: true },
    });

    expect(clipboardActor.getSnapshot().context.pasteOptions).toEqual({
      values: true,
      skipHiddenRows: true,
    });
    expect(clipboardActor.getSnapshot().context.pastePreviewTarget).toEqual({ row: 2, col: 3 });

    clipboardActor.stop();
  });

  it('completes external formats-only paste with no parsed formats before workbook writes', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    const onPasteComplete = jest.fn();
    const updateSelectionAfterPaste = jest.fn();
    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
      onPasteComplete,
      updateSelectionAfterPaste,
    });

    clipboardActor.send({
      type: 'EXTERNAL_PASTE',
      text: 'A\tB',
      targetCell: { row: 4, col: 5 },
      options: { formats: true, skipHiddenRows: true },
    });
    await flushAsync();

    expect(store.setCellValues).not.toHaveBeenCalled();
    expect(store.setCellFormat).not.toHaveBeenCalled();
    expect(onPasteComplete).not.toHaveBeenCalled();
    expect(updateSelectionAfterPaste).not.toHaveBeenCalled();
    expect(clipboardActor.getSnapshot().matches('hasCopy')).toBe(true);

    cleanup();
    clipboardActor.stop();
  });

  it('completes cut-paste over non-empty destinations without overwrite confirmation', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const sourceRange = { startRow: 0, startCol: 0, endRow: 1, endCol: 0 };
    const clipboardData: ClipboardData = {
      sourceSheetId: sheetId,
      sourceRanges: [sourceRange],
      cells: {
        '0,0': { raw: 'src1' },
        '1,0': { raw: 'src2' },
      },
      textSignature: 'src1\nsrc2',
    };

    const relocateCells = jest.fn(async () => ({ success: true, movedCount: 2 }));
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn((_sheet, row, col) =>
        row === 0 && col === 2 ? { raw: 'existing' } : undefined,
      ),
      relocateCells,
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    const onCutOverwriteConfirm = jest.fn();
    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
      onCutOverwriteConfirm,
    });

    clipboardActor.send({ type: 'CUT', ranges: [sourceRange], data: clipboardData });
    clipboardActor.send({ type: 'PASTE', targetCell: { row: 0, col: 2 } });
    await waitForPendingClipboardPaste();

    expect(onCutOverwriteConfirm).not.toHaveBeenCalled();
    expect(relocateCells).toHaveBeenCalledTimes(1);
    expect(relocateCells).toHaveBeenCalledWith(sheetId, sourceRange, sheetId, 0, 2);
    expect(clipboardActor.getSnapshot().matches('empty')).toBe(true);

    cleanup();
    clipboardActor.stop();
  });

  it('preserves cut paste-special values while overwriting without confirmation', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const sourceRange = { startRow: 0, startCol: 0, endRow: 1, endCol: 0 };
    const clipboardData: ClipboardData = {
      sourceSheetId: sheetId,
      sourceRanges: [sourceRange],
      cells: {
        '0,0': { raw: 10 },
        '1,0': { raw: 20, formula: '=A1*2' },
      },
      textSignature: '10\n20',
    };
    const pasteOptions = { values: true };

    const copyRange = jest.fn(async () => {});
    const relocateCells = jest.fn(async () => ({ success: true, movedCount: 2 }));
    const onCutPasteComplete = jest.fn(async () => {});
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn((_sheet, row, col) =>
        row === 0 && col === 2 ? { raw: 'existing' } : undefined,
      ),
      copyRange,
      relocateCells,
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    const onCutOverwriteConfirm = jest.fn();
    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
      onCutOverwriteConfirm,
      onCutPasteComplete,
    });

    clipboardActor.send({ type: 'CUT', ranges: [sourceRange], data: clipboardData });
    clipboardActor.send({
      type: 'PASTE_SPECIAL',
      targetCell: { row: 0, col: 2 },
      options: pasteOptions,
    });
    await waitForPendingClipboardPaste();

    expect(onCutOverwriteConfirm).not.toHaveBeenCalled();
    expect(relocateCells).not.toHaveBeenCalled();
    expect(copyRange).toHaveBeenCalledTimes(1);
    expect(copyRange).toHaveBeenCalledWith(
      sheetId,
      sourceRange,
      sheetId,
      0,
      2,
      'values',
      false,
      false,
    );
    expect(store.setCellValues).not.toHaveBeenCalled();
    expect(onCutPasteComplete).toHaveBeenCalledWith(sheetId, [sourceRange]);
    expect(clipboardActor.getSnapshot().matches('empty')).toBe(true);

    cleanup();
    clipboardActor.stop();
  });

  it('keeps formula-aware core copy when hidden rows exist outside the paste target', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const sourceRange = { startRow: 20, startCol: 29, endRow: 20, endCol: 29 };
    const clipboardData: ClipboardData = {
      sourceSheetId: sheetId,
      sourceRanges: [sourceRange],
      cells: {
        '0,0': { raw: 7509, formula: '=14241-AC21', format: { numberFormat: '#,##0 ' } },
      },
      textSignature: '7509',
    };
    const copyRange = jest.fn(async () => {});
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
      copyRange,
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
      getHiddenRows: async () => new Set([4, 5]),
    });

    clipboardActor.send({ type: 'COPY', ranges: [sourceRange], data: clipboardData });
    clipboardActor.send({ type: 'PASTE', targetCell: { row: 20, col: 27 } });
    await waitForPendingClipboardPaste();

    expect(copyRange).toHaveBeenCalledTimes(1);
    expect(copyRange).toHaveBeenCalledWith(
      sheetId,
      sourceRange,
      sheetId,
      20,
      27,
      'all',
      false,
      false,
    );
    expect(store.setCellValues).not.toHaveBeenCalled();

    cleanup();
    clipboardActor.stop();
  });

  it('uses the hidden-row-skipping fallback when the paste target row is hidden', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const sourceRange = { startRow: 20, startCol: 29, endRow: 20, endCol: 29 };
    const clipboardData: ClipboardData = {
      sourceSheetId: sheetId,
      sourceRanges: [sourceRange],
      cells: {
        '0,0': { raw: 'src' },
      },
      textSignature: 'src',
    };
    const copyRange = jest.fn(async () => {});
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
      copyRange,
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
      getHiddenRows: async () => new Set([20]),
    });

    clipboardActor.send({ type: 'COPY', ranges: [sourceRange], data: clipboardData });
    clipboardActor.send({ type: 'PASTE', targetCell: { row: 20, col: 27 } });
    await waitForPendingClipboardPaste();

    expect(copyRange).not.toHaveBeenCalled();
    expect(store.setCellValues).toHaveBeenCalledWith(sheetId, [{ row: 21, col: 27, value: 'src' }]);

    cleanup();
    clipboardActor.stop();
  });

  it('pastes external data into an explicitly targeted hidden single cell', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const targetRange = { startRow: 20, startCol: 27, endRow: 20, endCol: 27 };
    const setCellValues = jest.fn();
    const setCellFormat = jest.fn();
    const store: PasteStoreOperations = {
      setCellValues,
      setCellFormat,
      getCellData: jest.fn(),
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    const onPasteComplete = jest.fn();
    const updateSelectionAfterPaste = jest.fn();
    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
      getHiddenRows: async () => new Set([20]),
      onPasteComplete,
      updateSelectionAfterPaste,
    });

    clipboardActor.send({
      type: 'EXTERNAL_PASTE',
      text: '123',
      targetCell: { row: 20, col: 27 },
      targetRange,
      options: createDefaultPasteOptions(),
    });
    await waitForPendingClipboardPaste();

    expect(setCellFormat).toHaveBeenCalledWith(sheetId, 20, 27, { numberFormat: 'General' });
    expect(setCellValues).toHaveBeenCalledWith(sheetId, [{ row: 20, col: 27, value: '123' }]);
    expect(setCellValues).not.toHaveBeenCalledWith(sheetId, [{ row: 21, col: 27, value: '123' }]);
    expect(setCellFormat.mock.invocationCallOrder[0]).toBeLessThan(
      setCellValues.mock.invocationCallOrder[0],
    );
    expect(onPasteComplete).toHaveBeenCalledWith(targetRange, 1);
    expect(updateSelectionAfterPaste).toHaveBeenCalledWith(targetRange);

    cleanup();
    clipboardActor.stop();
  });

  it('tiles normal copy paste across an exact-multiple selected target range', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const sourceRange = { startRow: 0, startCol: 0, endRow: 1, endCol: 2 };
    const targetRange = { startRow: 2, startCol: 5, endRow: 5, endCol: 10 };
    const collapsedPreviewRange = { startRow: 2, startCol: 5, endRow: 3, endCol: 7 };
    const clipboardData: ClipboardData = {
      sourceSheetId: sheetId,
      sourceRanges: [sourceRange],
      cells: {
        '0,0': { raw: 'A' },
        '0,1': { raw: 'B' },
        '0,2': { raw: 'C' },
        '1,0': { raw: 'D' },
        '1,1': { raw: 'E' },
        '1,2': { raw: 'F' },
      },
      textSignature: 'A\tB\tC\nD\tE\tF',
    };

    const copyRange = jest.fn(async () => {});
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
      copyRange,
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();

    const onPasteComplete = jest.fn();
    const updateSelectionAfterPaste = jest.fn();
    const onSizeMismatch = jest.fn();
    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
      getSelectionRange: () => collapsedPreviewRange,
      onPasteComplete,
      updateSelectionAfterPaste,
      onSizeMismatch,
    });

    clipboardActor.send({ type: 'COPY', ranges: [sourceRange], data: clipboardData });
    clipboardActor.send({ type: 'PASTE', targetCell: { row: 2, col: 5 }, targetRange });
    await waitForPendingClipboardPaste();

    expect(onSizeMismatch).not.toHaveBeenCalled();
    expect(copyRange).toHaveBeenCalledTimes(4);
    expect(copyRange).toHaveBeenNthCalledWith(
      1,
      sheetId,
      sourceRange,
      sheetId,
      2,
      5,
      'all',
      false,
      false,
    );
    expect(copyRange).toHaveBeenNthCalledWith(
      2,
      sheetId,
      sourceRange,
      sheetId,
      2,
      8,
      'all',
      false,
      false,
    );
    expect(copyRange).toHaveBeenNthCalledWith(
      3,
      sheetId,
      sourceRange,
      sheetId,
      4,
      5,
      'all',
      false,
      false,
    );
    expect(copyRange).toHaveBeenNthCalledWith(
      4,
      sheetId,
      sourceRange,
      sheetId,
      4,
      8,
      'all',
      false,
      false,
    );
    expect(onPasteComplete).toHaveBeenCalledWith(targetRange, 24);
    expect(updateSelectionAfterPaste).toHaveBeenCalledWith(targetRange);

    cleanup();
    clipboardActor.stop();
  });

  it('clears browser clipboard text after a successful cut relocate', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const sourceRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const clipboardData: ClipboardData = {
      sourceSheetId: sheetId,
      sourceRanges: [sourceRange],
      cells: {
        '0,0': { raw: 'CutMe' },
      },
      textSignature: 'CutMe',
    };

    const writeText = jest.fn<() => Promise<void>>(async () => {});
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'clipboard',
    );
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
      relocateCells: jest.fn(async () => ({ success: true, movedCount: 1 })),
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();
    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
    });

    try {
      clipboardActor.send({ type: 'CUT', ranges: [sourceRange], data: clipboardData });
      clipboardActor.send({ type: 'PASTE', targetCell: { row: 0, col: 2 } });
      await waitForPendingClipboardPaste();

      expect(writeText).toHaveBeenCalledWith('');
      expect(clipboardActor.getSnapshot().matches('empty')).toBe(true);
    } finally {
      cleanup();
      clipboardActor.stop();
      if (originalClipboardDescriptor) {
        Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboardDescriptor);
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'clipboard');
      }
    }
  });

  it('publishes an awaitable promise for the actual paste side effect', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const clipboardData: ClipboardData = {
      sourceSheetId: sheetId,
      sourceRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      cells: {
        '0,0': { raw: 'src' },
      },
      textSignature: 'src',
    };

    let releaseRelocation: (() => void) | undefined;
    const relocateCells = jest.fn(
      () =>
        new Promise<{ success: true; movedCount: number }>((resolve) => {
          releaseRelocation = () => resolve({ success: true, movedCount: 1 });
        }),
    );
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
      relocateCells,
    };

    const clipboardActor = createActor(clipboardMachine);
    clipboardActor.start();
    const cleanup = setupClipboardPasteIntegration({
      clipboardActor,
      store,
      getActiveSheetId: () => sheetId,
    });

    clipboardActor.send({
      type: 'CUT',
      ranges: clipboardData.sourceRanges!,
      data: clipboardData,
    });
    clipboardActor.send({ type: 'PASTE', targetCell: { row: 3, col: 4 } });
    await flushAsync();

    let settled = false;
    const wait = waitForPendingClipboardPaste().then(() => {
      settled = true;
    });
    await flushAsync();

    expect(settled).toBe(false);
    expect(relocateCells).toHaveBeenCalledWith(
      sheetId,
      clipboardData.sourceRanges![0],
      sheetId,
      3,
      4,
    );

    releaseRelocation?.();
    await wait;

    expect(settled).toBe(true);
    expect(clipboardActor.getSnapshot().matches('empty')).toBe(true);

    cleanup();
    clipboardActor.stop();
  });
});

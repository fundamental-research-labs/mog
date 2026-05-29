import { jest } from '@jest/globals';
import { createActor } from 'xstate';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { ClipboardData } from '../../shared/types';
import type { PasteStoreOperations } from '../../../domain/clipboard';
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

  it('runs the confirmed cut-paste retry after overwrite confirmation defers the first paste', async () => {
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
    await flushAsync();

    expect(onCutOverwriteConfirm).toHaveBeenCalledWith({
      targetCell: { row: 0, col: 2 },
      sheetId,
    });
    expect(relocateCells).not.toHaveBeenCalled();
    expect(clipboardActor.getSnapshot().matches('hasCut')).toBe(true);

    clipboardActor.send({
      type: 'PASTE',
      targetCell: { row: 0, col: 2 },
      skipSizeCheck: true,
      skipOverwriteCheck: true,
    });
    await flushAsync();

    expect(relocateCells).toHaveBeenCalledTimes(1);
    expect(relocateCells).toHaveBeenCalledWith(sheetId, sourceRange, sheetId, 0, 2);
    expect(clipboardActor.getSnapshot().matches('empty')).toBe(true);

    cleanup();
    clipboardActor.stop();
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

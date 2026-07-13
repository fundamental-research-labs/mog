import { jest } from '@jest/globals';

import { CLEAR_COMMENTS } from '../editor';

type CommentFixture = {
  cellRef: string;
  commentType: 'note' | 'threadedComment';
};

function deferredVoid() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createWorksheet(
  comments: readonly CommentFixture[],
  positions: ReadonlyMap<string, { row: number; col: number }>,
) {
  const list = jest.fn().mockResolvedValue(comments as never);
  const batchGetCellPositions = jest.fn().mockResolvedValue(positions as never);
  const removeForCell = jest.fn().mockResolvedValue(1 as never);

  return {
    worksheet: {
      comments: { list, removeForCell },
      _internal: { batchGetCellPositions },
    },
    list,
    batchGetCellPositions,
    removeForCell,
  };
}

function createDeps(options: {
  activeSheetId: string;
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  worksheets: Readonly<Record<string, unknown>>;
  selectedSheetIds?: () => string[] | Promise<string[]>;
}) {
  const undoGroup = jest.fn(async (operation: () => Promise<void>) => operation());
  const getSheetById = jest.fn((sheetId: string) => options.worksheets[sheetId]);

  return {
    deps: {
      getActiveSheetId: jest.fn().mockReturnValue(options.activeSheetId),
      getSelectedSheetIds: options.selectedSheetIds,
      workbook: { getSheetById, undoGroup },
      accessors: {
        selection: {
          getActiveCell: jest.fn().mockReturnValue({ row: 0, col: 0 }),
          getRanges: jest.fn().mockReturnValue(options.ranges),
        },
      },
    } as any,
    getSheetById,
    undoGroup,
  };
}

describe('CLEAR_COMMENTS', () => {
  test('removes notes and threaded comments only from occupied selected cells once', async () => {
    const sheet = createWorksheet(
      [
        { cellRef: 'note-cell', commentType: 'note' },
        { cellRef: 'thread-cell', commentType: 'threadedComment' },
        { cellRef: 'thread-cell', commentType: 'threadedComment' },
        { cellRef: 'same-position-cell', commentType: 'note' },
        { cellRef: 'outside-cell', commentType: 'threadedComment' },
        { cellRef: 'missing-cell', commentType: 'note' },
      ],
      new Map([
        ['note-cell', { row: 1, col: 1 }],
        ['thread-cell', { row: 3, col: 3 }],
        ['same-position-cell', { row: 3, col: 3 }],
        ['outside-cell', { row: 8, col: 8 }],
      ]),
    );
    const { deps } = createDeps({
      activeSheetId: 'sheet-a',
      ranges: [
        { startRow: 4, startCol: 4, endRow: 1, endCol: 1 },
        { startRow: 3, startCol: 3, endRow: 5, endCol: 5 },
      ],
      worksheets: { 'sheet-a': sheet.worksheet },
    });

    await expect(CLEAR_COMMENTS(deps)).resolves.toEqual({ handled: true });

    expect(sheet.list).toHaveBeenCalledTimes(1);
    expect(sheet.batchGetCellPositions).toHaveBeenCalledWith([
      'note-cell',
      'thread-cell',
      'same-position-cell',
      'outside-cell',
      'missing-cell',
    ]);
    expect(sheet.removeForCell).toHaveBeenCalledTimes(2);
    expect(sheet.removeForCell).toHaveBeenNthCalledWith(1, 1, 1);
    expect(sheet.removeForCell).toHaveBeenNthCalledWith(2, 3, 3);
  });

  test('clears every asynchronously selected sheet and deduplicates sheet IDs', async () => {
    const firstSheet = createWorksheet(
      [{ cellRef: 'first-comment', commentType: 'note' }],
      new Map([['first-comment', { row: 0, col: 0 }]]),
    );
    const secondSheet = createWorksheet(
      [{ cellRef: 'second-comment', commentType: 'threadedComment' }],
      new Map([['second-comment', { row: 0, col: 0 }]]),
    );
    const getSelectedSheetIds = jest
      .fn<() => Promise<string[]>>()
      .mockResolvedValue(['sheet-a', 'sheet-b', 'sheet-b']);
    const { deps, getSheetById, undoGroup } = createDeps({
      activeSheetId: 'sheet-a',
      selectedSheetIds: getSelectedSheetIds,
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      worksheets: {
        'sheet-a': firstSheet.worksheet,
        'sheet-b': secondSheet.worksheet,
      },
    });

    await expect(CLEAR_COMMENTS(deps)).resolves.toEqual({ handled: true });

    expect(getSelectedSheetIds).toHaveBeenCalledTimes(1);
    expect(getSheetById).toHaveBeenCalledTimes(2);
    expect(getSheetById).toHaveBeenNthCalledWith(1, 'sheet-a');
    expect(getSheetById).toHaveBeenNthCalledWith(2, 'sheet-b');
    expect(firstSheet.removeForCell).toHaveBeenCalledWith(0, 0);
    expect(secondSheet.removeForCell).toHaveBeenCalledWith(0, 0);
    expect(undoGroup).toHaveBeenCalledTimes(1);
  });

  test('falls back to the active sheet and does not submit blank cells', async () => {
    const sheet = createWorksheet([], new Map());
    const getSelectedSheetIds = jest.fn<() => string[]>().mockReturnValue([]);
    const { deps, getSheetById } = createDeps({
      activeSheetId: 'active-sheet',
      selectedSheetIds: getSelectedSheetIds,
      ranges: [{ startRow: 0, startCol: 0, endRow: 100, endCol: 100 }],
      worksheets: { 'active-sheet': sheet.worksheet },
    });

    await expect(CLEAR_COMMENTS(deps)).resolves.toEqual({ handled: true });

    expect(getSheetById).toHaveBeenCalledWith('active-sheet');
    expect(sheet.batchGetCellPositions).not.toHaveBeenCalled();
    expect(sheet.removeForCell).not.toHaveBeenCalled();
  });

  test('tolerates a comment removed concurrently after sparse enumeration', async () => {
    const sheet = createWorksheet(
      [{ cellRef: 'stale-comment', commentType: 'threadedComment' }],
      new Map([['stale-comment', { row: 0, col: 0 }]]),
    );
    sheet.removeForCell.mockRejectedValue({ code: 'COMMENT_NOT_FOUND' } as never);
    const { deps } = createDeps({
      activeSheetId: 'sheet-a',
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      worksheets: { 'sheet-a': sheet.worksheet },
    });

    await expect(CLEAR_COMMENTS(deps)).resolves.toEqual({ handled: true });
    expect(sheet.removeForCell).toHaveBeenCalledWith(0, 0);
  });

  test('waits for every started removal before propagating a failure and closing the undo group', async () => {
    const sheet = createWorksheet(
      [
        { cellRef: 'failing-comment', commentType: 'note' },
        { cellRef: 'pending-comment', commentType: 'threadedComment' },
      ],
      new Map([
        ['failing-comment', { row: 0, col: 0 }],
        ['pending-comment', { row: 0, col: 1 }],
      ]),
    );
    const pendingStarted = deferredVoid();
    const pendingFinished = deferredVoid();
    const failure = new Error('comment transport failed');
    sheet.removeForCell.mockRejectedValueOnce(failure as never).mockImplementationOnce(() => {
      pendingStarted.resolve();
      return pendingFinished.promise as never;
    });
    const { deps, undoGroup } = createDeps({
      activeSheetId: 'sheet-a',
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }],
      worksheets: { 'sheet-a': sheet.worksheet },
    });
    let groupEnded = false;
    undoGroup.mockImplementation(async (operation: () => Promise<void>) => {
      try {
        return await operation();
      } finally {
        groupEnded = true;
      }
    });

    const operation = CLEAR_COMMENTS(deps);
    await pendingStarted.promise;
    await Promise.resolve();

    expect(groupEnded).toBe(false);

    pendingFinished.resolve();
    await expect(operation).rejects.toBe(failure);
    expect(groupEnded).toBe(true);
  });
});

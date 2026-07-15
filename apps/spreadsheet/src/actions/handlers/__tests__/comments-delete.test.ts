import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { Comment, CommentType } from '@mog-sdk/contracts/api';
import { sheetId } from '@mog-sdk/contracts/core';

import { DELETE_COMMENT } from '../comments';

const ACTIVE_SHEET_ID = sheetId('sheet-1');
const ACTIVE_CELL = { row: 4, col: 2 };

function makeComment(commentType: CommentType): Comment {
  return {
    id: `${commentType}-1`,
    cellRef: 'cell-1',
    author: 'Ada',
    content: 'Comment text',
    runs: [],
    threadId: commentType === 'threadedComment' ? `${commentType}-1` : null,
    parentId: null,
    createdAt: 1,
    modifiedAt: null,
    commentType,
  };
}

function createMockDeps(comments: Comment[]) {
  const getForCell = jest.fn().mockResolvedValue(comments);
  const removeForCell = jest.fn().mockResolvedValue(comments.length);
  const removeNote = jest.fn();
  const worksheet = {
    comments: { getForCell, removeForCell, removeNote },
  };
  const deps = {
    workbook: {
      getSheetById: jest.fn().mockReturnValue(worksheet),
    },
    getActiveSheetId: jest.fn().mockReturnValue(ACTIVE_SHEET_ID),
    accessors: {
      selection: {
        getActiveCell: jest.fn().mockReturnValue(ACTIVE_CELL),
      },
    },
  } as unknown as ActionDependencies;

  return { deps, getForCell, removeForCell, removeNote };
}

describe('DELETE_COMMENT', () => {
  it('deletes a threaded comment through the all-types cell API', async () => {
    const { deps, getForCell, removeForCell, removeNote } = createMockDeps([
      makeComment('threadedComment'),
    ]);

    const result = await DELETE_COMMENT(deps);

    expect(result.handled).toBe(true);
    expect(getForCell).toHaveBeenCalledWith(ACTIVE_CELL.row, ACTIVE_CELL.col);
    expect(removeForCell).toHaveBeenCalledWith(ACTIVE_CELL.row, ACTIVE_CELL.col);
    expect(removeNote).not.toHaveBeenCalled();
  });

  it('deletes a legacy note through the all-types cell API', async () => {
    const { deps, removeForCell, removeNote } = createMockDeps([makeComment('note')]);

    const result = await DELETE_COMMENT(deps);

    expect(result.handled).toBe(true);
    expect(removeForCell).toHaveBeenCalledWith(ACTIVE_CELL.row, ACTIVE_CELL.col);
    expect(removeNote).not.toHaveBeenCalled();
  });

  it('treats an empty active cell as handled without issuing a deletion', async () => {
    const { deps, getForCell, removeForCell, removeNote } = createMockDeps([]);

    const result = await DELETE_COMMENT(deps);

    expect(result.handled).toBe(true);
    expect(getForCell).toHaveBeenCalledWith(ACTIVE_CELL.row, ACTIVE_CELL.col);
    expect(removeForCell).not.toHaveBeenCalled();
    expect(removeNote).not.toHaveBeenCalled();
  });

  it('treats a concurrent missing-target deletion as an idempotent success', async () => {
    const { deps, removeForCell } = createMockDeps([makeComment('threadedComment')]);
    removeForCell.mockRejectedValue({ code: 'COMMENT_NOT_FOUND' });

    await expect(DELETE_COMMENT(deps)).resolves.toEqual({ handled: true });
    expect(removeForCell).toHaveBeenCalledWith(ACTIVE_CELL.row, ACTIVE_CELL.col);
  });

  it('propagates non-missing-target deletion failures', async () => {
    const { deps, removeForCell } = createMockDeps([makeComment('threadedComment')]);
    const error = new Error('bridge unavailable');
    removeForCell.mockRejectedValue(error);

    await expect(DELETE_COMMENT(deps)).rejects.toBe(error);
  });
});

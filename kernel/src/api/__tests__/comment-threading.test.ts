/**
 * Comment Threading API Tests
 *
 * Tests:
 * 1. Rust-shaped Comment contract forwarding
 * 2. addReply, getThread, getById
 * 3. add() returns Comment
 * 4. list() and getForCell() use mapper
 */

// Mock transitive dependencies
import { jest } from '@jest/globals';

jest.mock('../../floating-objects', () => ({
  createSpreadsheetObjectManager: jest.fn(),
}));
jest.mock('../../context', () => ({}));

import { sheetId } from '@mog-sdk/contracts/core';

import type { Comment, RichTextRun } from '../../bridges/compute/compute-types.gen';
import { WorksheetCommentsImpl } from '../worksheet/comments';

const SHEET_ID = sheetId('sheet-1');

/** Helper to create a RichTextRun with sensible defaults. */
function makeRun(text: string, overrides?: Partial<RichTextRun>): RichTextRun {
  return {
    text,
    fontName: null,
    fontSize: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    color: null,
    charset: null,
    family: null,
    scheme: null,
    preserveSpace: false,
    ...overrides,
  };
}

/** Helper to create a mock Comment. */
function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    cellRef: '0:0',
    author: 'Alice',
    createdAt: 1700000000000,
    modifiedAt: null,
    parentId: null,
    runs: [makeRun('Hello world')],
    content: 'Hello world',
    threadId: 'comment-1',
    commentType: 'threadedComment',
    ...overrides,
  };
}

function createMockCtx() {
  return {
    computeBridge: {
      getComment: jest.fn(),
      addComment: jest.fn(),
      addCommentByPosition: jest.fn(),
      deleteComment: jest.fn(),
      updateComment: jest.fn(),
      setThreadResolved: jest.fn(),
      getAllComments: jest.fn(),
      getCommentsForCell: jest.fn(),
      getCommentsForCellByPosition: jest.fn(),
      getCommentThread: jest.fn(),
      getCommentCount: jest.fn(),
      convertNoteToThread: jest.fn(),
    },
  } as any;
}

describe('WorksheetCommentsImpl — Comment Threading', () => {
  let ws: WorksheetCommentsImpl;
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = createMockCtx();
    ws = new WorksheetCommentsImpl(mockCtx, SHEET_ID);
  });

  // =========================================================================
  // Comment contract forwarding (tested via list/getForCell/getById)
  // =========================================================================

  describe('Comment contract forwarding (via getById)', () => {
    it('returns all fields from the bridge Comment', async () => {
      const cell: Comment = makeComment({
        id: 'c1',
        cellRef: '2:3',
        author: 'Bob',
        authorId: 'user-bob',
        createdAt: 1700000000000,
        modifiedAt: 1700000001000,
        runs: [makeRun('Bold text', { bold: true }), makeRun(' normal')],
        content: 'Bold text normal',
        threadId: 'c0',
        parentId: 'c0',
        resolved: true,
      });
      mockCtx.computeBridge.getComment.mockResolvedValue(cell);

      const result = (await ws.getById('c1')) as any;

      expect(result).not.toBeNull();
      expect(result!.id).toBe('c1');
      expect(result!.cellRef).toBe('2:3');
      expect(result!.author).toBe('Bob');
      expect(result!.authorId).toBe('user-bob');
      expect(result!.createdAt).toBe(1700000000000);
      expect(result!.modifiedAt).toBe(1700000001000);
      expect(result!.content).toBe('Bold text normal');
      expect(result!.threadId).toBe('c0');
      expect(result!.parentId).toBe('c0');
      expect(result!.resolved).toBe(true);
      expect(result!.runs).toEqual(cell.runs);
    });

    it('preserves bridge cellRef', async () => {
      const cases = [{ cellRef: '0:0' }, { cellRef: '2:3' }, { cellRef: '5:10' }];
      for (const { cellRef } of cases) {
        const cell = makeComment({ cellRef });
        mockCtx.computeBridge.getComment.mockResolvedValue(cell);
        const result = (await ws.getById('comment-1')) as any;
        expect(result!.cellRef).toBe(cellRef);
      }
    });

    it('handles empty runs', async () => {
      const cell = makeComment({ runs: [], content: undefined });
      mockCtx.computeBridge.getComment.mockResolvedValue(cell);

      const result = (await ws.getById('comment-1')) as any;

      expect(result!.runs).toEqual([]);
      expect(result!.content).toBeUndefined();
    });

    it('handles missing optional fields', async () => {
      const cell = makeComment({
        authorId: undefined,
        modifiedAt: undefined,
        parentId: undefined,
        resolved: undefined,
      });
      mockCtx.computeBridge.getComment.mockResolvedValue(cell);

      const result = (await ws.getById('comment-1')) as any;

      expect(result!.authorId).toBeUndefined();
      expect(result!.modifiedAt).toBeUndefined();
      expect(result!.parentId).toBeUndefined();
      expect(result!.resolved).toBeUndefined();
    });

    it('returns null for non-existent comment', async () => {
      mockCtx.computeBridge.getComment.mockResolvedValue(null);

      const result = await ws.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // add() returns Comment
  // =========================================================================

  describe('add()', () => {
    it('returns created comment via A1 address', async () => {
      const created = makeComment({ id: 'new-1' });
      mockCtx.computeBridge.addCommentByPosition.mockResolvedValue({ data: created });

      const result = (await ws.add('A1', 'Hello', 'Alice')) as any;

      expect(mockCtx.computeBridge.addCommentByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        'Hello',
        'Alice',
        null,
        null,
        'threadedComment',
      );
      expect(result.id).toBe('new-1');
      expect(result.content).toBe('Hello world');
    });

    it('returns created comment via row/col', async () => {
      const created = makeComment({ id: 'new-2' });
      mockCtx.computeBridge.addCommentByPosition.mockResolvedValue({ data: created });

      const result = await ws.add(2, 3, 'Test', 'Bob');

      expect(mockCtx.computeBridge.addCommentByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        2,
        3,
        'Test',
        'Bob',
        null,
        null,
        'threadedComment',
      );
      expect(result.id).toBe('new-2');
    });
  });

  // =========================================================================
  // addReply()
  // =========================================================================

  describe('addReply()', () => {
    it('creates reply with parentId', async () => {
      const parent = makeComment({ id: 'root-1', cellRef: '5:10' });
      const reply = makeComment({
        id: 'reply-1',
        cellRef: '5:10',
        parentId: 'root-1',
        threadId: 'root-1',
      });

      mockCtx.computeBridge.getComment.mockResolvedValue(parent);
      mockCtx.computeBridge.addComment.mockResolvedValue(reply);

      const result = await ws.addReply('root-1', 'My reply', 'Bob');

      expect(mockCtx.computeBridge.addComment).toHaveBeenCalledWith(
        SHEET_ID,
        '5:10',
        'My reply',
        'Bob',
        { parentId: 'root-1', commentType: 'threadedComment' },
      );
      expect(result.parentId).toBe('root-1');
      expect(result.threadId).toBe('root-1');
    });

    it('converts a legacy note parent before creating a threaded reply', async () => {
      const noteParent = makeComment({
        id: 'note-1',
        cellRef: '5:10',
        commentType: 'note',
        threadId: null,
      });
      const convertedParent = makeComment({
        id: 'note-1',
        cellRef: '5:10',
        commentType: 'threadedComment',
        threadId: 'note-1',
      });
      const reply = makeComment({
        id: 'reply-1',
        cellRef: '5:10',
        parentId: 'note-1',
        threadId: 'note-1',
      });

      mockCtx.computeBridge.getComment.mockResolvedValue(noteParent);
      mockCtx.computeBridge.convertNoteToThread.mockResolvedValue({ data: convertedParent });
      mockCtx.computeBridge.addComment.mockResolvedValue(reply);

      const result = await ws.addReply('note-1', 'My reply', 'Bob');

      expect(mockCtx.computeBridge.convertNoteToThread).toHaveBeenCalledWith(SHEET_ID, 'note-1');
      expect(mockCtx.computeBridge.addComment).toHaveBeenCalledWith(
        SHEET_ID,
        '5:10',
        'My reply',
        'Bob',
        { parentId: 'note-1', commentType: 'threadedComment' },
      );
      expect(result.parentId).toBe('note-1');
      expect(result.threadId).toBe('note-1');
    });

    it('throws when parent comment not found', async () => {
      mockCtx.computeBridge.getComment.mockResolvedValue(null);

      await expect(ws.addReply('nonexistent', 'text', 'author')).rejects.toThrow(
        'Comment not found: nonexistent',
      );
    });
  });

  // =========================================================================
  // getThread()
  // =========================================================================

  describe('getThread()', () => {
    it('returns mapped thread sorted by createdAt', async () => {
      const root = makeComment({ id: 'root', threadId: 'root', createdAt: 1000 });
      const reply1 = makeComment({
        id: 'r1',
        threadId: 'root',
        parentId: 'root',
        createdAt: 2000,
      });
      const reply2 = makeComment({
        id: 'r2',
        threadId: 'root',
        parentId: 'root',
        createdAt: 3000,
      });

      mockCtx.computeBridge.getComment.mockResolvedValue(root);
      mockCtx.computeBridge.getCommentThread.mockResolvedValue([root, reply1, reply2]);

      const result = (await ws.getThread('root')) as any;

      expect(mockCtx.computeBridge.getCommentThread).toHaveBeenCalledWith(SHEET_ID, 'root');
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('root');
      expect(result[1].id).toBe('r1');
      expect(result[2].id).toBe('r2');
      expect(result[0].content).toBe('Hello world');
    });

    it('returns empty array when comment not found', async () => {
      mockCtx.computeBridge.getComment.mockResolvedValue(null);

      const result = await ws.getThread('nonexistent');
      expect(result).toEqual([]);
    });

    it('uses threadId from comment (not commentId) for lookup', async () => {
      const reply = makeComment({ id: 'reply-5', threadId: 'thread-root' });
      mockCtx.computeBridge.getComment.mockResolvedValue(reply);
      mockCtx.computeBridge.getCommentThread.mockResolvedValue([]);

      await ws.getThread('reply-5');

      expect(mockCtx.computeBridge.getCommentThread).toHaveBeenCalledWith(SHEET_ID, 'thread-root');
    });
  });

  // =========================================================================
  // list() and getForCell() use mapper
  // =========================================================================

  describe('list()', () => {
    it('returns all comments with bridge fields intact', async () => {
      const comments = [
        makeComment({ id: 'a', runs: [makeRun('First')], content: 'First' }),
        makeComment({ id: 'b', runs: [makeRun('Second')], content: 'Second' }),
      ];
      mockCtx.computeBridge.getAllComments.mockResolvedValue(comments);

      const result = (await ws.list()) as any;

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('First');
      expect(result[1].content).toBe('Second');
      expect(result[0].runs).toEqual([makeRun('First')]);
    });
  });

  describe('getForCell()', () => {
    it('returns cell comments with bridge fields intact', async () => {
      const comments = [makeComment({ runs: [makeRun('Cell comment')], content: 'Cell comment' })];
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue(comments);

      const result = (await ws.getForCell('B3')) as any;

      expect(mockCtx.computeBridge.getCommentsForCellByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        2,
        1,
      );
      expect(result[0].content).toBe('Cell comment');
    });
  });

  // =========================================================================
  // Rich text field forwarding
  // =========================================================================

  describe('rich text field forwarding', () => {
    it('forwards underline, strikethrough, fontName, fontSize from bridge runs', async () => {
      const cell = makeComment({
        runs: [
          makeRun('styled', {
            bold: true,
            italic: true,
            underline: true,
            strikethrough: true,
            fontName: 'Arial',
            fontSize: 14,
            color: '#ff0000',
          }),
        ],
        content: 'styled',
      });
      mockCtx.computeBridge.getComment.mockResolvedValue(cell);

      const result = (await ws.getById('comment-1')) as any;

      expect(result!.runs).toEqual(cell.runs);
    });

    it('preserves false/null rich text fields from bridge runs', async () => {
      const cell = makeComment({
        runs: [makeRun('plain')],
        content: 'plain',
      });
      mockCtx.computeBridge.getComment.mockResolvedValue(cell);

      const result = (await ws.getById('comment-1')) as any;

      const segment = result!.runs[0];
      expect(segment.underline).toBe(false);
      expect(segment.strikethrough).toBe(false);
      expect(segment.fontName).toBeNull();
      expect(segment.fontSize).toBeNull();
      expect(segment.bold).toBe(false);
      expect(segment.italic).toBe(false);
      expect(segment.color).toBeNull();
    });
  });

  // =========================================================================
  // count()
  // =========================================================================

  describe('getCount()', () => {
    it('delegates to computeBridge.getCommentCount', async () => {
      mockCtx.computeBridge.getCommentCount.mockResolvedValue(42);

      const result = await ws.getCount();

      expect(mockCtx.computeBridge.getCommentCount).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toBe(42);
    });

    it('returns 0 when no comments exist', async () => {
      mockCtx.computeBridge.getCommentCount.mockResolvedValue(0);

      const result = await ws.getCount();
      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // propagateResolved
  // =========================================================================

  describe('propagateResolved (via list and getThread)', () => {
    it('list() propagates root resolved state to replies with undefined resolved', async () => {
      const root = makeComment({
        id: 'root',
        threadId: 'root',
        parentId: null,
        resolved: true,
        createdAt: 1000,
      });
      const reply = makeComment({
        id: 'reply',
        threadId: 'root',
        parentId: 'root',
        resolved: undefined,
        createdAt: 2000,
      });
      mockCtx.computeBridge.getAllComments.mockResolvedValue([root, reply]);

      const result = (await ws.list()) as any;

      expect(result).toHaveLength(2);
      expect(result[0].resolved).toBe(true);
      expect(result[1].resolved).toBe(true);
    });

    it('getThread() propagates root resolved state to replies', async () => {
      const root = makeComment({
        id: 'root',
        threadId: 'root',
        parentId: null,
        resolved: true,
        createdAt: 1000,
      });
      const reply = makeComment({
        id: 'reply',
        threadId: 'root',
        parentId: 'root',
        resolved: undefined,
        createdAt: 2000,
      });

      mockCtx.computeBridge.getComment.mockResolvedValue(root);
      mockCtx.computeBridge.getCommentThread.mockResolvedValue([root, reply]);

      const result = (await ws.getThread('root')) as any;

      expect(result).toHaveLength(2);
      expect(result[0].resolved).toBe(true);
      expect(result[1].resolved).toBe(true);
    });

    it('does not override explicit resolved value on replies', async () => {
      const root = makeComment({
        id: 'root',
        threadId: 'root',
        parentId: null,
        resolved: true,
        createdAt: 1000,
      });
      const reply = makeComment({
        id: 'reply',
        threadId: 'root',
        parentId: 'root',
        resolved: false,
        createdAt: 2000,
      });
      mockCtx.computeBridge.getAllComments.mockResolvedValue([root, reply]);

      const result = (await ws.list()) as any;

      expect(result[0].resolved).toBe(true);
      // Reply has explicit resolved: false, should not be overridden
      expect(result[1].resolved).toBe(false);
    });

    it('does not propagate when root has no resolved state', async () => {
      const root = makeComment({
        id: 'root',
        threadId: 'root',
        parentId: null,
        resolved: undefined,
        createdAt: 1000,
      });
      const reply = makeComment({
        id: 'reply',
        threadId: 'root',
        parentId: 'root',
        resolved: undefined,
        createdAt: 2000,
      });
      mockCtx.computeBridge.getAllComments.mockResolvedValue([root, reply]);

      const result = (await ws.list()) as any;

      expect(result[0].resolved).toBeUndefined();
      expect(result[1].resolved).toBeUndefined();
    });
  });
});

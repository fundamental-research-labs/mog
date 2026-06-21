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

function expectCommentMutationOptions(operationIdPrefix: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      author: expect.objectContaining({ actorKind: 'user' }),
      sheetIds: [SHEET_ID],
      domainIds: ['comments-notes'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

function mutationOptionsFrom(mockFn: jest.Mock, callIndex = 0): any {
  const call = mockFn.mock.calls[callIndex] as unknown[];
  return call[call.length - 1];
}

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
      getCellPosition: jest.fn(),
      convertNoteToThread: jest.fn(),
      deleteCommentsForCellByPosition: jest.fn(),
      clearAllComments: jest.fn(),
      validateAndCleanComments: jest.fn(),
      getNoteCount: jest.fn(),
      getAllNotes: jest.fn(),
      setNoteVisible: jest.fn(),
      setNoteDimensions: jest.fn(),
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

  describe('addNote()', () => {
    it('returns created note id alias', async () => {
      const created = makeComment({ id: 'note-new-1', commentType: 'note', threadId: null });
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([]);
      mockCtx.computeBridge.addCommentByPosition.mockResolvedValue({ data: created });

      const result = await ws.addNote('A1', { text: 'Note', author: 'Alice' });

      expect(result.id).toBe('note-new-1');
      expect(result.commentId).toBe('note-new-1');
      expect(result.comment.id).toBe('note-new-1');
      expect(mockCtx.computeBridge.addCommentByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        'Note',
        'Alice',
        null,
        null,
        'note',
        expectCommentMutationOptions('comment.addNote'),
      );
    });

    it('groups overwrite deletes with the created note', async () => {
      const oldNote = makeComment({ id: 'note-old-1', commentType: 'note', threadId: null });
      const oldThread = makeComment({ id: 'comment-old-1', threadId: 'comment-old-1' });
      const created = makeComment({ id: 'note-new-1', commentType: 'note', threadId: null });
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([oldNote, oldThread]);
      mockCtx.computeBridge.deleteComment.mockResolvedValue({});
      mockCtx.computeBridge.addCommentByPosition.mockResolvedValue({ data: created });

      await ws.addNote('A1', { text: 'Replacement', author: 'Alice' });

      expect(mockCtx.computeBridge.deleteComment).toHaveBeenCalledTimes(2);
      expect(mockCtx.computeBridge.deleteComment).toHaveBeenNthCalledWith(
        1,
        SHEET_ID,
        'note-old-1',
        expectCommentMutationOptions('comment.addNote'),
      );
      expect(mockCtx.computeBridge.deleteComment).toHaveBeenNthCalledWith(
        2,
        SHEET_ID,
        'comment-old-1',
        expectCommentMutationOptions('comment.addNote'),
      );
      const firstDeleteContext = mutationOptionsFrom(
        mockCtx.computeBridge.deleteComment,
        0,
      ).operationContext;
      const secondDeleteContext = mutationOptionsFrom(
        mockCtx.computeBridge.deleteComment,
        1,
      ).operationContext;
      const addContext = mutationOptionsFrom(
        mockCtx.computeBridge.addCommentByPosition,
      ).operationContext;
      expect(firstDeleteContext.groupId).toBe(firstDeleteContext.operationId);
      expect(secondDeleteContext.groupId).toBe(firstDeleteContext.groupId);
      expect(addContext.groupId).toBe(firstDeleteContext.groupId);
      expect(secondDeleteContext).not.toBe(firstDeleteContext);
      expect(addContext).not.toBe(firstDeleteContext);
      expect(secondDeleteContext.operationId).not.toBe(firstDeleteContext.operationId);
      expect(addContext.operationId).not.toBe(firstDeleteContext.operationId);
    });
  });

  describe('removeNote()', () => {
    it('groups multiple note deletes under one command group', async () => {
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([
        makeComment({ id: 'note-1', commentType: 'note', threadId: null }),
        makeComment({ id: 'note-2', commentType: 'note', threadId: null }),
      ]);
      mockCtx.computeBridge.deleteComment.mockResolvedValue({});

      const result = await ws.removeNote('A1');

      expect(result.kind).toBe('comment.removeNote');
      expect(mockCtx.computeBridge.deleteComment).toHaveBeenCalledTimes(2);
      expect(mockCtx.computeBridge.deleteComment).toHaveBeenNthCalledWith(
        1,
        SHEET_ID,
        'note-1',
        expectCommentMutationOptions('comment.removeNote'),
      );
      expect(mockCtx.computeBridge.deleteComment).toHaveBeenNthCalledWith(
        2,
        SHEET_ID,
        'note-2',
        expectCommentMutationOptions('comment.removeNote'),
      );
      const firstContext = mutationOptionsFrom(
        mockCtx.computeBridge.deleteComment,
        0,
      ).operationContext;
      const secondContext = mutationOptionsFrom(
        mockCtx.computeBridge.deleteComment,
        1,
      ).operationContext;
      expect(firstContext.groupId).toBe(firstContext.operationId);
      expect(secondContext.groupId).toBe(firstContext.groupId);
      expect(secondContext).not.toBe(firstContext);
      expect(secondContext.operationId).not.toBe(firstContext.operationId);
    });
  });

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
        expectCommentMutationOptions('comment.add'),
      );
      expect(result.kind).toBe('comment.add');
      expect(result.status).toBe('applied');
      expect(result.id).toBe('new-1');
      expect(result.commentId).toBe('new-1');
      expect(result.threadId).toBe('comment-1');
      expect(result.target).toEqual({
        sheetId: SHEET_ID,
        address: 'A1',
        range: 'A1',
        row: 0,
        col: 0,
      });
      expect(result.comment.id).toBe('new-1');
      expect(result.comment.content).toBe('Hello world');
      expect(result.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'createdObject', objectId: 'new-1' }),
          expect.objectContaining({ type: 'changedRange', range: 'A1' }),
        ]),
      );
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
        expectCommentMutationOptions('comment.add'),
      );
      expect(result.comment.id).toBe('new-2');
      expect(result.id).toBe('new-2');
      expect(result.commentId).toBe('new-2');
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
      mockCtx.computeBridge.addCommentByPosition.mockResolvedValue({ data: reply });

      const result = await ws.addReply('root-1', 'My reply', 'Bob');

      expect(mockCtx.computeBridge.addCommentByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        5,
        10,
        'My reply',
        'Bob',
        null,
        'root-1',
        'threadedComment',
        expectCommentMutationOptions('comment.addReply'),
      );
      expect(result.kind).toBe('comment.addReply');
      expect(result.id).toBe('reply-1');
      expect(result.commentId).toBe('reply-1');
      expect(result.comment.parentId).toBe('root-1');
      expect(result.comment.threadId).toBe('root-1');
      expect(result.parentId).toBe('root-1');
      expect(result.threadId).toBe('root-1');
      expect(result.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'createdObject', objectId: 'reply-1' }),
          expect.objectContaining({ type: 'changedRange', range: 'K6' }),
        ]),
      );
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
      mockCtx.computeBridge.addCommentByPosition.mockResolvedValue({ data: reply });

      const result = await ws.addReply('note-1', 'My reply', 'Bob');

      expect(mockCtx.computeBridge.convertNoteToThread).toHaveBeenCalledWith(
        SHEET_ID,
        'note-1',
        expectCommentMutationOptions('comment.convertNoteToThread'),
      );
      expect(mockCtx.computeBridge.addCommentByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        5,
        10,
        'My reply',
        'Bob',
        null,
        'note-1',
        'threadedComment',
        expectCommentMutationOptions('comment.addReply'),
      );
      const conversionContext = mutationOptionsFrom(
        mockCtx.computeBridge.convertNoteToThread,
      ).operationContext;
      const replyContext = mutationOptionsFrom(
        mockCtx.computeBridge.addCommentByPosition,
      ).operationContext;
      expect(conversionContext.groupId).toBe(conversionContext.operationId);
      expect(replyContext.groupId).toBe(conversionContext.groupId);
      expect(replyContext).not.toBe(conversionContext);
      expect(result.comment.parentId).toBe('note-1');
      expect(result.comment.threadId).toBe('note-1');
      expect(result.conversion).toEqual(
        expect.objectContaining({
          commentId: 'note-1',
          from: 'note',
          to: 'threadedComment',
        }),
      );
    });

    it('throws when parent comment not found', async () => {
      mockCtx.computeBridge.getComment.mockResolvedValue(null);

      await expect(ws.addReply('nonexistent', 'text', 'author')).rejects.toThrow(
        'Comment not found: nonexistent',
      );
    });
  });

  // =========================================================================
  // resolveThread()
  // =========================================================================

  describe('resolveThread()', () => {
    it('returns a receipt with updated thread comments', async () => {
      const root = makeComment({
        id: 'root-1',
        cellRef: '5:10',
        threadId: 'root-1',
        resolved: false,
      });
      const reply = makeComment({
        id: 'reply-1',
        cellRef: '5:10',
        parentId: 'root-1',
        threadId: 'root-1',
        resolved: false,
      });
      const resolvedRoot = makeComment({
        ...root,
        resolved: true,
      });
      const resolvedReply = makeComment({
        ...reply,
        resolved: true,
      });

      mockCtx.computeBridge.getCommentThread
        .mockResolvedValueOnce([root, reply])
        .mockResolvedValueOnce([resolvedRoot, resolvedReply]);
      mockCtx.computeBridge.setThreadResolved.mockResolvedValue({});

      const result = await ws.resolveThread('root-1', true);

      expect(mockCtx.computeBridge.setThreadResolved).toHaveBeenCalledWith(
        SHEET_ID,
        'root-1',
        true,
        expectCommentMutationOptions('comment.resolveThread'),
      );
      expect(result.kind).toBe('comment.resolveThread');
      expect(result.status).toBe('applied');
      expect(result.threadId).toBe('root-1');
      expect(result.resolved).toBe(true);
      expect(result.comment?.id).toBe('root-1');
      expect(result.comments?.map((comment) => comment.id)).toEqual(['root-1', 'reply-1']);
      expect(result.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'updatedObject', objectId: 'root-1' }),
          expect.objectContaining({ type: 'changedRange', range: 'K6', count: 2 }),
        ]),
      );
    });
  });

  // =========================================================================
  // update()
  // =========================================================================

  describe('update()', () => {
    it('passes mutation options to plain text updates', async () => {
      const existing = makeComment({ id: 'update-1', cellRef: '2:3' });
      const updated = makeComment({ ...existing, content: 'Updated', runs: [makeRun('Updated')] });
      mockCtx.computeBridge.getComment
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);
      mockCtx.computeBridge.updateComment.mockResolvedValue({});

      const result = await ws.update('update-1', { text: 'Updated' });

      expect(mockCtx.computeBridge.updateComment).toHaveBeenCalledWith(
        SHEET_ID,
        'update-1',
        'Updated',
        expectCommentMutationOptions('comment.update'),
      );
      expect(result.kind).toBe('comment.update');
      expect(result.status).toBe('applied');
    });

    it('passes mutation options to mention updates', async () => {
      const existing = makeComment({ id: 'update-mentions-1', cellRef: '2:3' });
      const mentions = [{ id: 'user-1', displayName: 'Alice', type: 'user' }] as any;
      mockCtx.computeBridge.getComment
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);
      mockCtx.computeBridge.updateCommentMentions = jest.fn().mockResolvedValue({});

      await ws.update('update-mentions-1', { text: '@Alice', mentions });

      expect(mockCtx.computeBridge.updateCommentMentions).toHaveBeenCalledWith(
        SHEET_ID,
        'update-mentions-1',
        '@Alice',
        mentions,
        expectCommentMutationOptions('comment.update'),
      );
    });
  });

  // =========================================================================
  // Note property updates
  // =========================================================================

  describe('note property updates', () => {
    it('passes mutation options when setting note visibility', async () => {
      const note = makeComment({ id: 'note-visible-1', commentType: 'note', threadId: null });
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([note]);
      mockCtx.computeBridge.setNoteVisible.mockResolvedValue({});
      mockCtx.computeBridge.getComment.mockResolvedValue({ ...note, visible: true });

      const result = await ws.setNoteVisible('A1', true);

      expect(mockCtx.computeBridge.setNoteVisible).toHaveBeenCalledWith(
        SHEET_ID,
        'note-visible-1',
        true,
        expectCommentMutationOptions('comment.updateNote'),
      );
      expect(result.kind).toBe('comment.updateNote');
      expect(result.status).toBe('applied');
    });

    it('passes mutation options when setting note dimensions', async () => {
      const note = makeComment({ id: 'note-height-1', commentType: 'note', threadId: null });
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([note]);
      mockCtx.computeBridge.setNoteDimensions.mockResolvedValue({});
      mockCtx.computeBridge.getComment.mockResolvedValue({ ...note, noteHeight: 120 });

      await ws.setNoteHeight('A1', 120);

      expect(mockCtx.computeBridge.setNoteDimensions).toHaveBeenCalledWith(
        SHEET_ID,
        'note-height-1',
        120,
        null,
        expectCommentMutationOptions('comment.updateNote'),
      );
    });
  });

  // =========================================================================
  // remove()
  // =========================================================================

  describe('remove()', () => {
    it('returns a receipt with removed comment details', async () => {
      const existing = makeComment({ id: 'remove-1', cellRef: '2:3', threadId: 'remove-1' });
      mockCtx.computeBridge.getComment.mockResolvedValue(existing);
      mockCtx.computeBridge.deleteComment.mockResolvedValue({});

      const result = await ws.remove('remove-1');

      expect(mockCtx.computeBridge.deleteComment).toHaveBeenCalledWith(
        SHEET_ID,
        'remove-1',
        expectCommentMutationOptions('comment.remove'),
      );
      expect(result.kind).toBe('comment.remove');
      expect(result.status).toBe('applied');
      expect(result.commentId).toBe('remove-1');
      expect(result.threadId).toBe('remove-1');
      expect(result.removedCount).toBe(1);
      expect(result.removedCommentIds).toEqual(['remove-1']);
      expect(result.target).toEqual({
        sheetId: SHEET_ID,
        address: 'D3',
        range: 'D3',
        row: 2,
        col: 3,
      });
      expect(result.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'removedObject', count: 1 }),
          expect.objectContaining({ type: 'changedRange', range: 'D3' }),
        ]),
      );
    });
  });

  // =========================================================================
  // removeForCell()
  // =========================================================================

  describe('removeForCell()', () => {
    it('returns the number of comments removed for a cell', async () => {
      const existing = makeComment({ id: 'cell-remove-1', cellRef: '2:3' });
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([existing]);
      mockCtx.computeBridge.deleteCommentsForCellByPosition.mockResolvedValue({ data: 1 });

      const result = await ws.removeForCell('D3');

      expect(mockCtx.computeBridge.getCommentsForCellByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        2,
        3,
      );
      expect(mockCtx.computeBridge.deleteCommentsForCellByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        2,
        3,
        expectCommentMutationOptions('comment.removeForCell'),
      );
      expect(result).toBe(1);
    });

    it('falls back to the pre-delete cell comment count when the bridge omits data', async () => {
      mockCtx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([
        makeComment({ id: 'cell-remove-1' }),
        makeComment({ id: 'cell-remove-2' }),
      ]);
      mockCtx.computeBridge.deleteCommentsForCellByPosition.mockResolvedValue({});

      const result = await ws.removeForCell(4, 5);

      expect(result).toBe(2);
    });
  });

  // =========================================================================
  // clean()
  // =========================================================================

  describe('clean()', () => {
    it('returns the bridge orphan cleanup count', async () => {
      mockCtx.computeBridge.getAllComments.mockResolvedValue([makeComment({ id: 'orphan-1' })]);
      mockCtx.computeBridge.validateAndCleanComments.mockResolvedValue({ data: 1 });

      const result = await ws.clean();

      expect(mockCtx.computeBridge.validateAndCleanComments).toHaveBeenCalledWith(
        SHEET_ID,
        expectCommentMutationOptions('comment.clean'),
      );
      expect(result).toBe(1);
    });

    it('falls back to before/after count delta when the bridge omits data', async () => {
      mockCtx.computeBridge.getAllComments
        .mockResolvedValueOnce([makeComment({ id: 'orphan-1' }), makeComment({ id: 'kept-1' })])
        .mockResolvedValueOnce([makeComment({ id: 'kept-1' })]);
      mockCtx.computeBridge.validateAndCleanComments.mockResolvedValue({});

      const result = await ws.clean();

      expect(result).toBe(1);
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

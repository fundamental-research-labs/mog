/**
 * WorksheetCommentsImpl — Implementation of the WorksheetComments sub-API.
 *
 * Calls computeBridge directly. All mutations throw on failure.
 */

import type {
  Comment,
  CommentUpdate,
  Note,
  SheetId,
  WorksheetComments,
} from '@mog-sdk/contracts/api';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import { extractMutationData } from '../../bridges/compute/compute-core';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { resolveCell, resolveCellArgs } from '../internal/address-resolver';

/**
 * Propagate resolved state from thread roots to replies.
 * Replies added after a thread was resolved may have `resolved: undefined`;
 * this ensures they inherit the root's resolved state.
 */
function propagateResolved(comments: Comment[]): Comment[] {
  // Build a map of threadId → root resolved state
  const rootResolved = new Map<string, boolean>();
  for (const c of comments) {
    if (!c.parentId && c.threadId && c.resolved !== undefined) {
      rootResolved.set(c.threadId, c.resolved);
    }
  }
  // Apply to replies that lack an explicit resolved value
  for (const c of comments) {
    if (c.parentId && c.threadId && c.resolved === undefined) {
      const inherited = rootResolved.get(c.threadId);
      if (inherited !== undefined) {
        c.resolved = inherited;
      }
    }
  }
  return comments;
}

function richTextToPlainText(comment: Comment): string {
  const candidate = comment as Comment & {
    content?: unknown;
    runs?: Array<{ text?: unknown }>;
  };
  if (typeof candidate.content === 'string') return candidate.content;
  if (Array.isArray(candidate.runs)) {
    return candidate.runs.map((run) => (typeof run.text === 'string' ? run.text : '')).join('');
  }
  return '';
}

function normalizeComment(comment: Comment): Comment {
  const content = richTextToPlainText(comment);
  if (!content || (comment as { content?: unknown }).content === content) {
    return normalizeComment(comment);
  }
  return { ...comment, content };
}

function normalizeComments(comments: Comment[]): Comment[] {
  return propagateResolved(comments.map(normalizeComment));
}

export class WorksheetCommentsImpl implements WorksheetComments {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  // ===========================================================================
  // Notes (simple, single string per cell)
  // ===========================================================================

  async addNote(cell: string, options: { text: string; author?: string }): Promise<void>;
  async addNote(
    row: number,
    col: number,
    options: { text: string; author?: string },
  ): Promise<void>;
  /** @deprecated Use the options-object overload instead. */
  async addNote(address: string, text: string, author?: string): Promise<void>;
  /** @deprecated Use the options-object overload instead. */
  async addNote(row: number, col: number, text: string, author?: string): Promise<void>;
  async addNote(
    a: string | number,
    b: string | number | { text: string; author?: string },
    c?: string | { text: string; author?: string },
    d?: string,
  ): Promise<void> {
    let row: number, col: number, text: string, author: string;
    if (typeof a === 'string' && typeof b === 'object') {
      // Options-object form: addNote("A1", { text, author })
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      text = b.text;
      author = b.author ?? 'api';
    } else if (typeof a === 'number' && typeof c === 'object') {
      // Options-object form: addNote(0, 0, { text, author })
      row = a;
      col = b as number;
      text = c.text;
      author = c.author ?? 'api';
    } else if (typeof a === 'string') {
      // Positional form: addNote("A1", "Hello", "Alice")
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      text = b as string;
      author = (c as string) ?? 'api';
    } else {
      // Positional form: addNote(0, 0, "Hello", "Alice")
      row = a;
      col = b as number;
      text = c as string;
      author = d ?? 'api';
    }
    // Remove existing notes before adding (overwrite semantics)
    const existing = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    for (const comment of existing) {
      if (comment.id) {
        await this.ctx.computeBridge.deleteComment(this.sheetId, comment.id);
      }
    }
    await this.ctx.computeBridge.addCommentByPosition(
      this.sheetId,
      row,
      col,
      text,
      author,
      null,
      null,
      'note',
    );
  }

  /** @deprecated Use {@link addNote} instead. */
  async setNote(
    a: string | number,
    b: string | number | { text: string; author?: string },
    c?: string | { text: string; author?: string },
    d?: string,
  ): Promise<void> {
    return this.addNote(a as any, b as any, c as any, d);
  }

  async getNote(a: string | number, b?: number): Promise<Note | null> {
    const { row, col } = resolveCell(a, b);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    if (comments.length === 0) return null;
    const first = comments[0];
    if (!first) return null;
    const content = richTextToPlainText(first);
    return {
      content,
      author: first.author,
      cellAddress: toA1(row, col),
      visible: first.visible ?? undefined,
      height: first.noteHeight ?? undefined,
      width: first.noteWidth ?? undefined,
    };
  }

  async removeNote(a: string | number, b?: number): Promise<void> {
    const { row, col } = resolveCell(a, b);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    for (const comment of comments) {
      if (comment.id) {
        await this.ctx.computeBridge.deleteComment(this.sheetId, comment.id);
      }
    }
  }

  // ===========================================================================
  // Threaded Comments
  // ===========================================================================

  async add(cell: string, options: { text: string; author?: string }): Promise<Comment>;
  async add(row: number, col: number, options: { text: string; author?: string }): Promise<Comment>;
  /** @deprecated Use the options-object overload instead. */
  async add(address: string, text: string, author: string): Promise<Comment>;
  /** @deprecated Use the options-object overload instead. */
  async add(row: number, col: number, text: string, author: string): Promise<Comment>;
  async add(
    a: string | number,
    b: string | number | { text: string; author?: string },
    c?: string | { text: string; author?: string },
    d?: string,
  ): Promise<Comment> {
    let row: number, col: number, text: string, author: string;
    if (typeof a === 'string' && typeof b === 'object') {
      // Options-object form: add("A1", { text, author })
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      text = b.text;
      author = b.author ?? 'api';
    } else if (typeof a === 'number' && typeof c === 'object') {
      // Options-object form: add(0, 0, { text, author })
      row = a;
      col = b as number;
      text = c.text;
      author = c.author ?? 'api';
    } else if (typeof a === 'string') {
      // Positional form: add("A1", "Hello", "Alice")
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      text = b as string;
      author = c as string;
    } else {
      // Positional form: add(0, 0, "Hello", "Alice")
      row = a;
      col = b as number;
      text = c as string;
      author = d!;
    }
    if (!text || text.trim().length === 0) {
      throw new KernelError('COMPUTE_ERROR', 'Comment text cannot be empty');
    }
    const result = await this.ctx.computeBridge.addCommentByPosition(
      this.sheetId,
      row,
      col,
      text,
      author,
      null,
      null,
      'threadedComment',
    );
    const comment = extractMutationData<Comment>(result);
    if (!comment) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'addCommentByPosition: no comment returned in MutationResult.data',
      );
    }
    return comment;
  }

  async update(commentId: string, updates: CommentUpdate): Promise<void> {
    const text = updates.text;
    if (text !== undefined && (!text || text.trim().length === 0)) {
      throw new KernelError('COMPUTE_ERROR', 'Comment text cannot be empty');
    }
    if (updates.mentions && updates.mentions.length > 0) {
      // Mentions path: sets content, content_type to Mention, and mentions array atomically
      if (!text) {
        throw new KernelError('COMPUTE_ERROR', 'Comment text is required when providing mentions');
      }
      await this.ctx.computeBridge.updateCommentMentions(
        this.sheetId,
        commentId,
        text,
        updates.mentions,
      );
    } else if (text !== undefined) {
      // Plain text update
      await this.ctx.computeBridge.updateComment(this.sheetId, commentId, text);
    }
  }

  async remove(commentId: string): Promise<void> {
    await this.ctx.computeBridge.deleteComment(this.sheetId, commentId);
  }

  async resolveThread(threadId: string, resolved: boolean): Promise<void> {
    await this.ctx.computeBridge.setThreadResolved(this.sheetId, threadId, resolved);
  }

  async getCount(): Promise<number> {
    return this.ctx.computeBridge.getCommentCount(this.sheetId);
  }

  // ===========================================================================
  // Note-specific queries
  // ===========================================================================

  async noteCount(): Promise<number> {
    return this.ctx.computeBridge.getNoteCount(this.sheetId);
  }

  async listNotes(): Promise<Note[]> {
    const comments = await this.ctx.computeBridge.getAllNotes(this.sheetId);
    return comments.map((c) => {
      const content = richTextToPlainText(c);
      return {
        content,
        author: c.author,
        cellAddress: c.cellRef,
        visible: c.visible ?? undefined,
        height: c.noteHeight ?? undefined,
        width: c.noteWidth ?? undefined,
      };
    });
  }

  async getNoteAt(index: number): Promise<Note | null> {
    const notes = await this.listNotes();
    return notes[index] ?? null;
  }

  async setNoteVisible(a: string | number, b: boolean | number, c?: boolean): Promise<void> {
    const { row, col, value: visible } = resolveCellArgs<boolean>(a, b, c);
    // Find the note at the given position
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    // Find the first note (comment with commentType === 'note')
    const note = comments.find((c) => c.commentType === 'note');
    if (note && note.id) {
      await this.ctx.computeBridge.setNoteVisible(this.sheetId, note.id, visible);
    }
  }

  async setNoteHeight(a: string | number, b: number, c?: number): Promise<void> {
    const { row, col, value: height } = resolveCellArgs<number>(a, b, c);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    const note = comments.find((c) => c.commentType === 'note');
    if (note?.id) {
      await this.ctx.computeBridge.setNoteDimensions(this.sheetId, note.id, height, null);
    }
  }

  async setNoteWidth(a: string | number, b: number, c?: number): Promise<void> {
    const { row, col, value: width } = resolveCellArgs<number>(a, b, c);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    const note = comments.find((c) => c.commentType === 'note');
    if (note?.id) {
      await this.ctx.computeBridge.setNoteDimensions(this.sheetId, note.id, null, width);
    }
  }

  async list(): Promise<Comment[]> {
    const comments = await this.ctx.computeBridge.getAllComments(this.sheetId);
    return normalizeComments(comments);
  }

  async getForCell(a: string | number, b?: number): Promise<Comment[]> {
    const { row, col } = resolveCell(a, b);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    return normalizeComments(comments);
  }

  async addReply(commentId: string, text: string, author: string): Promise<Comment> {
    const parent = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    if (!parent) {
      throw new KernelError('COMMENT_NOT_FOUND', `Comment not found: ${commentId}`);
    }
    if (!text || text.trim().length === 0) {
      throw new KernelError('COMPUTE_ERROR', 'Comment text cannot be empty');
    }
    const comment = await this.ctx.computeBridge.addComment(
      this.sheetId,
      parent.cellRef,
      text,
      author,
      { parentId: commentId, commentType: 'threadedComment' },
    );
    return normalizeComment(comment);
  }

  async convertNoteToThread(commentId: string): Promise<Comment> {
    const result = await this.ctx.computeBridge.convertNoteToThread(this.sheetId, commentId);
    const comment = extractMutationData<Comment>(result);
    if (!comment) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'convertNoteToThread: no comment returned in MutationResult.data',
      );
    }
    return normalizeComment(comment);
  }

  async getThread(commentId: string): Promise<Comment[]> {
    const comment = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    if (!comment) {
      return [];
    }
    const threadId = comment.threadId ?? comment.id;
    const thread = await this.ctx.computeBridge.getCommentThread(this.sheetId, threadId);
    return normalizeComments(thread);
  }

  async getById(commentId: string): Promise<Comment | null> {
    const comment = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    return comment ? normalizeComment(comment) : null;
  }

  async getLocation(commentId: string): Promise<string | null> {
    const comment = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    if (!comment) return null;

    const pos = await this.ctx.computeBridge.getCellPosition(this.sheetId, comment.cellRef);
    if (!pos) return null;

    return toA1(pos.row, pos.col);
  }

  async getParentByReplyId(replyId: string): Promise<Comment | null> {
    const reply = await this.getById(replyId);
    if (!reply?.parentId) return null;
    return this.getById(reply.parentId);
  }

  async getReplyCount(commentId: string): Promise<number> {
    const thread = await this.getThread(commentId);
    return Math.max(0, thread.length - 1);
  }

  async getReplyAt(commentId: string, index: number): Promise<Comment | null> {
    const thread = await this.getThread(commentId);
    // thread[0] is root, replies start at thread[1]
    return thread[index + 1] ?? null;
  }

  async getNoteLocation(a: string | number, b?: number): Promise<string | null> {
    const note = typeof a === 'number' ? await this.getNote(a, b!) : await this.getNote(a);
    return note?.cellAddress ?? null;
  }

  // ===========================================================================
  // Bulk / Query Operations
  // ===========================================================================

  async hasComment(a: string | number, b?: number): Promise<boolean> {
    if (typeof a === 'number') {
      return this.ctx.computeBridge.hasCommentsByPosition(this.sheetId, a, b!);
    }
    const { row, col } = resolveCell(a);
    return this.ctx.computeBridge.hasCommentsByPosition(this.sheetId, row, col);
  }

  async removeForCell(a: string | number, b?: number): Promise<number> {
    if (typeof a === 'number') {
      const result = await this.ctx.computeBridge.deleteCommentsForCellByPosition(
        this.sheetId,
        a,
        b!,
      );
      return (result.data as number) ?? 0;
    }
    const { row, col } = resolveCell(a);
    const result = await this.ctx.computeBridge.deleteCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    return (result.data as number) ?? 0;
  }

  async clear(): Promise<void> {
    await this.ctx.computeBridge.clearAllComments(this.sheetId);
  }

  async clean(): Promise<number> {
    const result = await this.ctx.computeBridge.validateAndCleanComments(this.sheetId);
    return (result.data as number) ?? 0;
  }
}

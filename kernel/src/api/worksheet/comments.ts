/**
 * WorksheetCommentsImpl — Implementation of the WorksheetComments sub-API.
 *
 * Calls computeBridge directly. All mutations throw on failure.
 */

import type {
  Comment,
  CommentAddReceipt,
  CommentConversionEffect,
  CommentMutationTarget,
  CommentRemoveReceipt,
  CommentUpdateReceipt,
  CommentUpdate,
  Note,
  SheetId,
  WorksheetComments,
} from '@mog-sdk/contracts/api';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type { MutationAdmissionOptions } from '../../bridges/compute';
import { extractMutationData } from '../../bridges/compute/compute-core';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { resolveCell, resolveCellArgs } from '../internal/address-resolver';
import { createVersionOperationContext } from '../internal/version-operation-context';
import {
  changedRangeEffect,
  commentObjectEffect,
  fallbackComment,
  removedCommentEffects,
  targetFromCellRef,
  targetFromPosition,
  worksheetTarget,
  worksheetUnchangedEffect,
} from './comments-receipts';

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
    return comment;
  }
  return { ...comment, content };
}

function normalizeComments(comments: Comment[]): Comment[] {
  return propagateResolved(comments.map(normalizeComment));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

type CommentMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

const COMMENTS_NOTES_DOMAIN_IDS = ['comments-notes'] as const;

export class WorksheetCommentsImpl implements WorksheetComments {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  private _commentMutationOptions(
    operationIdPrefix: string,
    groupId?: string,
  ): CommentMutationOptions {
    return {
      operationContext: createVersionOperationContext(this.ctx, {
        operationIdPrefix,
        sheetIds: [this.sheetId],
        domainIds: COMMENTS_NOTES_DOMAIN_IDS,
        ...(groupId ? { groupId } : {}),
      }),
    };
  }

  private _groupedCommentMutationOptions(operationIdPrefix: string): () => CommentMutationOptions {
    let nextOptions = ensureCommentMutationGroup(this._commentMutationOptions(operationIdPrefix));
    const groupId = nextOptions.operationContext.groupId;
    return () => {
      const options = nextOptions;
      nextOptions = this._commentMutationOptions(operationIdPrefix, groupId);
      return options;
    };
  }

  private async _targetForComment(comment: Comment): Promise<CommentMutationTarget> {
    const target = targetFromCellRef(this.sheetId, comment.cellRef);
    if (target.row !== undefined && target.col !== undefined) {
      return target;
    }
    try {
      const position = await this.ctx.computeBridge.getCellPosition(this.sheetId, comment.cellRef);
      if (position) {
        return targetFromPosition(this.sheetId, position.row, position.col);
      }
    } catch {
      // Fall back to the stable cellRef when the bridge cannot resolve a display address.
    }
    return target;
  }

  private async _positionForCommentWrite(comment: Comment): Promise<{ row: number; col: number }> {
    const target = targetFromCellRef(this.sheetId, comment.cellRef);
    if (target.row !== undefined && target.col !== undefined) {
      return { row: target.row, col: target.col };
    }
    const position = await this.ctx.computeBridge.getCellPosition(this.sheetId, comment.cellRef);
    if (position) {
      return { row: position.row, col: position.col };
    }
    throw new KernelError(
      'COMPUTE_ERROR',
      `Unable to resolve comment cell position for comment: ${comment.id}`,
    );
  }

  private async _updatedCommentReceipt(
    kind: CommentUpdateReceipt['kind'],
    comment: Comment,
    details?: Record<string, unknown>,
    extra?: Partial<
      Pick<CommentUpdateReceipt, 'comments' | 'commentIds' | 'resolved' | 'conversion' | 'threadId'>
    >,
  ): Promise<CommentUpdateReceipt> {
    const normalized = normalizeComment(comment);
    const target = await this._targetForComment(normalized);
    return {
      kind,
      status: 'applied',
      sheetId: this.sheetId,
      commentId: normalized.id,
      threadId: extra?.threadId ?? normalized.threadId,
      target,
      comment: normalized,
      effects: [
        commentObjectEffect('updatedObject', this.sheetId, normalized, details),
        changedRangeEffect(this.sheetId, target),
      ],
      diagnostics: [],
      ...extra,
    };
  }

  private _noOpUpdateReceipt(
    kind: CommentUpdateReceipt['kind'],
    input: {
      commentId?: string;
      threadId?: string | null;
      target?: CommentMutationTarget;
      comment?: Comment;
      resolved?: boolean;
    } = {},
  ): CommentUpdateReceipt {
    return {
      kind,
      status: 'noOp',
      sheetId: this.sheetId,
      commentId: input.commentId,
      threadId: input.threadId,
      target: input.target,
      comment: input.comment ? normalizeComment(input.comment) : undefined,
      resolved: input.resolved,
      effects: [worksheetUnchangedEffect(this.sheetId, input.target)],
      diagnostics: [],
    };
  }

  private _removeReceipt(
    kind: CommentRemoveReceipt['kind'],
    input: {
      target?: CommentMutationTarget;
      comments: Comment[];
      commentId?: string;
      threadId?: string | null;
    },
  ): CommentRemoveReceipt {
    const comments = normalizeComments(input.comments);
    const removedCommentIds = comments.map((comment) => comment.id);
    return {
      kind,
      status: removedCommentIds.length === 0 ? 'noOp' : 'applied',
      sheetId: this.sheetId,
      commentId: input.commentId,
      threadId: input.threadId,
      target: input.target,
      removedCount: removedCommentIds.length,
      removedCommentIds,
      comments,
      effects: removedCommentEffects(this.sheetId, input.target, removedCommentIds.length),
      diagnostics: [],
    };
  }

  // ===========================================================================
  // Notes (simple, single string per cell)
  // ===========================================================================

  async addNote(
    cell: string,
    options: { text: string; author?: string },
  ): Promise<CommentAddReceipt>;
  async addNote(
    row: number,
    col: number,
    options: { text: string; author?: string },
  ): Promise<CommentAddReceipt>;
  /** @deprecated Use the options-object overload instead. */
  async addNote(address: string, text: string, author?: string): Promise<CommentAddReceipt>;
  /** @deprecated Use the options-object overload instead. */
  async addNote(
    row: number,
    col: number,
    text: string,
    author?: string,
  ): Promise<CommentAddReceipt>;
  async addNote(
    a: string | number,
    b: string | number | { text: string; author?: string },
    c?: string | { text: string; author?: string },
    d?: string,
  ): Promise<CommentAddReceipt> {
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
    const existingCommentIds = existing.map((comment) => comment.id).filter(isNonEmptyString);
    const nextMutationOptions =
      existingCommentIds.length > 0
        ? this._groupedCommentMutationOptions('comment.addNote')
        : () => this._commentMutationOptions('comment.addNote');
    for (const commentId of existingCommentIds) {
      await this.ctx.computeBridge.deleteComment(this.sheetId, commentId, nextMutationOptions());
    }
    const result = await this.ctx.computeBridge.addCommentByPosition(
      this.sheetId,
      row,
      col,
      text,
      author,
      null,
      null,
      'note',
      nextMutationOptions(),
    );
    const comment =
      result == null
        ? fallbackComment({
            id: '',
            row,
            col,
            text,
            author,
            commentType: 'note',
          })
        : extractMutationData<Comment>(result);
    if (!comment) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'addCommentByPosition: no note returned in MutationResult.data',
      );
    }
    const normalized = normalizeComment(comment);
    const target = targetFromPosition(this.sheetId, row, col);
    const removedCommentIds = existingCommentIds;
    const effects = [
      ...(removedCommentIds.length > 0
        ? [
            {
              type: 'removedObject' as const,
              sheetId: this.sheetId,
              count: removedCommentIds.length,
              details: { objectType: 'comment' },
            },
          ]
        : []),
      commentObjectEffect('createdObject', this.sheetId, normalized),
      changedRangeEffect(this.sheetId, target, 1 + removedCommentIds.length),
    ];
    return {
      kind: 'comment.addNote',
      status: 'applied',
      sheetId: this.sheetId,
      id: normalized.id,
      commentId: normalized.id,
      threadId: normalized.threadId,
      target,
      comment: normalized,
      removedCommentIds,
      removedCount: removedCommentIds.length,
      effects,
      diagnostics: [],
    };
  }

  /** @deprecated Use {@link addNote} instead. */
  async setNote(
    a: string | number,
    b: string | number | { text: string; author?: string },
    c?: string | { text: string; author?: string },
    d?: string,
  ): Promise<CommentAddReceipt> {
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

  async removeNote(a: string | number, b?: number): Promise<CommentRemoveReceipt> {
    const { row, col } = resolveCell(a, b);
    const target = targetFromPosition(this.sheetId, row, col);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    const commentIds = comments.map((comment) => comment.id).filter(isNonEmptyString);
    const nextMutationOptions =
      commentIds.length > 1
        ? this._groupedCommentMutationOptions('comment.removeNote')
        : () => this._commentMutationOptions('comment.removeNote');
    for (const commentId of commentIds) {
      await this.ctx.computeBridge.deleteComment(this.sheetId, commentId, nextMutationOptions());
    }
    return this._removeReceipt('comment.removeNote', { target, comments });
  }

  // ===========================================================================
  // Threaded Comments
  // ===========================================================================

  async add(cell: string, options: { text: string; author?: string }): Promise<CommentAddReceipt>;
  async add(
    row: number,
    col: number,
    options: { text: string; author?: string },
  ): Promise<CommentAddReceipt>;
  /** @deprecated Use the options-object overload instead. */
  async add(address: string, text: string, author: string): Promise<CommentAddReceipt>;
  /** @deprecated Use the options-object overload instead. */
  async add(row: number, col: number, text: string, author: string): Promise<CommentAddReceipt>;
  async add(
    a: string | number,
    b: string | number | { text: string; author?: string },
    c?: string | { text: string; author?: string },
    d?: string,
  ): Promise<CommentAddReceipt> {
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
      this._commentMutationOptions('comment.add'),
    );
    const comment = extractMutationData<Comment>(result);
    if (!comment) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'addCommentByPosition: no comment returned in MutationResult.data',
      );
    }
    const normalized = normalizeComment(comment);
    const target = targetFromPosition(this.sheetId, row, col);
    return {
      kind: 'comment.add',
      status: 'applied',
      sheetId: this.sheetId,
      id: normalized.id,
      commentId: normalized.id,
      threadId: normalized.threadId,
      target,
      comment: normalized,
      effects: [
        commentObjectEffect('createdObject', this.sheetId, normalized),
        changedRangeEffect(this.sheetId, target),
      ],
      diagnostics: [],
    };
  }

  async update(commentId: string, updates: CommentUpdate): Promise<CommentUpdateReceipt> {
    const text = updates.text;
    if (text !== undefined && (!text || text.trim().length === 0)) {
      throw new KernelError('COMPUTE_ERROR', 'Comment text cannot be empty');
    }
    if (updates.mentions && updates.mentions.length > 0 && !text) {
      throw new KernelError('COMPUTE_ERROR', 'Comment text is required when providing mentions');
    }
    const existing = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    const target = existing ? await this._targetForComment(existing) : undefined;
    if (!existing || (text === undefined && (!updates.mentions || updates.mentions.length === 0))) {
      return this._noOpUpdateReceipt('comment.update', {
        commentId,
        threadId: existing?.threadId,
        target,
        comment: existing ?? undefined,
      });
    }
    if (updates.mentions && updates.mentions.length > 0) {
      // Mentions path: sets content, content_type to Mention, and mentions array atomically
      await this.ctx.computeBridge.updateCommentMentions(
        this.sheetId,
        commentId,
        text!,
        updates.mentions,
        this._commentMutationOptions('comment.update'),
      );
    } else if (text !== undefined) {
      // Plain text update
      await this.ctx.computeBridge.updateComment(
        this.sheetId,
        commentId,
        text,
        this._commentMutationOptions('comment.update'),
      );
    }
    const updated = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    return this._updatedCommentReceipt('comment.update', updated ?? existing, {
      updatedFields: {
        text: text !== undefined,
        mentions: Boolean(updates.mentions?.length),
      },
    });
  }

  async remove(commentId: string): Promise<CommentRemoveReceipt> {
    const existing = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    if (!existing) {
      return this._removeReceipt('comment.remove', { comments: [], commentId });
    }
    const target = await this._targetForComment(existing);
    await this.ctx.computeBridge.deleteComment(
      this.sheetId,
      commentId,
      this._commentMutationOptions('comment.remove'),
    );
    return this._removeReceipt('comment.remove', {
      target,
      comments: [existing],
      commentId,
      threadId: existing.threadId,
    });
  }

  async resolveThread(threadId: string, resolved: boolean): Promise<CommentUpdateReceipt> {
    const before = await this.ctx.computeBridge.getCommentThread(this.sheetId, threadId);
    if (before.length === 0) {
      return this._noOpUpdateReceipt('comment.resolveThread', {
        threadId,
        resolved,
      });
    }
    await this.ctx.computeBridge.setThreadResolved(
      this.sheetId,
      threadId,
      resolved,
      this._commentMutationOptions('comment.resolveThread'),
    );
    const comments = normalizeComments(
      await this.ctx.computeBridge.getCommentThread(this.sheetId, threadId),
    );
    const representative =
      comments.find((comment) => comment.id === threadId) ??
      comments[0] ??
      normalizeComment(before[0]!);
    const target = await this._targetForComment(representative);
    const commentIds = comments.map((comment) => comment.id);
    return {
      kind: 'comment.resolveThread',
      status: 'applied',
      sheetId: this.sheetId,
      commentId: representative.id,
      threadId,
      target,
      comment: representative,
      comments,
      commentIds,
      resolved,
      effects: [
        {
          type: 'updatedObject',
          sheetId: this.sheetId,
          objectId: threadId,
          details: {
            objectType: 'commentThread',
            resolved,
            commentIds,
          },
        },
        changedRangeEffect(this.sheetId, target, Math.max(1, comments.length)),
      ],
      diagnostics: [],
    };
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

  async setNoteVisible(
    a: string | number,
    b: boolean | number,
    c?: boolean,
  ): Promise<CommentUpdateReceipt> {
    const { row, col, value: visible } = resolveCellArgs<boolean>(a, b, c);
    const target = targetFromPosition(this.sheetId, row, col);
    // Find the note at the given position
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    // Find the first note (comment with commentType === 'note')
    const note = comments.find((c) => c.commentType === 'note');
    if (note && note.id) {
      await this.ctx.computeBridge.setNoteVisible(
        this.sheetId,
        note.id,
        visible,
        this._commentMutationOptions('comment.updateNote'),
      );
      const updated = (await this.ctx.computeBridge.getComment(this.sheetId, note.id)) ?? {
        ...note,
        visible,
      };
      return this._updatedCommentReceipt('comment.updateNote', updated, {
        noteProperty: 'visible',
      });
    }
    return this._noOpUpdateReceipt('comment.updateNote', { target });
  }

  async setNoteHeight(a: string | number, b: number, c?: number): Promise<CommentUpdateReceipt> {
    const { row, col, value: height } = resolveCellArgs<number>(a, b, c);
    const target = targetFromPosition(this.sheetId, row, col);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    const note = comments.find((c) => c.commentType === 'note');
    if (note?.id) {
      await this.ctx.computeBridge.setNoteDimensions(
        this.sheetId,
        note.id,
        height,
        null,
        this._commentMutationOptions('comment.updateNote'),
      );
      const updated = (await this.ctx.computeBridge.getComment(this.sheetId, note.id)) ?? {
        ...note,
        noteHeight: height,
      };
      return this._updatedCommentReceipt('comment.updateNote', updated, {
        noteProperty: 'height',
      });
    }
    return this._noOpUpdateReceipt('comment.updateNote', { target });
  }

  async setNoteWidth(a: string | number, b: number, c?: number): Promise<CommentUpdateReceipt> {
    const { row, col, value: width } = resolveCellArgs<number>(a, b, c);
    const target = targetFromPosition(this.sheetId, row, col);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    const note = comments.find((c) => c.commentType === 'note');
    if (note?.id) {
      await this.ctx.computeBridge.setNoteDimensions(
        this.sheetId,
        note.id,
        null,
        width,
        this._commentMutationOptions('comment.updateNote'),
      );
      const updated = (await this.ctx.computeBridge.getComment(this.sheetId, note.id)) ?? {
        ...note,
        noteWidth: width,
      };
      return this._updatedCommentReceipt('comment.updateNote', updated, {
        noteProperty: 'width',
      });
    }
    return this._noOpUpdateReceipt('comment.updateNote', { target });
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

  async addReply(commentId: string, text: string, author: string): Promise<CommentAddReceipt> {
    const parent = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    if (!parent) {
      throw new KernelError('COMMENT_NOT_FOUND', `Comment not found: ${commentId}`);
    }
    if (!text || text.trim().length === 0) {
      throw new KernelError('COMPUTE_ERROR', 'Comment text cannot be empty');
    }
    let replyGroupId: string | undefined;
    let conversionReceipt: CommentUpdateReceipt | undefined;
    if (parent.commentType === 'note') {
      const conversionOptions = ensureCommentMutationGroup(
        this._commentMutationOptions('comment.convertNoteToThread'),
      );
      replyGroupId = conversionOptions.operationContext.groupId;
      conversionReceipt = await this._convertNoteToThreadReceipt(commentId, conversionOptions);
    }
    const replyParent = conversionReceipt?.comment ?? parent;
    const position = await this._positionForCommentWrite(replyParent);
    const result = await this.ctx.computeBridge.addCommentByPosition(
      this.sheetId,
      position.row,
      position.col,
      text,
      author,
      null,
      replyParent.id,
      'threadedComment',
      this._commentMutationOptions('comment.addReply', replyGroupId),
    );
    const comment = extractMutationData<Comment>(result);
    if (!comment) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'addCommentByPosition: no reply returned in MutationResult.data',
      );
    }
    const normalized = normalizeComment(comment);
    const target = await this._targetForComment(normalized);
    return {
      kind: 'comment.addReply',
      status: 'applied',
      sheetId: this.sheetId,
      id: normalized.id,
      commentId: normalized.id,
      threadId: normalized.threadId,
      parentId: replyParent.id,
      target,
      comment: normalized,
      conversion: conversionReceipt?.conversion,
      effects: [
        ...(conversionReceipt ? [...conversionReceipt.effects] : []),
        commentObjectEffect('createdObject', this.sheetId, normalized),
        changedRangeEffect(this.sheetId, target),
      ],
      diagnostics: [],
    };
  }

  private async _convertNoteToThreadReceipt(
    commentId: string,
    mutationOptions?: CommentMutationOptions,
  ): Promise<CommentUpdateReceipt> {
    const before = await this.ctx.computeBridge.getComment(this.sheetId, commentId);
    if (before?.commentType === 'threadedComment') {
      const target = await this._targetForComment(before);
      return this._noOpUpdateReceipt('comment.convertNoteToThread', {
        commentId,
        threadId: before.threadId,
        target,
        comment: before,
      });
    }
    const result = await this.ctx.computeBridge.convertNoteToThread(
      this.sheetId,
      commentId,
      mutationOptions ?? this._commentMutationOptions('comment.convertNoteToThread'),
    );
    const comment = extractMutationData<Comment>(result);
    if (!comment) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'convertNoteToThread: no comment returned in MutationResult.data',
      );
    }
    const normalized = normalizeComment(comment);
    const target = await this._targetForComment(normalized);
    const conversion: CommentConversionEffect | undefined =
      before?.commentType === 'note'
        ? {
            commentId: normalized.id,
            from: 'note',
            to: 'threadedComment',
            comment: normalized,
            target,
          }
        : undefined;
    return this._updatedCommentReceipt(
      'comment.convertNoteToThread',
      normalized,
      {
        previousCommentType: before?.commentType,
        conversion: conversion ? { from: conversion.from, to: conversion.to } : undefined,
      },
      { conversion },
    );
  }

  async convertNoteToThread(commentId: string): Promise<CommentUpdateReceipt> {
    return this._convertNoteToThreadReceipt(commentId);
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
    const { row, col } = resolveCell(a, b);
    const comments = await this.ctx.computeBridge.getCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
    );
    const result = await this.ctx.computeBridge.deleteCommentsForCellByPosition(
      this.sheetId,
      row,
      col,
      this._commentMutationOptions('comment.removeForCell'),
    );
    return (result?.data as number | undefined) ?? comments.length;
  }

  async clear(): Promise<CommentRemoveReceipt> {
    const comments = await this.ctx.computeBridge.getAllComments(this.sheetId);
    await this.ctx.computeBridge.clearAllComments(
      this.sheetId,
      this._commentMutationOptions('comment.clear'),
    );
    return this._removeReceipt('comment.clear', {
      target: worksheetTarget(this.sheetId),
      comments,
    });
  }

  async clean(): Promise<number> {
    const before = await this.ctx.computeBridge.getAllComments(this.sheetId);
    const result = await this.ctx.computeBridge.validateAndCleanComments(
      this.sheetId,
      this._commentMutationOptions('comment.clean'),
    );
    const removedCount = result?.data;
    if (typeof removedCount === 'number') return removedCount;

    const after = await this.ctx.computeBridge.getAllComments(this.sheetId);
    return Math.max(0, before.length - after.length);
  }
}

function ensureCommentMutationGroup(options: CommentMutationOptions): CommentMutationOptions {
  const groupId = options.operationContext.groupId ?? options.operationContext.operationId;
  return {
    operationContext: {
      ...options.operationContext,
      groupId,
    },
  };
}

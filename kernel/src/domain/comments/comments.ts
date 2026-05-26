/**
 * Comments Domain Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 * - Orphan cleanup: handled by Rust during structure operations
 *
 * Cell Identity Model:
 * - Comments reference cells via CellId (stable UUID)
 * - Position resolved at render time via GridIndex.getPosition()
 *
 * @see compute-core/src/storage/comments.rs - Rust implementation
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { Comment } from '@mog-sdk/contracts/comments';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
import type { RichText } from '@mog-sdk/contracts/rich-text';

import type { Comment as BridgeComment } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';

/**
 * Map a bridge Comment (from Rust) to a contracts Comment (for UI).
 * Bridge has `runs: RichTextRun[]` + `content?: string`.
 * Contracts has `content: RichText` (array of segments with TextFormat).
 */
function fromBridgeComment(bc: BridgeComment): Comment {
  return {
    id: bc.id,
    cellRef: toCellId(bc.cellRef),
    author: bc.author,
    authorId: bc.authorId,
    createdAt: bc.createdAt ?? 0,
    modifiedAt: bc.modifiedAt ?? undefined,
    content: bc.runs.map((r) => ({
      text: r.text,
      format:
        r.bold || r.italic || r.underline || r.strikethrough || r.color
          ? {
              bold: r.bold || undefined,
              italic: r.italic || undefined,
              underlineType: r.underline ? ('single' as const) : undefined,
              strikethrough: r.strikethrough || undefined,
              fontColor: r.color ?? undefined,
            }
          : undefined,
    })),
    threadId: bc.threadId || undefined,
    parentId: bc.parentId ?? undefined,
    resolved: bc.resolved ?? undefined,
    commentType: bc.commentType,
  };
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get all comments for a cell.
 * Comments are sorted by createdAt timestamp.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - CellId to get comments for
 * @returns Promise of comments array, sorted by creation time
 */
export async function getCommentsForCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellId: CellId,
): Promise<Comment[]> {
  const bridge = await ctx.computeBridge.getCommentsForCell(sheetId, cellId);
  return bridge.map(fromBridgeComment);
}

/**
 * Get a single comment by ID.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param commentId - Comment ID
 * @returns The comment, or undefined if not found
 */
export async function getComment(
  ctx: DocumentContext,
  sheetId: SheetId,
  commentId: string,
): Promise<Comment | undefined> {
  const comment = await ctx.computeBridge.getComment(sheetId, commentId);
  return comment ? fromBridgeComment(comment) : undefined;
}

/**
 * Check if a cell has any comments.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - CellId to check
 * @returns True if cell has at least one comment
 */
export async function hasComments(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellId: CellId,
): Promise<boolean> {
  const comments = await ctx.computeBridge.getCommentsForCell(sheetId, cellId);
  return comments.length > 0;
}

/**
 * Get all comments in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise of all comments in the sheet
 */
export async function getAll(ctx: DocumentContext, sheetId: SheetId): Promise<Comment[]> {
  const bridge = await ctx.computeBridge.getAllComments(sheetId);
  return bridge.map(fromBridgeComment);
}

/**
 * Get all CellIds that have comments (for rendering indicators).
 * This is used by the cells layer to know which cells need comment triangles.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Set of CellIds that have comments
 */
export async function getCellIdsWithComments(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<Set<CellId>> {
  const all = await ctx.computeBridge.getAllComments(sheetId);
  const cellIds = new Set<CellId>();
  for (const comment of all) {
    cellIds.add(toCellId(comment.cellRef));
  }
  return cellIds;
}

/**
 * Get the count of comments in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Number of comments in the sheet
 */
export async function getCount(ctx: DocumentContext, sheetId: SheetId): Promise<number> {
  const all = await ctx.computeBridge.getAllComments(sheetId);
  return all.length;
}

/**
 * Get all comments in a thread.
 * A thread is identified by its root comment's ID (threadId).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param threadId - ID of the thread root comment
 * @returns Array of comments in the thread, sorted by creation time
 */
export async function getThread(
  ctx: DocumentContext,
  sheetId: SheetId,
  threadId: string,
): Promise<Comment[]> {
  const bridge = await ctx.computeBridge.getCommentThread(sheetId, threadId);
  return bridge.map(fromBridgeComment);
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Add a new comment to a cell.
 * Delegates to ComputeBridge; events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - CellId to attach comment to
 * @param content - Rich text content
 * @param author - Author display name
 * @param options - Optional: authorId, parentId for replies (handled by Rust)
 * @param _source - Origin of the change (handled by Rust)
 */
export async function addComment(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellId: CellId,
  content: RichText,
  author: string,
  options?: { authorId?: string; parentId?: string },
  _source: StructureChangeSource = 'user',
): Promise<Comment> {
  // Convert RichText to plain text for the bridge
  const text = content.map((segment) => segment.text).join('');
  const bridge = await ctx.computeBridge.addComment(sheetId, cellId, text, author, options);
  return fromBridgeComment(bridge);
}

/**
 * Update a comment's content.
 * Delegates to ComputeBridge; events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param commentId - Comment ID to update
 * @param content - New rich text content
 * @param _source - Origin of the change (handled by Rust)
 */
export function updateComment(
  ctx: DocumentContext,
  sheetId: SheetId,
  commentId: string,
  content: RichText,
  _source: StructureChangeSource = 'user',
): void {
  const text = content.map((segment) => segment.text).join('');
  void ctx.computeBridge.updateComment(sheetId, commentId, text);
}

/**
 * Delete a comment.
 * Delegates to ComputeBridge; events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param commentId - Comment ID to delete
 * @param _source - Origin of the change (handled by Rust)
 */
export function deleteComment(
  ctx: DocumentContext,
  sheetId: SheetId,
  commentId: string,
  _source: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.deleteComment(sheetId, commentId);
}

/**
 * Delete all comments for a cell.
 * Fetches comments for the cell, then deletes each via ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - CellId to delete comments from
 * @param _source - Origin of the change (handled by Rust)
 */
export function deleteCommentsForCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellId: CellId,
  _source: StructureChangeSource = 'user',
): void {
  void (async () => {
    const comments = await ctx.computeBridge.getCommentsForCell(sheetId, cellId);
    await Promise.all(
      comments.map((comment) => ctx.computeBridge.deleteComment(sheetId, comment.id)),
    );
  })();
}

/**
 * Resolve or unresolve a thread.
 * Delegates to ComputeBridge; events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param threadId - ID of the thread root comment
 * @param resolved - Whether the thread should be resolved
 * @param _source - Origin of the change (handled by Rust)
 */
export function setThreadResolved(
  ctx: DocumentContext,
  sheetId: SheetId,
  threadId: string,
  resolved: boolean,
  _source: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.setThreadResolved(sheetId, threadId, resolved);
}

/**
 * Clear all comments for a sheet.
 * Fetches all comments, then deletes each via ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _source - Origin of the change (handled by Rust)
 */
export function clearAll(
  ctx: DocumentContext,
  sheetId: SheetId,
  _source: StructureChangeSource = 'user',
): void {
  void (async () => {
    const comments = await ctx.computeBridge.getAllComments(sheetId);
    await Promise.all(
      comments.map((comment) => ctx.computeBridge.deleteComment(sheetId, comment.id)),
    );
  })();
}

// =============================================================================
// Validation Helpers (for orphaned comments)
// =============================================================================

/**
 * Validate and clean orphaned comments.
 *
 * In the ComputeBridge architecture, orphan cleanup is handled by Rust
 * during structure operations (deleteRows, deleteCols). This function
 * is a no-op stub kept for API compatibility with callers in structures.ts.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param _source - Origin of the change (unused)
 * @returns Always 0 (cleanup happens in Rust)
 */
export function validateAndClean(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _source: StructureChangeSource = 'user',
): number {
  // Orphan cleanup is handled by Rust compute-core during structure operations.
  // See compute-core/src/storage/comments.rs: validate_and_clean_comments()
  return 0;
}

// =============================================================================
// Subscribe to Comments
// =============================================================================

/**
 * Subscribe to comment changes for a sheet.
 * The callback receives all comments when any change occurs.
 *
 * NOTE: In the ComputeBridge architecture, subscriptions should be wired
 * through the MutationResult event system. This stub returns a no-op
 * unsubscribe for API compatibility.
 *
 * @param _ctx - Store context
 * @param _sheetId - Sheet ID
 * @param _callback - Called when comments change
 * @returns Unsubscribe function (no-op)
 */
export function subscribe(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _callback: (comments: Comment[]) => void,
): () => void {
  // In the ComputeBridge architecture, comment change notifications come
  // through MutationResult events, not CRDT observe. This is a compatibility stub.
  return () => {};
}

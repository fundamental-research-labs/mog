/**
 * WorksheetComments — Sub-API for comment and note operations.
 *
 * Provides methods for simple notes (single string per cell) and
 * threaded comments (multi-author, resolvable).
 */
import type { Comment, CommentUpdate, Note } from '../types';
// Comment is now the Rust-generated type (cellRef, runs, threadId: string | null, etc.)

/** Sub-API for comment and note operations on a worksheet. */
export interface WorksheetComments {
  // ===========================================================================
  // Notes (simple, single string per cell)
  // ===========================================================================

  /**
   * Add a note to a cell (options object form).
   *
   * @param cell - A1-style cell address (e.g. "A1")
   * @param options - Note text and optional author
   */
  addNote(cell: string, options: { text: string; author?: string }): Promise<void>;
  /**
   * Add a note to a cell (options object form).
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param options - Note text and optional author
   */
  addNote(row: number, col: number, options: { text: string; author?: string }): Promise<void>;
  /**
   * @deprecated Use the options-object overload instead.
   * Set the note for a cell (overwrites any existing note).
   *
   * @param address - A1-style cell address (e.g. "A1")
   * @param text - Note text
   * @param author - Optional author name (defaults to 'api')
   * @deprecated Use the options-object overload instead.
   */
  setNote(address: string, text: string, author?: string): Promise<void>;
  /**
   * Set the note for a cell (overwrites any existing note).
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param text - Note text
   * @param author - Optional author name (defaults to 'api')
   * @deprecated Use the options-object overload instead.
   */
  setNote(row: number, col: number, text: string, author?: string): Promise<void>;

  /**
   * Get the note for a cell as a Note object.
   *
   * @param address - A1-style cell address
   * @returns The Note object, or null if no note
   */
  getNote(address: string): Promise<Note | null>;
  /**
   * Get the note for a cell as a Note object.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The Note object, or null if no note
   */
  getNote(row: number, col: number): Promise<Note | null>;

  /**
   * Remove the note from a cell.
   *
   * @param address - A1-style cell address
   */
  removeNote(address: string): Promise<void>;
  /**
   * Remove the note from a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  removeNote(row: number, col: number): Promise<void>;

  /** Get the total number of comments (notes + threaded) on this worksheet. */
  getCount(): Promise<number>;

  // ===========================================================================
  // Note-specific queries
  // ===========================================================================

  /**
   * Get the number of notes (legacy comments) in the worksheet.
   *
   * @returns The count of notes only (excludes threaded comments)
   */
  noteCount(): Promise<number>;

  /**
   * List all notes (legacy comments) in the worksheet.
   *
   * @returns Array of notes
   */
  listNotes(): Promise<Note[]>;

  /**
   * Get a note by index from the list of all notes.
   *
   * @param index - Zero-based index into the notes list
   * @returns The Note at that index, or null if out of range
   */
  getNoteAt(index: number): Promise<Note | null>;

  /**
   * Set the visibility of a note at the given cell address.
   *
   * @param address - A1-style cell address
   * @param visible - Whether the note should be visible
   */
  setNoteVisible(address: string, visible: boolean): Promise<void>;
  /**
   * Set the visibility of a note at the given cell position.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param visible - Whether the note should be visible
   */
  setNoteVisible(row: number, col: number, visible: boolean): Promise<void>;

  /**
   * Set the height of a note callout box in points.
   *
   * @param address - A1-style cell address
   * @param height - Height in points
   */
  setNoteHeight(address: string, height: number): Promise<void>;
  /**
   * Set the height of a note callout box in points.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param height - Height in points
   */
  setNoteHeight(row: number, col: number, height: number): Promise<void>;

  /**
   * Set the width of a note callout box in points.
   *
   * @param address - A1-style cell address
   * @param width - Width in points
   */
  setNoteWidth(address: string, width: number): Promise<void>;
  /**
   * Set the width of a note callout box in points.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param width - Width in points
   */
  setNoteWidth(row: number, col: number, width: number): Promise<void>;

  // ===========================================================================
  // Threaded Comments
  // ===========================================================================

  /**
   * Add a threaded comment to a cell (options object form).
   *
   * @param cell - A1-style cell address
   * @param options - Comment text and optional author
   */
  add(cell: string, options: { text: string; author?: string }): Promise<Comment>;
  /**
   * Add a threaded comment to a cell (options object form).
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param options - Comment text and optional author
   */
  add(row: number, col: number, options: { text: string; author?: string }): Promise<Comment>;
  /**
   * Add a threaded comment to a cell.
   *
   * @param address - A1-style cell address
   * @param text - Comment text
   * @param author - Author name or identifier
   * @deprecated Use the options-object overload instead.
   */
  add(address: string, text: string, author: string): Promise<Comment>;
  /**
   * Add a threaded comment to a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param text - Comment text
   * @param author - Author name or identifier
   * @deprecated Use the options-object overload instead.
   */
  add(row: number, col: number, text: string, author: string): Promise<Comment>;

  /**
   * Update an existing comment.
   *
   * @param commentId - Comment identifier
   * @param updates - Object with fields to update (text, mentions, or both)
   */
  update(commentId: string, updates: CommentUpdate): Promise<void>;

  /**
   * Remove a threaded comment by ID.
   *
   * @param commentId - Comment identifier
   */
  remove(commentId: string): Promise<void>;

  /**
   * Set the resolved state of a comment thread.
   *
   * @param threadId - Thread identifier (cell ID)
   * @param resolved - Whether the thread should be marked as resolved
   */
  resolveThread(threadId: string, resolved: boolean): Promise<void>;

  /**
   * List all comments in the worksheet.
   *
   * @returns Array of all comments
   */
  list(): Promise<Comment[]>;

  /**
   * Get all comments for a specific cell.
   *
   * @param address - A1-style cell address
   * @returns Array of comments for the cell
   */
  getForCell(address: string): Promise<Comment[]>;
  /**
   * Get all comments for a specific cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Array of comments for the cell
   */
  getForCell(row: number, col: number): Promise<Comment[]>;

  /**
   * Add a reply to an existing comment.
   *
   * @param commentId - ID of the comment to reply to
   * @param text - Reply text
   * @param author - Author name or identifier
   * @returns The created reply comment
   */
  addReply(commentId: string, text: string, author: string): Promise<Comment>;

  /**
   * Convert a legacy note into a modern threaded comment.
   *
   * Flips `commentType` to `'threadedComment'`, clears note callout geometry
   * (`noteHeight`/`noteWidth`/`visible`/`shapeId`), and assigns `threadId`.
   * Idempotent on a comment that is already a threaded comment.
   *
   * @param commentId - ID of the note to convert
   * @returns The updated comment so the caller can re-render in thread mode
   */
  convertNoteToThread(commentId: string): Promise<Comment>;

  /**
   * Get all comments in a thread (root + replies), sorted by createdAt.
   *
   * @param commentId - ID of any comment in the thread
   * @returns Array of comments in the thread
   */
  getThread(commentId: string): Promise<Comment[]>;

  /**
   * Get a single comment by its ID.
   *
   * @param commentId - Comment identifier
   * @returns The comment, or null if not found
   */
  getById(commentId: string): Promise<Comment | null>;

  /**
   * Get the A1-style cell address for a comment.
   *
   * Resolves the comment's internal cell reference (CellId) to a
   * human-readable address like "A1", "B3", etc.
   *
   * @param commentId - Comment identifier
   * @returns The A1-style cell address, or null if the comment doesn't exist
   */
  getLocation(commentId: string): Promise<string | null>;

  /**
   * Get the parent comment for a reply.
   *
   * @param replyId - ID of the reply comment
   * @returns The parent comment, or null if not found or not a reply
   */
  getParentByReplyId(replyId: string): Promise<Comment | null>;

  /**
   * Get the number of replies in a thread (excluding the root comment).
   *
   * @param commentId - ID of any comment in the thread
   * @returns The reply count
   */
  getReplyCount(commentId: string): Promise<number>;

  /**
   * Get a reply at a specific index within a thread (zero-based, excludes root).
   *
   * @param commentId - ID of any comment in the thread
   * @param index - Zero-based index into the replies
   * @returns The reply comment, or null if out of range
   */
  getReplyAt(commentId: string, index: number): Promise<Comment | null>;

  /**
   * Get the A1-style cell address for a note.
   *
   * @param address - A1-style cell address
   * @returns The A1-style cell address, or null if no note exists at that address
   */
  getNoteLocation(address: string): Promise<string | null>;
  /**
   * Get the A1-style cell address for a note.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The A1-style cell address, or null if no note exists at that position
   */
  getNoteLocation(row: number, col: number): Promise<string | null>;

  // ===========================================================================
  // Bulk / Query Operations
  // ===========================================================================

  /**
   * Check if a cell has any comments.
   *
   * @param address - A1-style cell address
   * @returns True if the cell has at least one comment
   */
  hasComment(address: string): Promise<boolean>;
  /**
   * Check if a cell has any comments.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns True if the cell has at least one comment
   */
  hasComment(row: number, col: number): Promise<boolean>;

  /**
   * Remove all comments on a cell.
   *
   * @param address - A1-style cell address
   * @returns The number of comments removed
   */
  removeForCell(address: string): Promise<number>;
  /**
   * Remove all comments on a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The number of comments removed
   */
  removeForCell(row: number, col: number): Promise<number>;

  /**
   * Clear all comments on the worksheet.
   */
  clear(): Promise<void>;

  /**
   * Remove orphaned comments (comments referencing non-existent cells).
   *
   * @returns The number of orphaned comments removed
   */
  clean(): Promise<number>;
}

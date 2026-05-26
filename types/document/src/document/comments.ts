/**
 * Comments Types
 *
 * Defines the comment data model with threading support.
 * Comments are first-class entities with their own identity, history, and threading.
 *
 * Key design decisions:
 * - Comments reference cells via CellId (stable across structure changes)
 * - Content is RichText for formatting support
 * - Threading via parentId enables reply chains
 * - NO sheetId stored - it's implicit from SheetMaps location (like merges.ts)
 *
 * @see STREAM-C3-COMMENTS-RICHTEXT.md
 * @see docs/architecture/cell-identity.md
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { RichText } from '@mog/types-core/rich-text';

// =============================================================================
// Core Comment Types
// =============================================================================

/**
 * A comment attached to a cell.
 *
 * Design decisions:
 * - Comments reference cells via CellId (stable across structure changes)
 * - Content is RichText for formatting support
 * - Threading via parentId enables reply chains
 * - resolved flag supports review workflows
 * - NO sheetId stored - it's implicit from SheetMaps location (like merges.ts)
 *
 * @example
 * // Simple comment
 * {
 *   id: 'comment-123',
 *   cellRef: 'cell-456',
 *   author: 'Alice',
 *   createdAt: 1704240000000,
 *   content: [{ text: 'This looks correct' }],
 *   threadId: 'comment-123' // First comment is its own thread root
 * }
 *
 * @example
 * // Reply to a comment
 * {
 *   id: 'comment-789',
 *   cellRef: 'cell-456',
 *   author: 'Bob',
 *   createdAt: 1704240600000,
 *   content: [{ text: 'Thanks for checking!' }],
 *   threadId: 'comment-123', // Belongs to Alice's thread
 *   parentId: 'comment-123'  // Direct reply to Alice
 * }
 */
export interface Comment {
  /** Unique identifier (UUID v7 for ordering) */
  id: string;

  /** Cell this comment is attached to (stable CellId, not position) */
  cellRef: CellId;

  /** Comment author display name */
  author: string;

  /** Author's user ID (for collaboration) */
  authorId?: string;

  /** Creation timestamp (Unix ms) */
  createdAt: number;

  /** Last modification timestamp */
  modifiedAt?: number;

  /** Rich text content */
  content: RichText;

  /**
   * Thread ID for grouped comments.
   * The first comment in a thread uses its own ID as threadId.
   * Subsequent replies share the same threadId.
   */
  threadId?: string;

  /** Parent comment ID for replies */
  parentId?: string;

  /** Whether the thread is resolved */
  resolved?: boolean;

  /** Whether this is a legacy note or a modern threaded comment */
  commentType: 'note' | 'threadedComment';
}

/**
 * Legacy Excel "note" - simple text without threading.
 * For backwards compatibility with Excel notes (not threaded comments).
 *
 * Excel has two concepts:
 * - Notes: Simple text balloons (legacy, what Excel called "comments" pre-2019)
 * - Comments: Threaded discussions (what Excel now calls "comments")
 *
 * We primarily use Comment (threaded) but support CellNote for import/export.
 */
export interface CellNote {
  /** Note text content (plain text) */
  text: string;
  /** Author name (optional) */
  author?: string;
}

// =============================================================================
// UI Position Types
// =============================================================================

/**
 * Position for comment popover display.
 * Managed by coordinator as side effect, not stored in machine context.
 *
 * Following the "Machine Owns State, Coordinator Owns Execution" principle:
 * - Machine context stores targetCellId (what to show)
 * - Coordinator calculates position from renderer state (where to show)
 */
export interface CommentPopoverPosition {
  /** CellId the popover is anchored to */
  cellId: CellId;
  /** DOM rect of the anchor cell (for positioning calculations) */
  anchorRect: DOMRect;
  /** Preferred side for the popover */
  preferredSide: 'right' | 'bottom';
}

// =============================================================================
// Type Guards
// =============================================================================

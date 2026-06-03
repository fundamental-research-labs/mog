/**
 * Comment Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * ARCHITECTURE: Selectors are the single primitive for extraction logic.
 * - Snapshots compose selectors (no duplication)
 * - Accessors wrap selectors + getSnapshot() (no duplication)
 * - Hooks use selectors directly with useSelector (no duplication)
 *
 * @module @mog-sdk/contracts/actors/comment
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { RichText } from '@mog/types-core/rich-text';
import type { SheetId } from '@mog/types-core';

export type CommentComposeType = 'note' | 'threadedComment';

// =============================================================================
// STATE TYPE (minimal version for selectors)
// =============================================================================

/**
 * Target cell for comment operations.
 * Stores both CellId (for storage) and position (for popover positioning).
 */
export interface CommentTarget {
  /** Stable cell identifier */
  cellId: CellId;
  /** Sheet containing the cell */
  sheetId: SheetId;
  /** Row position (for popover positioning, resolved at event time) */
  row: number;
  /** Column position (for popover positioning, resolved at event time) */
  col: number;
}

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 * This is the input type for all selector functions.
 */
export interface CommentState {
  context: {
    /** Target cell for current operation (null when closed) */
    target: CommentTarget | null;
    /** Comment ID being edited (null when composing new or viewing) */
    editingCommentId: string | null;
    /** Draft content while editing/composing (rich text segments) */
    draftContent: RichText;
    /** Type of comment to create for the current compose session */
    composeCommentType: CommentComposeType;
    /** Comment ID pending deletion (in confirmingDelete state) */
    deletingCommentId: string | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

/**
 * CommentAccessor interface for handlers.
 * Mirrors selectors 1:1 with method names (get* prefix for values).
 *
 * This is the contract that handlers use to read comment state.
 * Implementation lives in engine/src/state/coordinator/actor-access/comment.ts
 */
export interface CommentAccessor {
  // ===========================================================================
  // Value Accessors (match value selectors)
  // ===========================================================================

  /** Get the target cell for comment operations */
  getTarget(): CommentTarget | null;

  /** Get the comment ID being edited (null when composing new or viewing) */
  getEditingCommentId(): string | null;

  /** Get the draft content while editing/composing */
  getDraftContent(): RichText;

  /** Get the comment type to create for the current compose session */
  getComposeCommentType(): CommentComposeType;

  /** Get the comment ID pending deletion */
  getDeletingCommentId(): string | null;

  // ===========================================================================
  // State Matching Accessors (match state selectors)
  // ===========================================================================

  /** Check if in closed state (no popover visible) */
  isClosed(): boolean;

  /** Check if in viewing state (showing existing comments, read-only) */
  isViewing(): boolean;

  /** Check if in composing state (writing a new comment) */
  isComposing(): boolean;

  /** Check if in editing state (editing an existing comment) */
  isEditing(): boolean;

  /** Check if in confirmingDelete state (showing delete confirmation) */
  isConfirmingDelete(): boolean;

  // ===========================================================================
  // Derived Accessors
  // ===========================================================================

  /** Check if popover should be visible (any state except closed) */
  isVisible(): boolean;

  /** Check if in an editing mode (composing or editing) */
  isInEditMode(): boolean;

  /** Check if draft has content (non-empty text) */
  hasDraftContent(): boolean;

  /** Get the current state name */
  getStateName(): 'closed' | 'viewing' | 'composing' | 'editing' | 'confirmingDelete';
}

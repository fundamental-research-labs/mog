/**
 * Comment Popover State Machine
 *
 * Manages the UI state for comment interactions (viewing, editing, composing).
 * This machine is PURE - it only manages popover state, not comment storage.
 * Comment CRUD operations are executed by the coordinator via the comments domain module.
 *
 * Key design principles:
 * 1. Machine is PURE - no DOM or Yjs access (coordinator handles all side effects)
 * 2. CellId-based - references cells by stable ID, not row/col position
 * 3. Popover positioning is NOT in machine context - coordinator owns positioning
 * 4. Rich text editing state is tracked for composing/editing modes
 *
 * State flow:
 * - closed: No popover visible
 * - viewing: Showing existing comment(s), read-only
 * - editing: Editing an existing comment
 * - composing: Writing a new comment
 * - confirmingDelete: Showing delete confirmation
 *
 * @see engine/src/state/store/domains/comments.ts
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import { assign, setup } from 'xstate';

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { RichText } from '@mog-sdk/contracts/rich-text';
// Note: commentSelectors from contracts use CommentState interface, which is compatible
// with the machine's SnapshotFrom type. We don't import CommentState here because we
// define our own CommentState export as SnapshotFrom<typeof commentMachine>.
import { commentSelectors } from '../../../selectors';

// =============================================================================
// TYPES
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
 * Comment machine context.
 */
export interface CommentContext {
  /** Target cell for current operation (null when closed) */
  target: CommentTarget | null;
  /** Comment ID being edited (null when composing new or viewing) */
  editingCommentId: string | null;
  /** Draft content while editing/composing (rich text segments) */
  draftContent: RichText;
  /** Comment ID pending deletion (in confirmingDelete state) */
  deletingCommentId: string | null;
}

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events for the comment machine.
 */
export type CommentEvent =
  // Navigation events
  | { type: 'HOVER_CELL'; target: CommentTarget }
  | { type: 'CLICK_CELL'; target: CommentTarget }
  | { type: 'LEAVE_CELL' }
  | { type: 'CLOSE' }
  // Action events
  | { type: 'START_COMPOSE' }
  | { type: 'START_EDIT'; commentId: string; content: RichText }
  | { type: 'UPDATE_DRAFT'; content: RichText }
  | { type: 'SAVE' }
  | { type: 'CANCEL' }
  | { type: 'REQUEST_DELETE'; commentId: string }
  | { type: 'CONFIRM_DELETE' }
  | { type: 'CANCEL_DELETE' }
  // Reply events
  | { type: 'START_REPLY'; threadId: string }
  // Resolve events
  | { type: 'RESOLVE_THREAD'; threadId: string };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the comment machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const CommentEvents = {
  hoverCell: (target: CommentTarget): CommentEvent => ({
    type: 'HOVER_CELL',
    target,
  }),

  clickCell: (target: CommentTarget): CommentEvent => ({
    type: 'CLICK_CELL',
    target,
  }),

  leaveCell: (): CommentEvent => ({
    type: 'LEAVE_CELL',
  }),

  close: (): CommentEvent => ({
    type: 'CLOSE',
  }),

  startCompose: (): CommentEvent => ({
    type: 'START_COMPOSE',
  }),

  startEdit: (commentId: string, content: RichText): CommentEvent => ({
    type: 'START_EDIT',
    commentId,
    content,
  }),

  updateDraft: (content: RichText): CommentEvent => ({
    type: 'UPDATE_DRAFT',
    content,
  }),

  save: (): CommentEvent => ({
    type: 'SAVE',
  }),

  cancel: (): CommentEvent => ({
    type: 'CANCEL',
  }),

  requestDelete: (commentId: string): CommentEvent => ({
    type: 'REQUEST_DELETE',
    commentId,
  }),

  confirmDelete: (): CommentEvent => ({
    type: 'CONFIRM_DELETE',
  }),

  cancelDelete: (): CommentEvent => ({
    type: 'CANCEL_DELETE',
  }),

  startReply: (threadId: string): CommentEvent => ({
    type: 'START_REPLY',
    threadId,
  }),

  resolveThread: (threadId: string): CommentEvent => ({
    type: 'RESOLVE_THREAD',
    threadId,
  }),
} as const;

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

const initialContext: CommentContext = {
  target: null,
  editingCommentId: null,
  draftContent: [],
  deletingCommentId: null,
};

// =============================================================================
// COMMENT MACHINE
// =============================================================================

export const commentMachine = setup({
  types: {
    context: {} as CommentContext,
    events: {} as CommentEvent,
  },
  guards: {
    /** Check if draft content is non-empty (has text) */
    hasDraftContent: ({ context }) => {
      return context.draftContent.some((segment) => segment.text.trim().length > 0);
    },

    /** Check if cell has comments (for transition to viewing vs composing) */
    cellHasComments: ({ event }) => {
      // This guard is evaluated by looking at the target
      // The coordinator will have set up this information
      // For now, we rely on the event type to determine behavior
      return event.type === 'HOVER_CELL' || event.type === 'CLICK_CELL';
    },
  },
  actions: {
    /** Set target cell */
    setTarget: assign({
      target: ({ event }) => {
        if (event.type === 'HOVER_CELL' || event.type === 'CLICK_CELL') {
          return event.target;
        }
        return null;
      },
    }),

    /** Clear target cell */
    clearTarget: assign({
      target: () => null,
    }),

    /** Start editing with existing content */
    setEditingComment: assign({
      editingCommentId: ({ event }) => {
        if (event.type === 'START_EDIT') {
          return event.commentId;
        }
        return null;
      },
      draftContent: ({ event }) => {
        if (event.type === 'START_EDIT') {
          return event.content;
        }
        return [];
      },
    }),

    /** Clear editing state */
    clearEditingComment: assign({
      editingCommentId: () => null,
      draftContent: () => [],
    }),

    /** Update draft content */
    updateDraft: assign({
      draftContent: ({ event }) => {
        if (event.type === 'UPDATE_DRAFT') {
          return event.content;
        }
        return [];
      },
    }),

    /** Initialize empty draft for new comment */
    initializeDraft: assign({
      draftContent: () => [],
    }),

    /** Set comment pending deletion */
    setDeletingComment: assign({
      deletingCommentId: ({ event }) => {
        if (event.type === 'REQUEST_DELETE') {
          return event.commentId;
        }
        return null;
      },
    }),

    /** Clear deleting state */
    clearDeletingComment: assign({
      deletingCommentId: () => null,
    }),

    /** Reset all context to initial state */
    resetContext: assign(() => initialContext),
  },
}).createMachine({
  id: 'comment',
  initial: 'closed',
  context: initialContext,

  states: {
    /**
     * CLOSED: No comment popover visible.
     * This is the default state.
     */
    closed: {
      on: {
        HOVER_CELL: {
          target: 'viewing',
          actions: 'setTarget',
        },
        CLICK_CELL: {
          target: 'viewing',
          actions: 'setTarget',
        },
      },
    },

    /**
     * VIEWING: Showing existing comment(s) in read-only mode.
     * User can edit, reply, resolve, or delete from here.
     */
    viewing: {
      on: {
        LEAVE_CELL: {
          target: 'closed',
          actions: 'clearTarget',
        },
        CLOSE: {
          target: 'closed',
          actions: 'clearTarget',
        },
        HOVER_CELL: {
          target: 'viewing',
          actions: 'setTarget',
        },
        CLICK_CELL: {
          target: 'viewing',
          actions: 'setTarget',
        },
        START_COMPOSE: {
          target: 'composing',
          actions: 'initializeDraft',
        },
        START_EDIT: {
          target: 'editing',
          actions: 'setEditingComment',
        },
        REQUEST_DELETE: {
          target: 'confirmingDelete',
          actions: 'setDeletingComment',
        },
        // RESOLVE_THREAD and START_REPLY are handled by coordinator as side effects
        // Machine stays in viewing state, coordinator executes the operation
      },
    },

    /**
     * COMPOSING: Writing a new comment.
     * Draft content is tracked in context.
     */
    composing: {
      on: {
        UPDATE_DRAFT: {
          actions: 'updateDraft',
        },
        SAVE: {
          // Coordinator will handle the actual save operation
          // On success, it will send CLOSE or transition back to viewing
          target: 'viewing',
          actions: 'clearEditingComment',
        },
        CANCEL: {
          target: 'viewing',
          actions: 'clearEditingComment',
        },
        CLOSE: {
          target: 'closed',
          actions: 'resetContext',
        },
      },
    },

    /**
     * EDITING: Editing an existing comment.
     * editingCommentId identifies which comment is being edited.
     */
    editing: {
      on: {
        UPDATE_DRAFT: {
          actions: 'updateDraft',
        },
        SAVE: {
          // Coordinator will handle the actual save operation
          target: 'viewing',
          actions: 'clearEditingComment',
        },
        CANCEL: {
          target: 'viewing',
          actions: 'clearEditingComment',
        },
        CLOSE: {
          target: 'closed',
          actions: 'resetContext',
        },
      },
    },

    /**
     * CONFIRMING_DELETE: Showing delete confirmation dialog.
     * deletingCommentId identifies which comment will be deleted.
     */
    confirmingDelete: {
      on: {
        CONFIRM_DELETE: {
          // Coordinator will handle the actual delete operation
          target: 'viewing',
          actions: 'clearDeletingComment',
        },
        CANCEL_DELETE: {
          target: 'viewing',
          actions: 'clearDeletingComment',
        },
        CLOSE: {
          target: 'closed',
          actions: 'resetContext',
        },
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPERS
// =============================================================================

/**
 * What the comment machine exposes to consumers.
 */
export interface CommentSnapshot {
  /** Current state name */
  state: 'closed' | 'viewing' | 'composing' | 'editing' | 'confirmingDelete';
  /** Target cell (null when closed) */
  target: CommentTarget | null;
  /** Whether popover should be visible */
  isVisible: boolean;
  /** Whether in an editing/composing mode */
  isEditing: boolean;
  /** Comment ID being edited (null if composing new) */
  editingCommentId: string | null;
  /** Current draft content */
  draftContent: RichText;
  /** Comment ID pending deletion */
  deletingCommentId: string | null;
}

/**
 * Get a normalized snapshot from the comment machine state.
 *
 * ARCHITECTURE: This function composes selectors (the single primitive).
 * All extraction logic is defined once in commentSelectors.
 */
export function getCommentSnapshot(snapshot: SnapshotFrom<typeof commentMachine>): CommentSnapshot {
  // Cast state to compatible type for selectors
  const s = snapshot as CommentState;

  return {
    state: commentSelectors.stateName(s),
    target: commentSelectors.target(s),
    isVisible: commentSelectors.isVisible(s),
    isEditing: commentSelectors.isInEditMode(s),
    editingCommentId: commentSelectors.editingCommentId(s),
    draftContent: commentSelectors.draftContent(s),
    deletingCommentId: commentSelectors.deletingCommentId(s),
  };
}

/**
 * Check if the machine is in a state where the popover should be shown.
 */
export function isPopoverVisible(snapshot: SnapshotFrom<typeof commentMachine>): boolean {
  return snapshot.value !== 'closed';
}

/**
 * Check if the machine is in an editing or composing state.
 */
export function isInEditMode(snapshot: SnapshotFrom<typeof commentMachine>): boolean {
  return snapshot.value === 'composing' || snapshot.value === 'editing';
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type CommentMachine = typeof commentMachine;
export type CommentActor = ActorRefFrom<typeof commentMachine>;
export type CommentState = SnapshotFrom<typeof commentMachine>;

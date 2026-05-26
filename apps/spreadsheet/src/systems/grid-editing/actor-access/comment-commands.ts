/**
 * Comment Command Factory
 *
 * Type-safe wrappers around actor.send() for comment state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/grid-editing/actor-access/comment-commands
 */

import type { CommentCommands, CommentTarget } from '@mog-sdk/contracts/actors';
import type { RichText } from '@mog-sdk/contracts/rich-text';

// =============================================================================
// TYPES
// =============================================================================

/** Minimal actor interface for sending events */
interface MinimalActor {
  send(event: any): void;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create comment commands from a comment actor.
 * Wraps actor.send() with type-safe methods for comment events.
 *
 * @param actor - The comment state machine actor
 * @returns CommentCommands interface implementation
 *
 * @see state-machines/src/comment-machine.ts for event definitions
 */
export function createCommentCommands(actor: MinimalActor): CommentCommands {
  return {
    // -------------------------------------------------------------------------
    // Navigation Events
    // -------------------------------------------------------------------------
    hoverCell: (target: CommentTarget) => actor.send({ type: 'HOVER_CELL', target }),

    clickCell: (target: CommentTarget) => actor.send({ type: 'CLICK_CELL', target }),

    leaveCell: () => actor.send({ type: 'LEAVE_CELL' }),

    close: () => actor.send({ type: 'CLOSE' }),

    // -------------------------------------------------------------------------
    // Action Events
    // -------------------------------------------------------------------------
    startCompose: () => actor.send({ type: 'START_COMPOSE' }),

    startEdit: (commentId: string, content: RichText) =>
      actor.send({ type: 'START_EDIT', commentId, content }),

    updateDraft: (content: RichText) => actor.send({ type: 'UPDATE_DRAFT', content }),

    save: () => actor.send({ type: 'SAVE' }),

    cancel: () => actor.send({ type: 'CANCEL' }),

    // -------------------------------------------------------------------------
    // Delete Events
    // -------------------------------------------------------------------------
    requestDelete: (commentId: string) => actor.send({ type: 'REQUEST_DELETE', commentId }),

    confirmDelete: () => actor.send({ type: 'CONFIRM_DELETE' }),

    cancelDelete: () => actor.send({ type: 'CANCEL_DELETE' }),

    // -------------------------------------------------------------------------
    // Reply Events
    // -------------------------------------------------------------------------
    startReply: (threadId: string) => actor.send({ type: 'START_REPLY', threadId }),

    // -------------------------------------------------------------------------
    // Resolve Events
    // -------------------------------------------------------------------------
    resolveThread: (threadId: string) => actor.send({ type: 'RESOLVE_THREAD', threadId }),
  };
}

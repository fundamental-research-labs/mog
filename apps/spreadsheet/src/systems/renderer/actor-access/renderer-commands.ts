/**
 * Renderer Command Factory
 *
 * Type-safe wrappers around actor.send() for renderer state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/renderer/actor-access/renderer-commands
 */

import type { RendererCommands } from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord, RenderPriority } from '@mog-sdk/contracts/rendering';

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
 * Create renderer commands from a renderer actor.
 * Wraps actor.send() with type-safe methods for renderer events.
 *
 * @param actor - The renderer state machine actor
 * @returns RendererCommands interface implementation
 *
 * @see state-machines/src/renderer-machine.ts for event definitions
 */
export function createRendererCommands(actor: MinimalActor): RendererCommands {
  return {
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    mount: (container: HTMLElement) => actor.send({ type: 'MOUNT', container }),

    layoutReady: (width: number, height: number) =>
      actor.send({ type: 'LAYOUT_READY', width, height }),

    initialized: (sheetId: string) => actor.send({ type: 'INITIALIZED', sheetId }),

    switchSheet: (sheetId: string) => actor.send({ type: 'SWITCH_SHEET', sheetId }),

    sheetSwitched: () => actor.send({ type: 'SHEET_SWITCHED' }),

    unmount: () => actor.send({ type: 'UNMOUNT' }),

    // -------------------------------------------------------------------------
    // Visibility
    // -------------------------------------------------------------------------
    suspend: () => actor.send({ type: 'SUSPEND' }),

    resume: () => actor.send({ type: 'RESUME' }),

    // -------------------------------------------------------------------------
    // Error Handling
    // -------------------------------------------------------------------------
    reportError: (error: Error) => actor.send({ type: 'ERROR', error }),

    retry: () => actor.send({ type: 'RETRY' }),

    // -------------------------------------------------------------------------
    // Rendering Operations
    // -------------------------------------------------------------------------
    resize: (width: number, height: number) => actor.send({ type: 'RESIZE', width, height }),

    invalidate: (priority: RenderPriority, regions?: CellRange[]) =>
      actor.send({ type: 'INVALIDATE', priority, regions }),

    scrollToActiveCell: (cell: CellCoord) => actor.send({ type: 'SCROLL_TO_ACTIVE_CELL', cell }),
  };
}

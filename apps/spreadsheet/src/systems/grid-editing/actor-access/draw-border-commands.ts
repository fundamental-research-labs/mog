/**
 * Draw Border Command Factory
 *
 * Type-safe wrappers around actor.send() for draw border state machine events.
 *
 * Extracted from coordinator/actor-access/draw-border.ts
 *
 * @module systems/grid-editing/actor-access/draw-border-commands
 */

import type { DrawBorderCommands, DrawBorderStyleConfig } from '@mog-sdk/contracts/actors';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

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
 * Create draw border commands from a draw border actor.
 * Wraps actor.send() with type-safe methods for draw border events.
 *
 * @param actor - The draw border state machine actor
 * @returns DrawBorderCommands interface implementation
 *
 * @see state-machines/src/draw-border-machine.ts for event definitions
 */
export function createDrawBorderCommands(actor: MinimalActor): DrawBorderCommands {
  return {
    // -------------------------------------------------------------------------
    // Activation
    // -------------------------------------------------------------------------
    activateDrawBorder: (borderStyle: DrawBorderStyleConfig, sheetId: string) =>
      actor.send({ type: 'ACTIVATE_DRAW_BORDER', borderStyle, sheetId }),

    activateDrawBorderGrid: (borderStyle: DrawBorderStyleConfig, sheetId: string) =>
      actor.send({ type: 'ACTIVATE_DRAW_BORDER_GRID', borderStyle, sheetId }),

    activateEraseBorder: (sheetId: string) =>
      actor.send({ type: 'ACTIVATE_ERASE_BORDER', sheetId }),

    // -------------------------------------------------------------------------
    // Drawing Operations
    // -------------------------------------------------------------------------
    mouseDown: (cell: CellCoord) => actor.send({ type: 'MOUSE_DOWN', cell }),

    mouseMove: (cell: CellCoord) => actor.send({ type: 'MOUSE_MOVE', cell }),

    mouseUp: () => actor.send({ type: 'MOUSE_UP' }),

    // -------------------------------------------------------------------------
    // Deactivation
    // -------------------------------------------------------------------------
    cancel: () => actor.send({ type: 'CANCEL' }),

    deactivate: () => actor.send({ type: 'DEACTIVATE' }),
  };
}

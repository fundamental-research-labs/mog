/**
 * Clipboard Command Factory
 *
 * Type-safe wrappers around actor.send() for clipboard state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/grid-editing/actor-access/clipboard-commands
 */

import type {
  ClipboardCommands,
  ExternalPastePayload,
  PasteOption,
} from '@mog-sdk/contracts/actors';
import type { ClipboardData, PasteSpecialOptions } from '@mog-sdk/contracts/actors/clipboard';
import type { CellRange } from '@mog-sdk/contracts/core';
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
 * Create clipboard commands from a clipboard actor.
 * Wraps actor.send() with type-safe methods for clipboard events.
 *
 * @param actor - The clipboard state machine actor
 * @returns ClipboardCommands interface implementation
 *
 * @see state-machines/src/clipboard-machine.ts for event definitions
 */
export function createClipboardCommands(actor: MinimalActor): ClipboardCommands {
  return {
    // -------------------------------------------------------------------------
    // Data-accepting methods (for integration layer)
    // -------------------------------------------------------------------------
    copy: (ranges: CellRange[], data: ClipboardData) => actor.send({ type: 'COPY', ranges, data }),

    cut: (ranges: CellRange[], data: ClipboardData) => actor.send({ type: 'CUT', ranges, data }),

    paste: (targetCell: CellCoord, skipSizeCheck?: boolean, skipOverwriteCheck?: boolean) =>
      actor.send({ type: 'PASTE', targetCell, skipSizeCheck, skipOverwriteCheck }),

    pasteSpecial: (
      targetCell: CellCoord,
      options: PasteSpecialOptions,
      skipSizeCheck?: boolean,
      skipOverwriteCheck?: boolean,
    ) =>
      actor.send({
        type: 'PASTE_SPECIAL',
        targetCell,
        options,
        skipSizeCheck,
        skipOverwriteCheck,
      }),

    // -------------------------------------------------------------------------
    // Data-less trigger methods (for handlers)
    // The clipboard machine's integration layer handles gathering data.
    // -------------------------------------------------------------------------
    triggerCopy: () => actor.send({ type: 'COPY' }),

    triggerCut: () => actor.send({ type: 'CUT' }),

    triggerPaste: (option?: PasteOption) => actor.send({ type: 'PASTE', option }),

    // -------------------------------------------------------------------------
    // Other methods
    // -------------------------------------------------------------------------
    showPastePreview: (targetCell: CellCoord) =>
      actor.send({ type: 'SHOW_PASTE_PREVIEW', targetCell }),

    hidePastePreview: () => actor.send({ type: 'HIDE_PASTE_PREVIEW' }),

    pasteComplete: () => actor.send({ type: 'PASTE_COMPLETE' }),

    pasteError: (message: string) => actor.send({ type: 'PASTE_ERROR', message }),

    invalidateCut: () => actor.send({ type: 'INVALIDATE_CUT' }),

    clear: () => actor.send({ type: 'CLEAR' }),

    externalPaste: (payload: ExternalPastePayload) =>
      actor.send({ type: 'EXTERNAL_PASTE', ...payload }),

    editModeCopy: (text: string) => actor.send({ type: 'EDIT_MODE_COPY', text }),

    tickMarchingAnts: () => actor.send({ type: 'TICK_MARCHING_ANTS' }),

    structureChange: (
      sheetId: string,
      change: {
        type: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
        index: number;
        count: number;
      },
    ) => actor.send({ type: 'STRUCTURE_CHANGE', sheetId, change }),

    cellEdit: () => actor.send({ type: 'CELL_EDIT' }),

    focusLost: () => actor.send({ type: 'FOCUS_LOST' }),

    pasteWithOption: (option: PasteOption, range: CellRange, sheetId: string) =>
      actor.send({ type: 'PASTE_WITH_OPTION', option, range, sheetId }),
  };
}

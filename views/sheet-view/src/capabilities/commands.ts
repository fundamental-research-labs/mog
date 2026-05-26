/**
 * Commands Capability Implementation
 *
 * Provides the ISheetViewCommands capability interface.
 * Dispatches view-level commands to the appropriate internal SheetView methods.
 *
 * @module @mog-sdk/sheet-view/capabilities/commands
 */

import type { ISheetViewCommands } from '../capability-interfaces';
import type { SheetViewCommand } from '../public-types';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface CommandsInternals {
  scrollTo(row: number, col: number): void;
  setZoom(zoom: number): void;
  setFrozenPanes(rows: number, cols: number): void;
  switchSheet(sheetId: string): void;
  invalidateAll(): void;
}

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewCommands implements ISheetViewCommands {
  constructor(private readonly _internals: CommandsInternals) {}

  dispatch(command: SheetViewCommand): void {
    switch (command.type) {
      case 'scroll-to-cell':
        this._internals.scrollTo(command.cell.row, command.cell.col);
        break;

      case 'set-zoom':
        this._internals.setZoom(command.zoom);
        break;

      case 'set-frozen-panes':
        this._internals.setFrozenPanes(command.rows, command.cols);
        break;

      case 'switch-sheet':
        this._internals.switchSheet(command.sheetId);
        break;

      case 'invalidate-all':
        this._internals.invalidateAll();
        break;

      default: {
        // Exhaustiveness — future command types will cause a compile error.
        const _exhaustive: never = command;
        void _exhaustive;
      }
    }
  }
}

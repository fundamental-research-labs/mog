/**
 * WorkbookSheets — Sub-API for sheet management operations.
 *
 * Provides namespaced access to sheet lifecycle operations:
 * add, remove, move, rename, copy, hide, show, and selection.
 *
 * Usage: `workbook.sheets.add("Revenue")` instead of `workbook.addSheet("Revenue")`
 */
import type { CallableDisposable } from '@mog/types-core/disposable';
import type { Worksheet } from '../worksheet';
import type { SheetsCollectionEventMap } from '../types';
import type {
  SheetHideReceipt,
  SheetMoveReceipt,
  SheetRemoveReceipt,
  SheetRenameReceipt,
  SheetShowReceipt,
} from '../mutation-receipt';

export interface WorkbookSheets {
  /**
   * Add a new sheet to the workbook.
   * @param name - Optional sheet name. Defaults to "SheetN".
   * @param index - Optional 0-based position to insert the sheet.
   * @returns The created Worksheet.
   */
  add(name?: string, index?: number): Promise<Worksheet>;

  /**
   * Remove a sheet by index or name.
   * Throws if attempting to remove the last sheet.
   * @param target - 0-based index or sheet name.
   */
  remove(target: number | string): Promise<SheetRemoveReceipt>;

  /**
   * Move a sheet to a new position.
   * @param target - 0-based index or sheet name to move.
   * @param toIndex - Target 0-based index.
   */
  move(target: number | string, toIndex: number): Promise<SheetMoveReceipt>;

  /**
   * Rename a sheet.
   * @param target - 0-based index or current sheet name.
   * @param newName - The new name for the sheet.
   */
  rename(target: number | string, newName: string): Promise<SheetRenameReceipt>;

  /**
   * Set the active sheet.
   * @param target - 0-based index or sheet name.
   */
  setActive(target: number | string): void | Promise<void>;

  /**
   * Copy a sheet within the workbook.
   * @param source - 0-based index or name of the sheet to copy.
   * @param newName - Optional name for the copy. Defaults to "SheetName (Copy)".
   * @param index - Optional 0-based position for the copy.
   * @returns The newly created Worksheet.
   */
  copy(source: number | string, newName?: string, index?: number): Promise<Worksheet>;

  /**
   * Hide a sheet.
   * Throws if attempting to hide the last visible sheet.
   * @param target - 0-based index or sheet name.
   */
  hide(target: number | string): Promise<SheetHideReceipt>;

  /**
   * Show (unhide) a sheet.
   * @param target - 0-based index or sheet name.
   */
  show(target: number | string): Promise<SheetShowReceipt>;

  /**
   * Set which sheets are selected (multi-sheet selection for collaboration).
   * @param sheetIds - Array of sheet IDs to mark as selected.
   */
  setSelectedIds(sheetIds: string[]): Promise<void>;

  /**
   * Subscribe to sheet collection events.
   * Fires for: sheetAdded, sheetRemoved, sheetRenamed, activeSheetChanged.
   *
   * @param event - Event type
   * @param handler - Event handler receiving the typed internal event
   * @returns CallableDisposable — call directly or `.dispose()` to unsubscribe
   */
  on<K extends keyof SheetsCollectionEventMap>(
    event: K,
    handler: (event: SheetsCollectionEventMap[K]) => void,
  ): CallableDisposable;
  on(event: string, handler: (event: unknown) => void): CallableDisposable;
}

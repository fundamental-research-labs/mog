/**
 * WorkbookStateProvider — UI state abstraction for the Workbook API.
 *
 * Decouples WorkbookImpl from specific UI frameworks by injecting
 * active-sheet tracking, selection, and active-object queries via
 * a single interface.
 *
 * In headless / SDK contexts, the default provider manages activeSheetId
 * internally and returns null for all UI state queries.
 *
 * In browser contexts, the shell injects a provider that delegates to
 * the real selection model and document manager.
 */
export interface WorkbookStateProvider {
  /** Get the currently active sheet ID. */
  getActiveSheetId(): string;

  /** Set the active sheet ID. */
  setActiveSheetId(sheetId: string): void;

  /** Active cell position. Returns null in headless/no-UI contexts. */
  getActiveCell(): { sheetId: string; row: number; col: number } | null;

  /** Currently selected range(s) as A1 address strings. Returns [] in headless. */
  getSelectedRanges(): string[];

  /** Active floating object ID, or null. */
  getActiveObjectId(): string | null;

  /** Active floating object type, or null. */
  getActiveObjectType(): 'chart' | 'shape' | 'slicer' | 'picture' | null;
}

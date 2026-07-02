/**
 * WorksheetAnnotations - Sub-API for source annotations.
 *
 * Annotations are review/check notes anchored to the current value or shape
 * of a cell or table. They are intentionally separate from spreadsheet
 * comments and notes.
 */

import type { CellRange } from '../types';

export type WorksheetAnnotationStatus = 'fresh' | 'stale' | 'unchecked';

export type WorksheetAnnotationFingerprintProfile =
  | 'cellFormula'
  | 'cellValue'
  | 'cellText'
  | 'cellBlank'
  | 'tableSchema'
  | 'tableShape';

export interface WorksheetAnnotationFingerprint {
  readonly profile: WorksheetAnnotationFingerprintProfile;
  readonly canonicalizer: string;
  readonly hash: string;
}

export interface WorksheetAnnotationRecord {
  readonly schemaVersion: number;
  readonly id: string;
  readonly anchorId: string;
  readonly text: string;
  readonly status: WorksheetAnnotationStatus;
  readonly staleReason?: string;
  readonly fingerprint: WorksheetAnnotationFingerprint;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly checkedAt?: number;
}

export interface WorksheetAnnotationDeleteResult {
  readonly anchorId: string;
  readonly removed: boolean;
  readonly annotation?: WorksheetAnnotationRecord;
}

export type WorksheetAnnotationReadValidationMode = 'lazy' | 'force';

export interface WorksheetAnnotationReadOptions {
  readonly validate?: WorksheetAnnotationReadValidationMode;
}

export interface WorksheetAnnotationListOptions extends WorksheetAnnotationReadOptions {
  readonly limit?: number;
}

export interface WorksheetAnnotationDiagnosticReadOptions {
  readonly includeStale?: boolean;
  readonly includeUnchecked?: boolean;
  readonly includeFingerprint?: boolean;
  readonly validate?: WorksheetAnnotationReadValidationMode | 'skip';
}

export interface WorksheetAnnotationView {
  readonly id: string;
  readonly anchorId: string;
  readonly status: WorksheetAnnotationStatus;
  readonly text?: string;
  readonly staleReason?: string;
  readonly updatedAt: number;
  readonly checkedAt?: number;
}

export type WorksheetCellAnnotationRef =
  | string
  | {
      readonly row: number;
      readonly col: number;
    };

export interface WorksheetCellAnnotationRecord extends WorksheetAnnotationRecord {
  readonly row?: number;
  readonly col?: number;
  readonly currentRef?: string;
}

export interface WorksheetCellAnnotationView extends WorksheetAnnotationView {
  readonly row?: number;
  readonly col?: number;
  readonly currentRef?: string;
}

export interface WorksheetCellAnnotationDeleteResult extends Omit<
  WorksheetAnnotationDeleteResult,
  'annotation'
> {
  readonly annotation?: WorksheetCellAnnotationRecord;
}

export interface WorksheetCellAnnotationWriteEntry {
  readonly ref: WorksheetCellAnnotationRef;
  readonly text: string;
}

export interface WorksheetCellAnnotationListOptions extends WorksheetAnnotationListOptions {
  readonly range?: string | CellRange;
}

export interface WorksheetCellAnnotationDiagnosticListOptions extends WorksheetAnnotationDiagnosticReadOptions {
  readonly range?: string | CellRange;
  readonly limit?: number;
}

export interface WorksheetCellAnnotationDiagnostics {
  get(
    ref: WorksheetCellAnnotationRef,
    options?: WorksheetAnnotationDiagnosticReadOptions,
  ): Promise<WorksheetCellAnnotationRecord | null>;
  get(
    row: number,
    col: number,
    options?: WorksheetAnnotationDiagnosticReadOptions,
  ): Promise<WorksheetCellAnnotationRecord | null>;
  list(
    options?: WorksheetCellAnnotationDiagnosticListOptions,
  ): Promise<WorksheetCellAnnotationRecord[]>;
}

/** Cell annotation operations for agents and first-party UI. */
export interface WorksheetCellAnnotations {
  set(ref: WorksheetCellAnnotationRef, text: string): Promise<WorksheetCellAnnotationRecord>;
  set(row: number, col: number, text: string): Promise<WorksheetCellAnnotationRecord>;
  setMany(entries: readonly WorksheetCellAnnotationWriteEntry[]): Promise<void>;

  get(
    ref: WorksheetCellAnnotationRef,
    options?: WorksheetAnnotationReadOptions,
  ): Promise<WorksheetCellAnnotationView | null>;
  get(
    row: number,
    col: number,
    options?: WorksheetAnnotationReadOptions,
  ): Promise<WorksheetCellAnnotationView | null>;
  getText(ref: WorksheetCellAnnotationRef): Promise<string | null>;
  getText(row: number, col: number): Promise<string | null>;
  list(options?: WorksheetCellAnnotationListOptions): Promise<WorksheetCellAnnotationView[]>;

  remove(ref: WorksheetCellAnnotationRef): Promise<WorksheetCellAnnotationDeleteResult>;
  remove(row: number, col: number): Promise<WorksheetCellAnnotationDeleteResult>;
  clear(range?: string | CellRange): Promise<void>;

  /**
   * Accept a stale annotation by re-anchoring it to the cell's current content.
   * This preserves the annotation text and replaces the fingerprint through the
   * same kernel-backed write path as {@link set}.
   */
  acceptStale(ref: WorksheetCellAnnotationRef): Promise<WorksheetCellAnnotationRecord>;
  acceptStale(row: number, col: number): Promise<WorksheetCellAnnotationRecord>;

  readonly diagnostics: WorksheetCellAnnotationDiagnostics;
}

/** Sub-API for annotation operations on a worksheet. */
export interface WorksheetAnnotations {
  /** Cell annotation operations for agents and first-party UI. */
  readonly cells: WorksheetCellAnnotations;

  /**
   * Set or replace the annotation for a cell.
   *
   * @deprecated Use `worksheet.annotations.cells.set(...)`.
   *
   * @param cell - A1-style cell address
   * @param text - Annotation text
   * @returns The stored annotation record
   */
  setCell(cell: string, text: string): Promise<WorksheetAnnotationRecord>;
  /**
   * Set or replace the annotation for a cell.
   *
   * @deprecated Use `worksheet.annotations.cells.set(...)`.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param text - Annotation text
   * @returns The stored annotation record
   */
  setCell(row: number, col: number, text: string): Promise<WorksheetAnnotationRecord>;

  /**
   * Get the annotation for a cell.
   *
   * @deprecated Use `worksheet.annotations.cells.diagnostics.get(...)` for the
   * raw record, or `worksheet.annotations.cells.get(...)` for a safe fresh-text
   * view.
   *
   * @param cell - A1-style cell address
   * @returns The annotation record, or null if none exists
   */
  getCell(cell: string): Promise<WorksheetAnnotationRecord | null>;
  /**
   * Get the annotation for a cell.
   *
   * @deprecated Use `worksheet.annotations.cells.diagnostics.get(...)` for the
   * raw record, or `worksheet.annotations.cells.get(...)` for a safe fresh-text
   * view.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The annotation record, or null if none exists
   */
  getCell(row: number, col: number): Promise<WorksheetAnnotationRecord | null>;

  /**
   * Remove the annotation for a cell.
   *
   * @deprecated Use `worksheet.annotations.cells.remove(...)`.
   *
   * @param cell - A1-style cell address
   * @returns Deletion status and removed record when one existed
   */
  removeCell(cell: string): Promise<WorksheetAnnotationDeleteResult>;
  /**
   * Remove the annotation for a cell.
   *
   * @deprecated Use `worksheet.annotations.cells.remove(...)`.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Deletion status and removed record when one existed
   */
  removeCell(row: number, col: number): Promise<WorksheetAnnotationDeleteResult>;

  /**
   * List all cell annotations on this worksheet.
   *
   * @deprecated Use `worksheet.annotations.cells.diagnostics.list(...)` for raw
   * records, or `worksheet.annotations.cells.list(...)` for safe fresh-text
   * views.
   *
   * @returns Cell annotation records for this worksheet
   */
  listCells(): Promise<WorksheetAnnotationRecord[]>;

  /**
   * Set or replace the annotation for a table on this worksheet.
   *
   * @param tableRef - Table id, name, or display name
   * @param text - Annotation text
   * @returns The stored annotation record
   */
  setTable(tableRef: string, text: string): Promise<WorksheetAnnotationRecord>;

  /**
   * Get the annotation for a table on this worksheet.
   *
   * @param tableRef - Table id, name, or display name
   * @returns The annotation record, or null if none exists
   */
  getTable(tableRef: string): Promise<WorksheetAnnotationRecord | null>;

  /**
   * Remove the annotation for a table on this worksheet.
   *
   * @param tableRef - Table id, name, or display name
   * @returns Deletion status and removed record when one existed
   */
  removeTable(tableRef: string): Promise<WorksheetAnnotationDeleteResult>;

  /**
   * List all table annotations for tables on this worksheet.
   *
   * @returns Table annotation records scoped to this worksheet
   */
  listTables(): Promise<WorksheetAnnotationRecord[]>;
}

/**
 * WorksheetAnnotations - Sub-API for source annotations.
 *
 * Annotations are review/check notes anchored to the current value or shape
 * of a cell or table. They are intentionally separate from spreadsheet
 * comments and notes.
 */

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

/** Sub-API for annotation operations on a worksheet. */
export interface WorksheetAnnotations {
  /**
   * Set or replace the annotation for a cell.
   *
   * @param cell - A1-style cell address
   * @param text - Annotation text
   * @returns The stored annotation record
   */
  setCell(cell: string, text: string): Promise<WorksheetAnnotationRecord>;
  /**
   * Set or replace the annotation for a cell.
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
   * @param cell - A1-style cell address
   * @returns The annotation record, or null if none exists
   */
  getCell(cell: string): Promise<WorksheetAnnotationRecord | null>;
  /**
   * Get the annotation for a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The annotation record, or null if none exists
   */
  getCell(row: number, col: number): Promise<WorksheetAnnotationRecord | null>;

  /**
   * Remove the annotation for a cell.
   *
   * @param cell - A1-style cell address
   * @returns Deletion status and removed record when one existed
   */
  removeCell(cell: string): Promise<WorksheetAnnotationDeleteResult>;
  /**
   * Remove the annotation for a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Deletion status and removed record when one existed
   */
  removeCell(row: number, col: number): Promise<WorksheetAnnotationDeleteResult>;

  /**
   * List all cell annotations on this worksheet.
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

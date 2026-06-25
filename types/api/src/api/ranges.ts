/**
 * Public range result DTOs.
 *
 * Internal kernel code uses `CellRange.sheetId` for stable identity. Public
 * read APIs should return display-safe ranges that do not expose internal sheet
 * IDs. Worksheet-scoped ranges include an A1 address relative to that worksheet.
 */
export interface WorksheetRange {
  /** 0-based first row in the range. */
  startRow: number;
  /** 0-based first column in the range. */
  startCol: number;
  /** 0-based last row in the range. */
  endRow: number;
  /** 0-based last column in the range. */
  endCol: number;
  /** A1 address relative to the worksheet, e.g. "A1:D10". */
  address: string;
}

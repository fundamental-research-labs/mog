export interface ParsedCellAddress {
  row: number;
  col: number;
  sheetName?: string;
}

export interface ParsedCellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  isFullColumn?: boolean;
  isFullRow?: boolean;
  sheetName?: string;
}

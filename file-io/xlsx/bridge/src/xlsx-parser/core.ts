/**
 * XLSX Parser Core Runtime Functions
 *
 * Local ParsedSheet interface for createEmptySheet() — only the fields
 * actually used. Full type lives in the Rust parser output.
 */

/** Minimal ParsedSheet for constructing empty sheet objects. */
export interface ParsedSheet {
  rId: string;
  name: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  cells: Map<string, unknown>;
  usedRange: unknown | null;
  merges: unknown[];
  colWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  hiddenCols: Set<number>;
  hiddenRows: Set<number>;
  defaultColWidth: number;
  defaultRowHeight: number;
  frozenPane: unknown | null;
  rowOutlineGroups: unknown[];
  colOutlineGroups: unknown[];
  conditionalFormats: unknown[];
  dataValidations: unknown[];
  tables: unknown[];
  autoFilter: unknown | null;
  charts: unknown[];
  sparklines: unknown[];
  drawings: unknown[];
  comments: unknown[];
  hyperlinks: unknown[];
  pageSetup: Record<string, unknown>;
  pageBreaks: { rowBreaks: unknown[]; colBreaks: unknown[] };
  protection: unknown | null;
  pivotTableRefs: unknown[];
  viewOptions: Record<string, unknown>;
  scrollPosition: { row: number; col: number };
  zoomScale: number;
  errors: unknown[];
}

export function getCellKey(row: number, col: number): string {
  return `${row},${col}`;
}

export function parseCellKey(key: string): { row: number; col: number } {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}

export function createEmptySheet(rId: string, name: string): ParsedSheet {
  return {
    rId,
    name,
    state: 'visible',
    cells: new Map(),
    usedRange: null,
    merges: [],
    colWidths: new Map(),
    rowHeights: new Map(),
    hiddenCols: new Set(),
    hiddenRows: new Set(),
    defaultColWidth: 8.43,
    defaultRowHeight: 15,
    frozenPane: null,
    rowOutlineGroups: [],
    colOutlineGroups: [],
    conditionalFormats: [],
    dataValidations: [],
    tables: [],
    autoFilter: null,
    charts: [],
    sparklines: [],
    drawings: [],
    comments: [],
    hyperlinks: [],
    pageSetup: {},
    pageBreaks: { rowBreaks: [], colBreaks: [] },
    protection: null,
    pivotTableRefs: [],
    viewOptions: {},
    scrollPosition: { row: 0, col: 0 },
    zoomScale: 100,
    errors: [],
  };
}

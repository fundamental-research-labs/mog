import { parseA1, toA1 } from '@mog/spreadsheet-utils/a1';
import { extractFormulaRanges } from '../systems/shared/utils/formula-range-parser';

export interface TracePrecedentSource {
  row: number;
  col: number;
  address: string;
}

interface WorksheetWithPrecedents {
  getCell(row: number, col: number): Promise<{ formula?: string | null } | null>;
  getPrecedents(row: number, col: number): Promise<string[]>;
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function parsePrecedentAddress(address: string): TracePrecedentSource | null {
  try {
    const parsed = parseA1(address);
    return {
      row: parsed.row,
      col: parsed.col,
      address: toA1(parsed.row, parsed.col),
    };
  } catch {
    return null;
  }
}

function rangeCellCount(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

function keysInRange(
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
  precedentKeys: Set<string>,
): Set<string> {
  const keys = new Set<string>();
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      const key = cellKey(row, col);
      if (precedentKeys.has(key)) keys.add(key);
    }
  }
  return keys;
}

/**
 * Return precedent arrow sources for trace-arrow rendering.
 *
 * The worksheet dependency graph expands range references to individual cells.
 * For larger contiguous formula ranges, Excel-style auditing draws one arrow
 * from the range origin instead of flooding the sheet with duplicate arrows.
 */
export async function getTracePrecedentSources(
  ws: WorksheetWithPrecedents,
  row: number,
  col: number,
): Promise<TracePrecedentSource[]> {
  const [cell, precedentAddresses] = await Promise.all([
    ws.getCell(row, col),
    ws.getPrecedents(row, col),
  ]);

  const parsedPrecedents = precedentAddresses
    .map(parsePrecedentAddress)
    .filter((source): source is TracePrecedentSource => source !== null);

  if (!cell?.formula || parsedPrecedents.length === 0) {
    return parsedPrecedents;
  }

  const precedentKeys = new Set(parsedPrecedents.map((source) => cellKey(source.row, source.col)));
  const coveredKeys = new Set<string>();
  const collapsedSources: TracePrecedentSource[] = [];

  for (const reference of extractFormulaRanges(cell.formula)) {
    if (!reference.text.includes(':')) continue;

    const count = rangeCellCount(reference.range);
    if (count <= 2) continue;

    const matchedKeys = keysInRange(reference.range, precedentKeys);
    if (matchedKeys.size === 0) continue;

    const source = {
      row: reference.range.startRow,
      col: reference.range.startCol,
      address: toA1(reference.range.startRow, reference.range.startCol),
    };
    const sourceKey = cellKey(source.row, source.col);
    if (!coveredKeys.has(sourceKey)) {
      collapsedSources.push(source);
    }
    for (const key of matchedKeys) coveredKeys.add(key);
  }

  return [
    ...collapsedSources,
    ...parsedPrecedents.filter((source) => !coveredKeys.has(cellKey(source.row, source.col))),
  ];
}

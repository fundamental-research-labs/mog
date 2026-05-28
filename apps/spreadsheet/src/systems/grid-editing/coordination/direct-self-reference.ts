export interface DirectSelfReferenceInput {
  formula: string;
  row: number;
  col: number;
  sheetName?: string;
}

interface ParsedReference {
  sheetName?: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

const CELL_REF_RE = /\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})/iy;

function colLettersToIndex(letters: string): number | null {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    const code = letters.charCodeAt(i);
    if (code < 65 || code > 90) return null;
    col = col * 26 + (code - 64);
  }
  const index = col - 1;
  return index >= 0 && index <= 16383 ? index : null;
}

function normalizeSheetName(name: string): string {
  return name.replace(/''/g, "'").toLowerCase();
}

function parseCellRef(source: string, start: number): { row: number; col: number; end: number } | null {
  CELL_REF_RE.lastIndex = start;
  const match = CELL_REF_RE.exec(source);
  if (!match || match.index !== start) return null;

  const col = colLettersToIndex(match[1].toUpperCase());
  const row = Number.parseInt(match[2], 10) - 1;
  if (col == null || row < 0 || row > 1048575) return null;

  return { row, col, end: CELL_REF_RE.lastIndex };
}

function parseQuotedSheetName(source: string, quoteStart: number): { name: string; end: number } | null {
  let name = '';
  for (let index = quoteStart + 1; index < source.length; index++) {
    const char = source[index];
    if (char !== "'") {
      name += char;
      continue;
    }

    if (source[index + 1] === "'") {
      name += "'";
      index++;
      continue;
    }

    return source[index + 1] === '!' ? { name, end: index + 2 } : null;
  }

  return null;
}

function parseUnquotedSheetName(source: string, start: number): { name: string; end: number } | null {
  const match = /^[A-Z_][A-Z0-9_.]*!/i.exec(source.slice(start));
  if (!match) return null;
  return { name: match[0].slice(0, -1), end: start + match[0].length };
}

function parseReferenceAt(source: string, start: number): ParsedReference | null {
  let refStart = start;
  let sheetName: string | undefined;

  if (source[start] === "'") {
    const parsedSheet = parseQuotedSheetName(source, start);
    if (parsedSheet) {
      sheetName = parsedSheet.name;
      refStart = parsedSheet.end;
    }
  } else {
    const parsedSheet = parseUnquotedSheetName(source, start);
    if (parsedSheet) {
      if (source[start - 1] === ']') return null;
      sheetName = parsedSheet.name;
      refStart = parsedSheet.end;
    }
  }

  const startCell = parseCellRef(source, refStart);
  if (!startCell) return null;

  let endCell = startCell;
  if (source[startCell.end] === ':') {
    const parsedEnd = parseCellRef(source, startCell.end + 1);
    if (!parsedEnd) return null;
    endCell = parsedEnd;
  }

  return {
    sheetName,
    startRow: Math.min(startCell.row, endCell.row),
    startCol: Math.min(startCell.col, endCell.col),
    endRow: Math.max(startCell.row, endCell.row),
    endCol: Math.max(startCell.col, endCell.col),
  };
}

function isReferenceBoundary(source: string, index: number): boolean {
  if (index <= 0) return true;
  if (source[index - 1] === '!') return false;
  return !/[A-Z0-9_.$']/i.test(source[index - 1]);
}

function rangeContainsCell(ref: ParsedReference, row: number, col: number): boolean {
  return row >= ref.startRow && row <= ref.endRow && col >= ref.startCol && col <= ref.endCol;
}

function isSameSheetReference(ref: ParsedReference, currentSheetName?: string): boolean {
  if (!ref.sheetName) return true;
  if (!currentSheetName) return false;
  return normalizeSheetName(ref.sheetName) === normalizeSheetName(currentSheetName);
}

/**
 * Detects direct same-sheet A1/range references to the edited cell in authored
 * formula text. It deliberately ignores string literals, structured-reference
 * bracket bodies, and external workbook prefixes.
 */
export function hasDirectSelfReference({
  formula,
  row,
  col,
  sheetName,
}: DirectSelfReferenceInput): boolean {
  const source = formula.trimStart();
  if (!source.startsWith('=')) return false;

  let inString = false;
  let bracketDepth = 0;

  for (let index = 1; index < source.length; index++) {
    const char = source[index];

    if (inString) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          index++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '[') {
      bracketDepth++;
      continue;
    }

    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (bracketDepth > 0 || !isReferenceBoundary(source, index)) {
      continue;
    }

    const ref = parseReferenceAt(source, index);
    if (!ref) continue;

    if (isSameSheetReference(ref, sheetName) && rangeContainsCell(ref, row, col)) {
      return true;
    }
  }

  return false;
}

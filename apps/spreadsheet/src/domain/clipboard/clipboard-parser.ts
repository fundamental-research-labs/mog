/**
 * Clipboard Text Parser
 *
 * Pure parsing functions for clipboard text data.
 * Moved from infra/utils/clipboard-utils.ts to maintain domain/ purity.
 *
 * These are pure functions with zero dependencies — they parse
 * TSV/CSV text from the system clipboard into 2D string arrays.
 */

/**
 * Parse TSV string to 2D array.
 */
export function parseTSV(text: string): string[][] {
  return parseDelimitedText(text, '\t');
}

/**
 * Parse CSV string to 2D array with proper quote handling.
 */
export function parseCSV(text: string): string[][] {
  return parseDelimitedText(text, ',');
}

/**
 * Parse delimited spreadsheet text with Excel-style field quoting.
 *
 * Delimiters and row breaks are structural only outside quoted fields. Formula
 * fields are also protected while inside parenthesized argument lists or string
 * literals, so unquoted formulas like =SUM(1,2) are not fragmented.
 */
function parseDelimitedText(text: string, delimiter: '\t' | ','): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let cellStart = 0;
  let cellBuffer: string[] | null = null;
  let inQuotedField = false;
  let formulaLike = false;
  let sawFormulaCandidate = false;
  let formulaString = false;
  let formulaParenDepth = 0;

  const resetCellState = (nextStart: number) => {
    cellStart = nextStart;
    cellBuffer = null;
    inQuotedField = false;
    formulaLike = false;
    sawFormulaCandidate = false;
    formulaString = false;
    formulaParenDepth = 0;
  };

  const ensureBuffer = (endExclusive: number) => {
    if (cellBuffer) return;
    const prefix = text.slice(cellStart, endExclusive);
    cellBuffer = prefix === '' ? [] : [prefix];
  };

  const updateFormulaState = (char: string) => {
    if (!formulaLike) {
      if (!sawFormulaCandidate && char.trim() !== '') {
        sawFormulaCandidate = true;
        formulaLike = char === '=';
      }
      return;
    }

    if (char === '"') {
      formulaString = !formulaString;
      return;
    }

    if (formulaString) return;

    if (char === '(') {
      formulaParenDepth++;
    } else if (char === ')' && formulaParenDepth > 0) {
      formulaParenDepth--;
    }
  };

  const append = (char: string) => {
    if (cellBuffer) {
      cellBuffer.push(char);
    }
    updateFormulaState(char);
  };

  const isFormulaProtected = () => formulaLike && (formulaString || formulaParenDepth > 0);
  const isStructuralDelimiter = (char: string) => char === delimiter && !isFormulaProtected();

  const currentCellText = (endExclusive: number) =>
    cellBuffer ? cellBuffer.join('') : text.slice(cellStart, endExclusive);

  const pushCell = (endExclusive: number, nextStart: number) => {
    currentRow.push(currentCellText(endExclusive));
    resetCellState(nextStart);
  };

  const pushRow = () => {
    rows.push(currentRow);
    currentRow = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotedField) {
      if (char === '"' && nextChar === '"') {
        append('"');
        i++;
      } else if (char === '"') {
        inQuotedField = false;
      } else if (char === '\r' && nextChar === '\n') {
        append('\n');
        i++;
      } else {
        append(char === '\r' ? '\n' : char);
      }
      continue;
    }

    const atCellStart = cellBuffer ? cellBuffer.length === 0 : i === cellStart;
    if (char === '"' && atCellStart) {
      cellBuffer = [];
      inQuotedField = true;
    } else if (isStructuralDelimiter(char)) {
      pushCell(i, i + 1);
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !isFormulaProtected()) {
      const nextStart = char === '\r' ? i + 2 : i + 1;
      pushCell(i, nextStart);
      pushRow();
      if (char === '\r') i++;
    } else if (char !== '\r') {
      append(char);
    } else {
      ensureBuffer(i);
      append('\n');
    }
  }

  currentRow.push(currentCellText(text.length));
  if (currentRow.length > 1 || currentRow[0] !== '') {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Detect if text is CSV or TSV format.
 */
export function detectFormat(text: string): 'tsv' | 'csv' {
  const counts = countStructuralDelimiters(text);
  if (counts.tabs > 0) return 'tsv';
  return counts.commas > 0 ? 'csv' : 'tsv';
}

function countStructuralDelimiters(text: string): { tabs: number; commas: number } {
  let tabs = 0;
  let commas = 0;
  let atCellStart = true;
  let inQuotedField = false;
  let formulaLike = false;
  let sawFormulaCandidate = false;
  let formulaString = false;
  let formulaParenDepth = 0;

  const resetCellState = () => {
    atCellStart = true;
    inQuotedField = false;
    formulaLike = false;
    sawFormulaCandidate = false;
    formulaString = false;
    formulaParenDepth = 0;
  };

  const append = (char: string) => {
    if (!formulaLike) {
      if (!sawFormulaCandidate && char.trim() !== '') {
        sawFormulaCandidate = true;
        formulaLike = char === '=';
      }
      atCellStart = false;
      return;
    }

    atCellStart = false;

    if (char === '"') {
      formulaString = !formulaString;
      return;
    }

    if (formulaString) return;

    if (char === '(') {
      formulaParenDepth++;
    } else if (char === ')' && formulaParenDepth > 0) {
      formulaParenDepth--;
    }
  };

  const isFormulaProtected = () => formulaLike && (formulaString || formulaParenDepth > 0);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotedField) {
      if (char === '"' && nextChar === '"') {
        append('"');
        i++;
      } else if (char === '"') {
        inQuotedField = false;
      } else if (char === '\r' && nextChar === '\n') {
        append('\n');
        i++;
      } else {
        append(char === '\r' ? '\n' : char);
      }
      continue;
    }

    if (char === '"' && atCellStart) {
      atCellStart = false;
      inQuotedField = true;
    } else if (char === '\t' && !isFormulaProtected()) {
      tabs++;
      resetCellState();
    } else if (char === ',' && !isFormulaProtected()) {
      commas++;
      resetCellState();
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !isFormulaProtected()) {
      resetCellState();
      if (char === '\r') i++;
    } else if (char !== '\r') {
      append(char);
    } else {
      append('\n');
    }
  }

  return { tabs, commas };
}

/**
 * Parse clipboard text (auto-detect TSV or CSV).
 */
export function parseClipboardText(text: string): string[][] {
  const format = detectFormat(text);
  return format === 'tsv' ? parseTSV(text) : parseCSV(text);
}

/**
 * Convert column letters (e.g. "A", "BC") to a 1-based column number.
 */
function colLettersToNumber(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64); // 'A' = 65
  }
  return result;
}

/** Regex matching A1-style cell references (with optional $ anchors). */
const A1_REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)/g;

/**
 * Convert an A1-style formula string to R1C1 notation relative to (baseRow, baseCol).
 * baseRow and baseCol are 0-based.
 */
export function a1FormulaToR1C1(formula: string, baseRow: number, baseCol: number): string {
  const baseRow1 = baseRow + 1;
  const baseCol1 = baseCol + 1;

  return formula.replace(
    A1_REF_RE,
    (_match, colDollar: string, colLetters: string, rowDollar: string, rowDigits: string) => {
      const refRow = parseInt(rowDigits, 10);
      const refCol = colLettersToNumber(colLetters);

      const rowAbsolute = rowDollar === '$';
      const colAbsolute = colDollar === '$';

      let rowPart: string;
      if (rowAbsolute) {
        rowPart = `R${refRow}`;
      } else {
        const delta = refRow - baseRow1;
        rowPart = delta === 0 ? 'R' : `R[${delta}]`;
      }

      let colPart: string;
      if (colAbsolute) {
        colPart = `C${refCol}`;
      } else {
        const delta = refCol - baseCol1;
        colPart = delta === 0 ? 'C' : `C[${delta}]`;
      }

      return rowPart + colPart;
    },
  );
}

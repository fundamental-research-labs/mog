#!/usr/bin/env npx tsx
/**
 * Generate Edge Case Test Files (5C-3)
 *
 * Creates XLSX test files with edge cases:
 * - Maximum cell reference (XFD1048576)
 * - Unicode sheet names and cell values
 * - Very long strings (32K+ characters)
 * - Sparse data patterns (few cells in large range)
 * - Many sheets (100+ sheets)
 * - Deep formula nesting
 * - Special characters and escape sequences
 *
 * Usage: npx tsx scripts/generate-edge-cases.ts
 */

import * as fs from 'fs';
import JSZip from 'jszip';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, '../test-corpus/generated');
const EDGE_CASES_DIR = path.join(OUTPUT_DIR, 'edge-cases');

// =============================================================================
// XML Constants
// =============================================================================

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Excel limits
const MAX_ROWS = 1048576;
const MAX_COLS = 16384; // XFD

// =============================================================================
// Utility Functions
// =============================================================================

function colToLetter(col: number): string {
  let result = '';
  let n = col + 1;
  while (n > 0) {
    n--;
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// Edge Case XLSX Builder
// =============================================================================

interface SheetData {
  name: string;
  cells: CellData[];
  merges?: MergeRange[];
  freeze?: { rows: number; cols: number };
  colWidths?: { col: number; width: number }[];
}

interface CellData {
  ref: string;
  value?: string | number | boolean | null;
  formula?: string;
  type?: 's' | 'n' | 'b' | 'e' | 'str' | 'inlineStr';
  styleIndex?: number;
}

interface MergeRange {
  start: string;
  end: string;
}

class EdgeCaseXlsxBuilder {
  private sheets: SheetData[] = [];
  private sharedStrings: string[] = [];
  private sharedStringMap: Map<string, number> = new Map();

  addSheet(sheet: SheetData): this {
    this.sheets.push(sheet);
    return this;
  }

  addSharedString(str: string): number {
    const existing = this.sharedStringMap.get(str);
    if (existing !== undefined) return existing;
    const index = this.sharedStrings.length;
    this.sharedStrings.push(str);
    this.sharedStringMap.set(str, index);
    return index;
  }

  async build(): Promise<ArrayBuffer> {
    const zip = new JSZip();

    zip.file('[Content_Types].xml', this.buildContentTypes());
    zip.file('_rels/.rels', this.buildRootRels());
    zip.file('xl/_rels/workbook.xml.rels', this.buildWorkbookRels());
    zip.file('xl/workbook.xml', this.buildWorkbook());

    for (let i = 0; i < this.sheets.length; i++) {
      zip.file(`xl/worksheets/sheet${i + 1}.xml`, this.buildWorksheet(this.sheets[i]));
    }

    if (this.sharedStrings.length > 0) {
      zip.file('xl/sharedStrings.xml', this.buildSharedStrings());
    }

    zip.file('xl/styles.xml', this.buildMinimalStyles());

    return zip.generateAsync({ type: 'arraybuffer' });
  }

  private buildContentTypes(): string {
    let xml = `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`;

    for (let i = 0; i < this.sheets.length; i++) {
      xml += `\n  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    }

    if (this.sharedStrings.length > 0) {
      xml += `\n  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`;
    }

    xml += `\n  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;
    xml += '\n</Types>';

    return xml;
  }

  private buildRootRels(): string {
    return `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  }

  private buildWorkbookRels(): string {
    let xml = `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

    for (let i = 0; i < this.sheets.length; i++) {
      xml += `\n  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
    }

    let nextId = this.sheets.length + 1;
    if (this.sharedStrings.length > 0) {
      xml += `\n  <Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`;
      nextId++;
    }

    xml += `\n  <Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    xml += '\n</Relationships>';

    return xml;
  }

  private buildWorkbook(): string {
    let xml = `${XML_DECLARATION}
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}">
  <sheets>`;

    for (let i = 0; i < this.sheets.length; i++) {
      xml += `\n    <sheet name="${escapeXml(this.sheets[i].name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
    }

    xml += `
  </sheets>
</workbook>`;

    return xml;
  }

  private buildWorksheet(sheet: SheetData): string {
    let xml = `${XML_DECLARATION}
<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`;

    // Column widths
    if (sheet.colWidths && sheet.colWidths.length > 0) {
      xml += '\n  <cols>';
      for (const cw of sheet.colWidths) {
        xml += `\n    <col min="${cw.col + 1}" max="${cw.col + 1}" width="${cw.width}" customWidth="1"/>`;
      }
      xml += '\n  </cols>';
    }

    // Freeze panes
    if (sheet.freeze) {
      const topLeft = `${colToLetter(sheet.freeze.cols)}${sheet.freeze.rows + 1}`;
      xml += `
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane xSplit="${sheet.freeze.cols}" ySplit="${sheet.freeze.rows}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>
    </sheetView>
  </sheetViews>`;
    }

    // Sheet data
    xml += '\n  <sheetData>';

    // Group cells by row
    const rowMap = new Map<number, CellData[]>();
    for (const cell of sheet.cells) {
      const match = cell.ref.match(/^([A-Z]+)(\d+)$/);
      if (!match) continue;
      const row = parseInt(match[2], 10);
      if (!rowMap.has(row)) rowMap.set(row, []);
      rowMap.get(row)!.push(cell);
    }

    const sortedRows = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);

    for (const [rowNum, cells] of sortedRows) {
      xml += `\n    <row r="${rowNum}">`;
      for (const cell of cells) {
        xml += this.buildCell(cell);
      }
      xml += '\n    </row>';
    }

    xml += '\n  </sheetData>';

    // Merged cells
    if (sheet.merges && sheet.merges.length > 0) {
      xml += `\n  <mergeCells count="${sheet.merges.length}">`;
      for (const merge of sheet.merges) {
        xml += `\n    <mergeCell ref="${merge.start}:${merge.end}"/>`;
      }
      xml += '\n  </mergeCells>';
    }

    xml += '\n</worksheet>';

    return xml;
  }

  private buildCell(cell: CellData): string {
    let xml = `\n      <c r="${cell.ref}"`;

    if (cell.type) xml += ` t="${cell.type}"`;
    if (cell.styleIndex !== undefined && cell.styleIndex > 0) xml += ` s="${cell.styleIndex}"`;

    xml += '>';

    if (cell.formula) xml += `<f>${escapeXml(cell.formula)}</f>`;

    if (cell.value !== undefined && cell.value !== null) {
      if (cell.type === 'inlineStr') {
        xml += `<is><t>${escapeXml(String(cell.value))}</t></is>`;
      } else {
        xml += `<v>${escapeXml(String(cell.value))}</v>`;
      }
    }

    xml += '</c>';

    return xml;
  }

  private buildSharedStrings(): string {
    let xml = `${XML_DECLARATION}
<sst xmlns="${NS_MAIN}" count="${this.sharedStrings.length}" uniqueCount="${this.sharedStrings.length}">`;

    for (const str of this.sharedStrings) {
      xml += `\n  <si><t>${escapeXml(str)}</t></si>`;
    }

    xml += '\n</sst>';

    return xml;
  }

  private buildMinimalStyles(): string {
    return `${XML_DECLARATION}
<styleSheet xmlns="${NS_MAIN}">
  <fonts count="1">
    <font><name val="Calibri"/><sz val="11"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/></border>
  </borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="1"><xf/></cellXfs>
</styleSheet>`;
  }
}

// =============================================================================
// Edge Case File Generators
// =============================================================================

async function generateMaxCellReference(): Promise<void> {
  console.log('  Generating max cell reference...');

  const builder = new EdgeCaseXlsxBuilder();

  // XFD is column 16384 (0-indexed: 16383)
  const maxCol = colToLetter(MAX_COLS - 1); // XFD
  const maxRow = MAX_ROWS;

  builder.addSheet({
    name: 'Max Reference',
    cells: [
      // A1 for reference
      { ref: 'A1', value: builder.addSharedString('Start'), type: 's' },

      // Some intermediate cells
      { ref: 'A100', value: 100 },
      { ref: 'Z1000', value: builder.addSharedString('Z1000'), type: 's' },
      { ref: 'AA10000', value: builder.addSharedString('AA10000'), type: 's' },
      { ref: 'ZZ100000', value: builder.addSharedString('ZZ100000'), type: 's' },

      // Maximum cell reference
      {
        ref: `${maxCol}${maxRow}`,
        value: builder.addSharedString(`Max: ${maxCol}${maxRow}`),
        type: 's',
      },

      // Near-max cells
      { ref: `${maxCol}1`, value: builder.addSharedString('Last column'), type: 's' },
      { ref: `A${maxRow}`, value: builder.addSharedString('Last row'), type: 's' },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(EDGE_CASES_DIR, 'max-cell-reference.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateUnicodeContent(): Promise<void> {
  console.log('  Generating unicode content...');

  const builder = new EdgeCaseXlsxBuilder();

  // Various unicode strings
  const unicodeStrings = [
    // Basic Latin Extended
    'Hello World',
    // Accented characters
    'Caf\u00e9 r\u00e9sum\u00e9',
    // German
    'Gr\u00fc\u00df Gott, M\u00fcnchen!',
    // French
    '\u00c0 la recherche du temps perdu',
    // Spanish
    '\u00bfC\u00f3mo est\u00e1s? \u00a1Hola!',
    // Russian
    '\u041f\u0440\u0438\u0432\u0435\u0442, \u041c\u0438\u0440!',
    // Chinese
    '\u4e2d\u6587\u6d4b\u8bd5 - \u4f60\u597d\u4e16\u754c',
    // Japanese
    '\u3053\u3093\u306b\u3061\u306f\u4e16\u754c',
    // Korean
    '\uc548\ub155\ud558\uc138\uc694 \uc138\uacc4',
    // Arabic (RTL)
    '\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645',
    // Hebrew (RTL)
    '\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd',
    // Thai
    '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35\u0e42\u0e25\u0e01',
    // Greek
    '\u0393\u03b5\u03b9\u03ac \u03c3\u03bf\u03c5 \u039a\u03cc\u03c3\u03bc\u03b5!',
    // Emoji (common Unicode)
    '\ud83d\ude00 \ud83d\ude02 \ud83e\udd73 \ud83c\udf89',
    // Mathematical symbols
    '\u221e \u2211 \u220f \u221a \u00b1 \u2260 \u2248',
    // Currency symbols
    '\u00a3 \u00a5 \u20ac \u20bf \u20b9 \u20a9',
    // Box drawing
    '\u250c\u2500\u2510\u2502\u2514\u2500\u2518',
    // Mixed scripts
    'Hello \u4e16\u754c \u041c\u0438\u0440 \ud83c\udf0d',
    // Zero-width characters
    'A\u200bB\u200cC\u200dD', // Zero-width space, non-joiner, joiner
    // Combining characters
    'e\u0301 a\u0303 o\u0308', // e with acute, a with tilde, o with umlaut
  ];

  const cells: CellData[] = [];
  for (let i = 0; i < unicodeStrings.length; i++) {
    cells.push({
      ref: `A${i + 1}`,
      value: builder.addSharedString(unicodeStrings[i]),
      type: 's',
    });
  }

  builder.addSheet({
    name: 'Unicode Content',
    cells,
    colWidths: [{ col: 0, width: 50 }],
  });

  // Sheet with unicode name
  builder.addSheet({
    name: '\u65e5\u672c\u8a9e\u30b7\u30fc\u30c8',
    cells: [
      {
        ref: 'A1',
        value: builder.addSharedString(
          '\u3053\u306e\u30b7\u30fc\u30c8\u306f\u65e5\u672c\u8a9e\u306e\u540d\u524d\u3092\u6301\u3063\u3066\u3044\u307e\u3059',
        ),
        type: 's',
      },
    ],
  });

  builder.addSheet({
    name: '\u4e2d\u6587\u5de5\u4f5c\u8868',
    cells: [
      {
        ref: 'A1',
        value: builder.addSharedString('\u8fd9\u662f\u4e2d\u6587\u5de5\u4f5c\u8868'),
        type: 's',
      },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(EDGE_CASES_DIR, 'unicode-content.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateLongStrings(): Promise<void> {
  console.log('  Generating long strings...');

  const builder = new EdgeCaseXlsxBuilder();

  // Generate strings of various lengths
  const lengths = [100, 1000, 5000, 10000, 32000, 32767]; // Excel max cell text is 32,767 characters

  const cells: CellData[] = [];
  cells.push({ ref: 'A1', value: builder.addSharedString('Length'), type: 's' });
  cells.push({ ref: 'B1', value: builder.addSharedString('Content'), type: 's' });

  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    const row = i + 2;

    // Generate a string with various characters
    let content = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ';
    for (let j = 0; j < length; j++) {
      content += chars[j % chars.length];
    }

    cells.push({ ref: `A${row}`, value: length });
    cells.push({ ref: `B${row}`, value: builder.addSharedString(content), type: 's' });
  }

  // Also add a cell with inline string (not shared)
  const inlineContent = 'X'.repeat(1000);
  cells.push({
    ref: `A${lengths.length + 3}`,
    value: builder.addSharedString('Inline 1000'),
    type: 's',
  });
  cells.push({ ref: `B${lengths.length + 3}`, value: inlineContent, type: 'inlineStr' });

  builder.addSheet({
    name: 'Long Strings',
    cells,
    colWidths: [
      { col: 0, width: 15 },
      { col: 1, width: 100 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(EDGE_CASES_DIR, 'long-strings.xlsx'), Buffer.from(buffer));
}

async function generateSparseData(): Promise<void> {
  console.log('  Generating sparse data...');

  const builder = new EdgeCaseXlsxBuilder();

  // Sparse sheet 1: Few cells scattered across large range
  const sparseCells1: CellData[] = [
    { ref: 'A1', value: builder.addSharedString('Start'), type: 's' },
    { ref: 'Z1', value: 1 },
    { ref: 'A100', value: 100 },
    { ref: 'AB500', value: 500 },
    { ref: 'A1000', value: 1000 },
    { ref: 'ZZ5000', value: 5000 },
    { ref: 'A10000', value: 10000 },
    { ref: 'AAA50000', value: 50000 },
    { ref: 'XFD100000', value: builder.addSharedString('Far right'), type: 's' },
  ];

  builder.addSheet({
    name: 'Sparse Wide',
    cells: sparseCells1,
  });

  // Sparse sheet 2: Diagonal pattern
  const sparseCells2: CellData[] = [];
  for (let i = 0; i < 100; i++) {
    const row = i * 100 + 1;
    const col = i;
    sparseCells2.push({
      ref: `${colToLetter(col)}${row}`,
      value: i,
    });
  }

  builder.addSheet({
    name: 'Sparse Diagonal',
    cells: sparseCells2,
  });

  // Sparse sheet 3: Corners only
  const sparseCells3: CellData[] = [
    { ref: 'A1', value: builder.addSharedString('Top-Left'), type: 's' },
    { ref: 'XFD1', value: builder.addSharedString('Top-Right'), type: 's' },
    { ref: 'A1000000', value: builder.addSharedString('Bottom-Left'), type: 's' },
    { ref: 'XFD1000000', value: builder.addSharedString('Bottom-Right'), type: 's' },
  ];

  builder.addSheet({
    name: 'Corners',
    cells: sparseCells3,
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(EDGE_CASES_DIR, 'sparse-data.xlsx'), Buffer.from(buffer));
}

async function generateManySheets(): Promise<void> {
  console.log('  Generating many sheets (100 sheets)...');

  const builder = new EdgeCaseXlsxBuilder();

  // Create 100 sheets
  for (let i = 1; i <= 100; i++) {
    const cells: CellData[] = [
      { ref: 'A1', value: builder.addSharedString(`Sheet ${i}`), type: 's' },
      { ref: 'A2', value: i },
      { ref: 'B2', value: i * 10 },
      { ref: 'C2', value: i * 100 },
      { ref: 'A3', formula: 'SUM(A2:C2)', value: i + i * 10 + i * 100 },
    ];

    builder.addSheet({
      name: `Sheet${String(i).padStart(3, '0')}`,
      cells,
    });
  }

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(EDGE_CASES_DIR, 'many-sheets.xlsx'), Buffer.from(buffer));
}

async function generateDeepFormulas(): Promise<void> {
  console.log('  Generating deep formulas...');

  const builder = new EdgeCaseXlsxBuilder();

  const cells: CellData[] = [];

  // Chain of formulas referencing previous cell
  cells.push({ ref: 'A1', value: 1 });
  for (let i = 2; i <= 100; i++) {
    cells.push({
      ref: `A${i}`,
      formula: `A${i - 1}+1`,
      value: i,
    });
  }

  // Deeply nested IF statements
  let nestedIf = '1';
  for (let i = 0; i < 20; i++) {
    nestedIf = `IF(A1>${i},${nestedIf},0)`;
  }
  cells.push({ ref: 'B1', value: builder.addSharedString('Nested IF (20 levels)'), type: 's' });
  cells.push({ ref: 'C1', formula: nestedIf, value: 1 });

  // Deeply nested function calls
  let nestedSum = 'A1';
  for (let i = 0; i < 10; i++) {
    nestedSum = `SUM(${nestedSum},1)`;
  }
  cells.push({ ref: 'B2', value: builder.addSharedString('Nested SUM (10 levels)'), type: 's' });
  cells.push({ ref: 'C2', formula: nestedSum, value: 11 });

  // Complex arithmetic expression
  let complexExpr = 'A1';
  for (let i = 0; i < 50; i++) {
    const op = i % 4 === 0 ? '+' : i % 4 === 1 ? '-' : i % 4 === 2 ? '*' : '/';
    complexExpr = `(${complexExpr}${op}1)`;
  }
  cells.push({ ref: 'B3', value: builder.addSharedString('Complex arithmetic'), type: 's' });
  cells.push({ ref: 'C3', formula: complexExpr, value: 0 });

  // Cross-references
  cells.push({ ref: 'D1', value: 10 });
  cells.push({ ref: 'E1', value: 20 });
  cells.push({ ref: 'F1', formula: 'D1+E1', value: 30 });
  cells.push({ ref: 'G1', formula: 'D1*E1+F1', value: 230 });
  cells.push({ ref: 'H1', formula: 'SUM(D1:G1)/AVERAGE(D1:F1)', value: (10 + 20 + 30 + 230) / 20 });

  // Array-style formulas (written as regular formulas)
  cells.push({ ref: 'B5', value: builder.addSharedString('SUMPRODUCT'), type: 's' });
  for (let i = 6; i <= 10; i++) {
    cells.push({ ref: `D${i}`, value: i });
    cells.push({ ref: `E${i}`, value: i * 2 });
  }
  cells.push({ ref: 'C5', formula: 'SUMPRODUCT(D6:D10,E6:E10)', value: 0 });

  builder.addSheet({
    name: 'Deep Formulas',
    cells,
    colWidths: [
      { col: 1, width: 25 },
      { col: 2, width: 100 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(EDGE_CASES_DIR, 'deep-formulas.xlsx'), Buffer.from(buffer));
}

async function generateSpecialCharacters(): Promise<void> {
  console.log('  Generating special characters...');

  const builder = new EdgeCaseXlsxBuilder();

  const specialStrings = [
    // XML special characters
    '<tag>',
    '& ampersand',
    '"quotes"',
    "'apostrophe'",
    'a > b',
    'a < b',
    'mix <>&"\' all',

    // Whitespace
    'leading space',
    ' space before',
    'space after ',
    '  multiple   spaces  ',
    'tab\there',
    'new\nline',
    'carriage\rreturn',
    'crlf\r\ncombo',

    // Control characters (as escaped sequences)
    'null\x00char', // This will be escaped or removed
    'bell\x07char',

    // Backslashes and forward slashes
    'path\\to\\file',
    'url/path/here',
    'mixed\\path/here',

    // Brackets and parentheses
    '[brackets]',
    '{braces}',
    '(parentheses)',
    '[[nested]]',

    // Formula-like strings
    '=NOT_A_FORMULA',
    '+123',
    '-456',
    '@mention',

    // Numbers as strings
    '00123',
    '1.23e10',
    '1,234,567',

    // Empty-ish strings
    '',
    ' ',
    '   ',

    // Very special
    'null',
    'true',
    'false',
    'NaN',
    'Infinity',
    'undefined',
  ];

  const cells: CellData[] = [];
  cells.push({ ref: 'A1', value: builder.addSharedString('Description'), type: 's' });
  cells.push({ ref: 'B1', value: builder.addSharedString('Content'), type: 's' });

  for (let i = 0; i < specialStrings.length; i++) {
    const row = i + 2;
    const str = specialStrings[i];
    const description = str
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\x00/g, '\\0')
      .replace(/\x07/g, '\\a');

    cells.push({ ref: `A${row}`, value: builder.addSharedString(description), type: 's' });
    cells.push({ ref: `B${row}`, value: builder.addSharedString(str), type: 's' });
  }

  builder.addSheet({
    name: 'Special Characters',
    cells,
    colWidths: [
      { col: 0, width: 30 },
      { col: 1, width: 40 },
    ],
  });

  // Sheet with special name
  builder.addSheet({
    name: "Sheet'With'Quotes",
    cells: [{ ref: 'A1', value: builder.addSharedString('Sheet name has quotes'), type: 's' }],
  });

  builder.addSheet({
    name: 'Sheet (With) Parens',
    cells: [{ ref: 'A1', value: builder.addSharedString('Sheet name has parentheses'), type: 's' }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(EDGE_CASES_DIR, 'special-characters.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateNumericEdgeCases(): Promise<void> {
  console.log('  Generating numeric edge cases...');

  const builder = new EdgeCaseXlsxBuilder();

  const numericValues = [
    { desc: 'Zero', value: 0 },
    { desc: 'Negative zero', value: -0 },
    { desc: 'One', value: 1 },
    { desc: 'Negative one', value: -1 },
    { desc: 'Small positive', value: 0.0001 },
    { desc: 'Small negative', value: -0.0001 },
    { desc: 'Large positive', value: 9999999999999 },
    { desc: 'Large negative', value: -9999999999999 },
    { desc: 'Max safe integer', value: 9007199254740991 },
    { desc: 'Min safe integer', value: -9007199254740991 },
    { desc: 'Beyond safe (loses precision)', value: 9007199254740992 },
    { desc: 'Scientific notation small', value: 1e-10 },
    { desc: 'Scientific notation large', value: 1e10 },
    { desc: 'Pi approximation', value: 3.141592653589793 },
    { desc: 'Very precise', value: 1.23456789012345 },
    { desc: 'Repeating decimal', value: 1 / 3 },
    { desc: 'Near zero positive', value: Number.MIN_VALUE },
    { desc: 'Max value', value: Number.MAX_VALUE },
    { desc: 'Max safe', value: Number.MAX_SAFE_INTEGER },
    { desc: 'Min safe', value: Number.MIN_SAFE_INTEGER },
  ];

  const cells: CellData[] = [];
  cells.push({ ref: 'A1', value: builder.addSharedString('Description'), type: 's' });
  cells.push({ ref: 'B1', value: builder.addSharedString('Value'), type: 's' });

  for (let i = 0; i < numericValues.length; i++) {
    const row = i + 2;
    const item = numericValues[i];
    cells.push({ ref: `A${row}`, value: builder.addSharedString(item.desc), type: 's' });
    cells.push({ ref: `B${row}`, value: item.value });
  }

  // Formulas that produce special values
  cells.push({ ref: 'A23', value: builder.addSharedString('Infinity (1/0)'), type: 's' });
  cells.push({ ref: 'B23', formula: '1/0', value: '#DIV/0!', type: 'e' });

  cells.push({ ref: 'A24', value: builder.addSharedString('Negative Infinity (-1/0)'), type: 's' });
  cells.push({ ref: 'B24', formula: '-1/0', value: '#DIV/0!', type: 'e' });

  builder.addSheet({
    name: 'Numeric Edge Cases',
    cells,
    colWidths: [
      { col: 0, width: 30 },
      { col: 1, width: 30 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(EDGE_CASES_DIR, 'numeric-edge-cases.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateEmptyVariations(): Promise<void> {
  console.log('  Generating empty variations...');

  const builder = new EdgeCaseXlsxBuilder();

  // Sheet with only empty cells (referenced but no value)
  builder.addSheet({
    name: 'Empty Cells',
    cells: [
      { ref: 'A1', value: null },
      { ref: 'B1', value: undefined as unknown as null },
      { ref: 'C1', value: builder.addSharedString(''), type: 's' },
      { ref: 'D1', value: 0 },
      { ref: 'E1', value: builder.addSharedString(' '), type: 's' }, // Just a space
    ],
  });

  // Completely empty sheet
  builder.addSheet({
    name: 'Completely Empty',
    cells: [],
  });

  // Sheet with formula referencing empty cells
  builder.addSheet({
    name: 'Formulas on Empty',
    cells: [
      { ref: 'A1', formula: 'B1', value: 0 }, // References empty cell
      { ref: 'A2', formula: 'SUM(Z1:Z100)', value: 0 }, // Sum of empty range
      {
        ref: 'A3',
        formula: 'IF(B1="","empty","not empty")',
        value: builder.addSharedString('empty'),
        type: 's',
      },
      { ref: 'A4', formula: 'COUNTA(A1:Z10)', value: 4 }, // Count non-empty
      { ref: 'A5', formula: 'COUNTBLANK(B1:Z10)', value: 246 }, // Count empty
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(EDGE_CASES_DIR, 'empty-variations.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateMergeEdgeCases(): Promise<void> {
  console.log('  Generating merge edge cases...');

  const builder = new EdgeCaseXlsxBuilder();

  builder.addSheet({
    name: 'Merge Edge Cases',
    cells: [
      // Single row merge (many columns)
      { ref: 'A1', value: builder.addSharedString('Wide merge (A1:Z1)'), type: 's' },

      // Single column merge (many rows)
      { ref: 'A3', value: builder.addSharedString('Tall merge (A3:A20)'), type: 's' },

      // Large block merge
      { ref: 'C3', value: builder.addSharedString('Block merge (C3:J20)'), type: 's' },

      // Multiple adjacent merges
      { ref: 'L1', value: builder.addSharedString('Adjacent 1'), type: 's' },
      { ref: 'O1', value: builder.addSharedString('Adjacent 2'), type: 's' },
      { ref: 'R1', value: builder.addSharedString('Adjacent 3'), type: 's' },

      // Data around merges
      { ref: 'AA1', value: builder.addSharedString('Not merged'), type: 's' },
      { ref: 'B3', value: 123 },
      { ref: 'K3', value: 456 },
    ],
    merges: [
      { start: 'A1', end: 'Z1' },
      { start: 'A3', end: 'A20' },
      { start: 'C3', end: 'J20' },
      { start: 'L1', end: 'N1' },
      { start: 'O1', end: 'Q1' },
      { start: 'R1', end: 'T1' },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(EDGE_CASES_DIR, 'merge-edge-cases.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateDuplicateData(): Promise<void> {
  console.log('  Generating duplicate data...');

  const builder = new EdgeCaseXlsxBuilder();

  // Many cells with the same value (tests shared string efficiency)
  const repeatedValue = builder.addSharedString('This value is repeated many times');
  const cells: CellData[] = [];

  for (let row = 1; row <= 100; row++) {
    for (let col = 0; col < 10; col++) {
      cells.push({
        ref: `${colToLetter(col)}${row}`,
        value: repeatedValue,
        type: 's',
      });
    }
  }

  builder.addSheet({
    name: 'Repeated Strings',
    cells,
  });

  // Many cells with same numeric value
  const numericCells: CellData[] = [];
  for (let row = 1; row <= 100; row++) {
    for (let col = 0; col < 10; col++) {
      numericCells.push({
        ref: `${colToLetter(col)}${row}`,
        value: 42,
      });
    }
  }

  builder.addSheet({
    name: 'Repeated Numbers',
    cells: numericCells,
  });

  // Many cells with same formula pattern
  const formulaCells: CellData[] = [];
  for (let row = 1; row <= 50; row++) {
    formulaCells.push({ ref: `A${row}`, value: row });
    formulaCells.push({ ref: `B${row}`, value: row * 10 });
    formulaCells.push({
      ref: `C${row}`,
      formula: `A${row}+B${row}`,
      value: row + row * 10,
    });
  }

  builder.addSheet({
    name: 'Pattern Formulas',
    cells: formulaCells,
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(EDGE_CASES_DIR, 'duplicate-data.xlsx'),
    Buffer.from(buffer),
  );
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('Generating edge case test files...');
  console.log(`Output directory: ${EDGE_CASES_DIR}`);

  // Create output directory
  await fs.promises.mkdir(EDGE_CASES_DIR, { recursive: true });

  // Generate all edge case test files
  await generateMaxCellReference();
  await generateUnicodeContent();
  await generateLongStrings();
  await generateSparseData();
  await generateManySheets();
  await generateDeepFormulas();
  await generateSpecialCharacters();
  await generateNumericEdgeCases();
  await generateEmptyVariations();
  await generateMergeEdgeCases();
  await generateDuplicateData();

  console.log('\nEdge case test files generated successfully!');

  // Count generated files
  const files = await fs.promises.readdir(EDGE_CASES_DIR);
  console.log(`Total files: ${files.length}`);
}

main().catch(console.error);

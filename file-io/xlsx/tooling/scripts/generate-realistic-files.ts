#!/usr/bin/env npx tsx
/**
 * Generate Realistic Test Files (5C-2)
 *
 * Creates XLSX test files that simulate real-world scenarios:
 * - Financial spreadsheet with formulas and formatting
 * - Data table with filters and sorting
 * - Report with headers, merged cells, and charts
 * - Project tracker with conditional formatting
 * - Inventory management system
 *
 * Usage: npx tsx scripts/generate-realistic-files.ts
 */

import * as fs from 'fs';
import JSZip from 'jszip';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, '../test-corpus/generated');
const REALISTIC_DIR = path.join(OUTPUT_DIR, 'realistic');

// =============================================================================
// XML Constants
// =============================================================================

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

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

function dateToSerial(year: number, month: number, day: number): number {
  // Excel date serial: days since 1900-01-01
  const date = new Date(year, month - 1, day);
  const epoch = new Date(1899, 11, 30);
  return Math.floor((date.getTime() - epoch.getTime()) / (24 * 60 * 60 * 1000));
}

// =============================================================================
// Realistic XLSX Builder
// =============================================================================

interface SheetData {
  name: string;
  cells: CellData[];
  merges?: MergeRange[];
  freeze?: { rows: number; cols: number };
  colWidths?: { col: number; width: number }[];
  rowHeights?: { row: number; height: number }[];
  autoFilter?: { start: string; end: string };
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

interface StyleData {
  fonts: FontData[];
  fills: FillData[];
  borders: BorderData[];
  numFmts: NumFmtData[];
  cellXfs: CellXfData[];
}

interface FontData {
  name?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

interface FillData {
  patternType: 'none' | 'solid' | 'gray125';
  fgColor?: string;
  bgColor?: string;
}

interface BorderData {
  left?: BorderSide;
  right?: BorderSide;
  top?: BorderSide;
  bottom?: BorderSide;
}

interface BorderSide {
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';
  color?: string;
}

interface NumFmtData {
  id: number;
  formatCode: string;
}

interface CellXfData {
  fontId?: number;
  fillId?: number;
  borderId?: number;
  numFmtId?: number;
  applyFont?: boolean;
  applyFill?: boolean;
  applyBorder?: boolean;
  applyNumberFormat?: boolean;
  applyAlignment?: boolean;
  alignment?: {
    horizontal?: 'left' | 'center' | 'right';
    vertical?: 'top' | 'center' | 'bottom';
    wrapText?: boolean;
    textRotation?: number;
  };
}

class RealisticXlsxBuilder {
  private sheets: SheetData[] = [];
  private sharedStrings: string[] = [];
  private sharedStringMap: Map<string, number> = new Map();
  private styles: StyleData = {
    fonts: [{ name: 'Calibri', size: 11 }],
    fills: [{ patternType: 'none' }, { patternType: 'gray125' }],
    borders: [{}],
    numFmts: [],
    cellXfs: [{}],
  };

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

  addFont(font: FontData): number {
    this.styles.fonts.push(font);
    return this.styles.fonts.length - 1;
  }

  addFill(fill: FillData): number {
    this.styles.fills.push(fill);
    return this.styles.fills.length - 1;
  }

  addBorder(border: BorderData): number {
    this.styles.borders.push(border);
    return this.styles.borders.length - 1;
  }

  addNumFmt(numFmt: NumFmtData): void {
    this.styles.numFmts.push(numFmt);
  }

  addCellXf(xf: CellXfData): number {
    this.styles.cellXfs.push(xf);
    return this.styles.cellXfs.length - 1;
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

    zip.file('xl/styles.xml', this.buildStyles());

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
      const rowHeight = sheet.rowHeights?.find((rh) => rh.row + 1 === rowNum);
      if (rowHeight) {
        xml += `\n    <row r="${rowNum}" ht="${rowHeight.height}" customHeight="1">`;
      } else {
        xml += `\n    <row r="${rowNum}">`;
      }

      for (const cell of cells) {
        xml += this.buildCell(cell);
      }
      xml += '\n    </row>';
    }

    xml += '\n  </sheetData>';

    // Auto filter
    if (sheet.autoFilter) {
      xml += `\n  <autoFilter ref="${sheet.autoFilter.start}:${sheet.autoFilter.end}"/>`;
    }

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

  private buildStyles(): string {
    let xml = `${XML_DECLARATION}
<styleSheet xmlns="${NS_MAIN}">`;

    // Number formats
    if (this.styles.numFmts.length > 0) {
      xml += `\n  <numFmts count="${this.styles.numFmts.length}">`;
      for (const nf of this.styles.numFmts) {
        xml += `\n    <numFmt numFmtId="${nf.id}" formatCode="${escapeXml(nf.formatCode)}"/>`;
      }
      xml += '\n  </numFmts>';
    }

    // Fonts
    xml += `\n  <fonts count="${this.styles.fonts.length}">`;
    for (const font of this.styles.fonts) {
      xml += '\n    <font>';
      if (font.bold) xml += '<b/>';
      if (font.italic) xml += '<i/>';
      if (font.underline) xml += '<u/>';
      if (font.size) xml += `<sz val="${font.size}"/>`;
      if (font.color) xml += `<color rgb="${font.color}"/>`;
      if (font.name) xml += `<name val="${escapeXml(font.name)}"/>`;
      xml += '</font>';
    }
    xml += '\n  </fonts>';

    // Fills
    xml += `\n  <fills count="${this.styles.fills.length}">`;
    for (const fill of this.styles.fills) {
      xml += '\n    <fill>';
      xml += `<patternFill patternType="${fill.patternType}"`;
      if (fill.fgColor || fill.bgColor) {
        xml += '>';
        if (fill.fgColor) xml += `<fgColor rgb="${fill.fgColor}"/>`;
        if (fill.bgColor) xml += `<bgColor rgb="${fill.bgColor}"/>`;
        xml += '</patternFill>';
      } else {
        xml += '/>';
      }
      xml += '</fill>';
    }
    xml += '\n  </fills>';

    // Borders
    xml += `\n  <borders count="${this.styles.borders.length}">`;
    for (const border of this.styles.borders) {
      xml += '\n    <border>';
      xml += this.buildBorderSide('left', border.left);
      xml += this.buildBorderSide('right', border.right);
      xml += this.buildBorderSide('top', border.top);
      xml += this.buildBorderSide('bottom', border.bottom);
      xml += '</border>';
    }
    xml += '\n  </borders>';

    xml += '\n  <cellStyleXfs count="1"><xf/></cellStyleXfs>';

    // Cell XFs
    xml += `\n  <cellXfs count="${this.styles.cellXfs.length}">`;
    for (const xf of this.styles.cellXfs) {
      xml += '\n    <xf';
      if (xf.numFmtId !== undefined) xml += ` numFmtId="${xf.numFmtId}"`;
      if (xf.fontId !== undefined) xml += ` fontId="${xf.fontId}"`;
      if (xf.fillId !== undefined) xml += ` fillId="${xf.fillId}"`;
      if (xf.borderId !== undefined) xml += ` borderId="${xf.borderId}"`;
      if (xf.applyNumberFormat) xml += ' applyNumberFormat="1"';
      if (xf.applyFont) xml += ' applyFont="1"';
      if (xf.applyFill) xml += ' applyFill="1"';
      if (xf.applyBorder) xml += ' applyBorder="1"';
      if (xf.applyAlignment) xml += ' applyAlignment="1"';

      if (xf.alignment) {
        xml += '><alignment';
        if (xf.alignment.horizontal) xml += ` horizontal="${xf.alignment.horizontal}"`;
        if (xf.alignment.vertical) xml += ` vertical="${xf.alignment.vertical}"`;
        if (xf.alignment.wrapText) xml += ' wrapText="1"';
        if (xf.alignment.textRotation !== undefined)
          xml += ` textRotation="${xf.alignment.textRotation}"`;
        xml += '/></xf>';
      } else {
        xml += '/>';
      }
    }
    xml += '\n  </cellXfs>';

    xml += '\n</styleSheet>';

    return xml;
  }

  private buildBorderSide(name: string, side?: BorderSide): string {
    if (!side) return `<${name}/>`;
    let xml = `<${name} style="${side.style}"`;
    if (side.color) {
      xml += `><color rgb="${side.color}"/></${name}>`;
    } else {
      xml += '/>';
    }
    return xml;
  }
}

// =============================================================================
// Realistic File Generators
// =============================================================================

async function generateFinancialSpreadsheet(): Promise<void> {
  console.log('  Generating financial spreadsheet...');

  const builder = new RealisticXlsxBuilder();

  // Add number formats
  builder.addNumFmt({ id: 164, formatCode: '$#,##0.00' });
  builder.addNumFmt({ id: 165, formatCode: '0.00%' });
  builder.addNumFmt({ id: 166, formatCode: 'yyyy-mm-dd' });

  // Add fonts
  const titleFontId = builder.addFont({ name: 'Calibri', size: 18, bold: true });
  const headerFontId = builder.addFont({
    name: 'Calibri',
    size: 11,
    bold: true,
    color: 'FFFFFFFF',
  });
  const subtotalFontId = builder.addFont({ name: 'Calibri', size: 11, bold: true });
  const grandTotalFontId = builder.addFont({ name: 'Calibri', size: 12, bold: true });

  // Add fills
  const headerFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF2F5496' });
  const subtotalFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFD9E2F3' });
  const grandTotalFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF8EA9DB' });
  const incomeFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFC6EFCE' });
  const expenseFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFFFC7CE' });

  // Add borders
  const thinBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
  });

  const thickBottomBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'medium', color: 'FF000000' },
  });

  // Add cell XFs
  const titleStyleId = builder.addCellXf({ fontId: titleFontId, applyFont: true });
  const headerStyleId = builder.addCellXf({
    fontId: headerFontId,
    fillId: headerFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const currencyStyleId = builder.addCellXf({
    numFmtId: 164,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const percentStyleId = builder.addCellXf({
    numFmtId: 165,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const dateStyleId = builder.addCellXf({
    numFmtId: 166,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const textStyleId = builder.addCellXf({
    borderId: thinBorderId,
    applyBorder: true,
  });
  const subtotalStyleId = builder.addCellXf({
    fontId: subtotalFontId,
    fillId: subtotalFillId,
    numFmtId: 164,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const grandTotalStyleId = builder.addCellXf({
    fontId: grandTotalFontId,
    fillId: grandTotalFillId,
    numFmtId: 164,
    borderId: thickBottomBorderId,
    applyFont: true,
    applyFill: true,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const incomeStyleId = builder.addCellXf({
    fillId: incomeFillId,
    numFmtId: 164,
    borderId: thinBorderId,
    applyFill: true,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const expenseStyleId = builder.addCellXf({
    fillId: expenseFillId,
    numFmtId: 164,
    borderId: thinBorderId,
    applyFill: true,
    applyNumberFormat: true,
    applyBorder: true,
  });

  const cells: CellData[] = [];

  // Title
  cells.push({
    ref: 'A1',
    value: builder.addSharedString('Annual Budget Report 2024'),
    type: 's',
    styleIndex: titleStyleId,
  });

  // Headers
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
    'Total',
  ];
  cells.push({
    ref: 'A3',
    value: builder.addSharedString('Category'),
    type: 's',
    styleIndex: headerStyleId,
  });
  for (let i = 0; i < months.length; i++) {
    cells.push({
      ref: `${colToLetter(i + 1)}3`,
      value: builder.addSharedString(months[i]),
      type: 's',
      styleIndex: headerStyleId,
    });
  }

  // Income Section
  cells.push({
    ref: 'A4',
    value: builder.addSharedString('INCOME'),
    type: 's',
    styleIndex: textStyleId,
  });
  const incomeItems = ['Sales Revenue', 'Service Revenue', 'Interest Income', 'Other Income'];

  let row = 5;
  for (const item of incomeItems) {
    cells.push({
      ref: `A${row}`,
      value: builder.addSharedString(item),
      type: 's',
      styleIndex: textStyleId,
    });
    for (let m = 0; m < 12; m++) {
      const value = Math.round((Math.random() * 50000 + 10000) * 100) / 100;
      cells.push({ ref: `${colToLetter(m + 1)}${row}`, value, styleIndex: incomeStyleId });
    }
    // Total formula
    cells.push({
      ref: `N${row}`,
      formula: `SUM(B${row}:M${row})`,
      value: 0,
      styleIndex: subtotalStyleId,
    });
    row++;
  }

  // Income subtotal
  const incomeSubtotalRow = row;
  cells.push({
    ref: `A${row}`,
    value: builder.addSharedString('Total Income'),
    type: 's',
    styleIndex: subtotalStyleId,
  });
  for (let m = 0; m < 13; m++) {
    cells.push({
      ref: `${colToLetter(m + 1)}${row}`,
      formula: `SUM(${colToLetter(m + 1)}5:${colToLetter(m + 1)}${row - 1})`,
      value: 0,
      styleIndex: subtotalStyleId,
    });
  }
  row += 2;

  // Expense Section
  cells.push({
    ref: `A${row}`,
    value: builder.addSharedString('EXPENSES'),
    type: 's',
    styleIndex: textStyleId,
  });
  row++;

  const expenseItems = [
    'Salaries',
    'Rent',
    'Utilities',
    'Marketing',
    'Supplies',
    'Insurance',
    'Travel',
    'Depreciation',
  ];
  const expenseStartRow = row;

  for (const item of expenseItems) {
    cells.push({
      ref: `A${row}`,
      value: builder.addSharedString(item),
      type: 's',
      styleIndex: textStyleId,
    });
    for (let m = 0; m < 12; m++) {
      const value = Math.round((Math.random() * 20000 + 5000) * 100) / 100;
      cells.push({ ref: `${colToLetter(m + 1)}${row}`, value, styleIndex: expenseStyleId });
    }
    cells.push({
      ref: `N${row}`,
      formula: `SUM(B${row}:M${row})`,
      value: 0,
      styleIndex: subtotalStyleId,
    });
    row++;
  }

  // Expense subtotal
  const expenseSubtotalRow = row;
  cells.push({
    ref: `A${row}`,
    value: builder.addSharedString('Total Expenses'),
    type: 's',
    styleIndex: subtotalStyleId,
  });
  for (let m = 0; m < 13; m++) {
    cells.push({
      ref: `${colToLetter(m + 1)}${row}`,
      formula: `SUM(${colToLetter(m + 1)}${expenseStartRow}:${colToLetter(m + 1)}${row - 1})`,
      value: 0,
      styleIndex: subtotalStyleId,
    });
  }
  row += 2;

  // Net Income
  cells.push({
    ref: `A${row}`,
    value: builder.addSharedString('NET INCOME'),
    type: 's',
    styleIndex: grandTotalStyleId,
  });
  for (let m = 0; m < 13; m++) {
    cells.push({
      ref: `${colToLetter(m + 1)}${row}`,
      formula: `${colToLetter(m + 1)}${incomeSubtotalRow}-${colToLetter(m + 1)}${expenseSubtotalRow}`,
      value: 0,
      styleIndex: grandTotalStyleId,
    });
  }

  builder.addSheet({
    name: 'Annual Budget',
    cells,
    freeze: { rows: 3, cols: 1 },
    colWidths: [
      { col: 0, width: 20 },
      ...Array.from({ length: 13 }, (_, i) => ({ col: i + 1, width: 12 })),
    ],
    merges: [{ start: 'A1', end: 'N1' }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(REALISTIC_DIR, 'financial-budget.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateSalesReport(): Promise<void> {
  console.log('  Generating sales report...');

  const builder = new RealisticXlsxBuilder();

  // Add number formats
  builder.addNumFmt({ id: 164, formatCode: '$#,##0.00' });
  builder.addNumFmt({ id: 165, formatCode: 'yyyy-mm-dd' });

  // Add fonts
  const headerFontId = builder.addFont({
    name: 'Calibri',
    size: 11,
    bold: true,
    color: 'FFFFFFFF',
  });

  // Add fills
  const headerFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF4472C4' });
  const altRowFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFDEEAF6' });

  // Add borders
  const thinBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
  });

  // Add cell XFs
  const headerStyleId = builder.addCellXf({
    fontId: headerFontId,
    fillId: headerFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const dataStyleId = builder.addCellXf({
    borderId: thinBorderId,
    applyBorder: true,
  });
  const dataAltStyleId = builder.addCellXf({
    fillId: altRowFillId,
    borderId: thinBorderId,
    applyFill: true,
    applyBorder: true,
  });
  const currencyStyleId = builder.addCellXf({
    numFmtId: 164,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const currencyAltStyleId = builder.addCellXf({
    numFmtId: 164,
    fillId: altRowFillId,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyFill: true,
    applyBorder: true,
  });
  const dateStyleId = builder.addCellXf({
    numFmtId: 165,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const dateAltStyleId = builder.addCellXf({
    numFmtId: 165,
    fillId: altRowFillId,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyFill: true,
    applyBorder: true,
  });

  const cells: CellData[] = [];

  // Headers
  const headers = [
    'Order ID',
    'Date',
    'Customer',
    'Region',
    'Product',
    'Category',
    'Quantity',
    'Unit Price',
    'Total',
  ];
  for (let i = 0; i < headers.length; i++) {
    cells.push({
      ref: `${colToLetter(i)}1`,
      value: builder.addSharedString(headers[i]),
      type: 's',
      styleIndex: headerStyleId,
    });
  }

  // Sample data
  const customers = [
    'Acme Corp',
    'Widget Inc',
    'Tech Solutions',
    'Global Industries',
    'Metro Systems',
  ];
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const products = ['Laptop', 'Monitor', 'Keyboard', 'Mouse', 'Printer', 'Scanner', 'Webcam'];
  const categories = ['Electronics', 'Peripherals', 'Accessories'];

  for (let i = 2; i <= 501; i++) {
    const isAlt = i % 2 === 0;
    const baseStyle = isAlt ? dataAltStyleId : dataStyleId;
    const currStyle = isAlt ? currencyAltStyleId : currencyStyleId;
    const dtStyle = isAlt ? dateAltStyleId : dateStyleId;

    const orderId = 10000 + i - 1;
    const dateSerial = dateToSerial(
      2024,
      Math.floor(Math.random() * 12) + 1,
      Math.floor(Math.random() * 28) + 1,
    );
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const region = regions[Math.floor(Math.random() * regions.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const quantity = Math.floor(Math.random() * 50) + 1;
    const unitPrice = Math.round((Math.random() * 1000 + 50) * 100) / 100;

    cells.push({ ref: `A${i}`, value: orderId, styleIndex: baseStyle });
    cells.push({ ref: `B${i}`, value: dateSerial, styleIndex: dtStyle });
    cells.push({
      ref: `C${i}`,
      value: builder.addSharedString(customer),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `D${i}`,
      value: builder.addSharedString(region),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `E${i}`,
      value: builder.addSharedString(product),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `F${i}`,
      value: builder.addSharedString(category),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({ ref: `G${i}`, value: quantity, styleIndex: baseStyle });
    cells.push({ ref: `H${i}`, value: unitPrice, styleIndex: currStyle });
    cells.push({
      ref: `I${i}`,
      formula: `G${i}*H${i}`,
      value: quantity * unitPrice,
      styleIndex: currStyle,
    });
  }

  builder.addSheet({
    name: 'Sales Data',
    cells,
    freeze: { rows: 1, cols: 0 },
    autoFilter: { start: 'A1', end: 'I501' },
    colWidths: [
      { col: 0, width: 10 },
      { col: 1, width: 12 },
      { col: 2, width: 18 },
      { col: 3, width: 10 },
      { col: 4, width: 12 },
      { col: 5, width: 12 },
      { col: 6, width: 10 },
      { col: 7, width: 12 },
      { col: 8, width: 12 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(REALISTIC_DIR, 'sales-report.xlsx'), Buffer.from(buffer));
}

async function generateProjectTracker(): Promise<void> {
  console.log('  Generating project tracker...');

  const builder = new RealisticXlsxBuilder();

  // Add number formats
  builder.addNumFmt({ id: 164, formatCode: 'yyyy-mm-dd' });
  builder.addNumFmt({ id: 165, formatCode: '0%' });

  // Add fonts
  const titleFontId = builder.addFont({ name: 'Calibri', size: 16, bold: true });
  const headerFontId = builder.addFont({
    name: 'Calibri',
    size: 11,
    bold: true,
    color: 'FFFFFFFF',
  });
  const completeFontId = builder.addFont({ name: 'Calibri', size: 11, italic: true });

  // Add fills
  const headerFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF305496' });
  const notStartedFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFE0E0E0' });
  const inProgressFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFFFEB9C' });
  const completeFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFC6EFCE' });
  const blockedFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFFFC7CE' });
  const onHoldFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFDDEBF7' });

  // Add borders
  const thinBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
  });

  // Add cell XFs
  const titleStyleId = builder.addCellXf({ fontId: titleFontId, applyFont: true });
  const headerStyleId = builder.addCellXf({
    fontId: headerFontId,
    fillId: headerFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const dataStyleId = builder.addCellXf({ borderId: thinBorderId, applyBorder: true });
  const dateStyleId = builder.addCellXf({
    numFmtId: 164,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const percentStyleId = builder.addCellXf({
    numFmtId: 165,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const notStartedStyleId = builder.addCellXf({
    fillId: notStartedFillId,
    borderId: thinBorderId,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const inProgressStyleId = builder.addCellXf({
    fillId: inProgressFillId,
    borderId: thinBorderId,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const completeStyleId = builder.addCellXf({
    fontId: completeFontId,
    fillId: completeFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const blockedStyleId = builder.addCellXf({
    fillId: blockedFillId,
    borderId: thinBorderId,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const onHoldStyleId = builder.addCellXf({
    fillId: onHoldFillId,
    borderId: thinBorderId,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });

  const cells: CellData[] = [];

  // Title
  cells.push({
    ref: 'A1',
    value: builder.addSharedString('Project Alpha - Task Tracker'),
    type: 's',
    styleIndex: titleStyleId,
  });

  // Headers
  const headers = [
    'Task ID',
    'Task Name',
    'Assignee',
    'Priority',
    'Status',
    'Start Date',
    'Due Date',
    'Progress',
    'Notes',
  ];
  for (let i = 0; i < headers.length; i++) {
    cells.push({
      ref: `${colToLetter(i)}3`,
      value: builder.addSharedString(headers[i]),
      type: 's',
      styleIndex: headerStyleId,
    });
  }

  // Tasks
  const assignees = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
  const priorities = ['Low', 'Medium', 'High', 'Critical'];
  const statuses = ['Not Started', 'In Progress', 'Complete', 'Blocked', 'On Hold'];
  const statusStyles: { [key: string]: number } = {
    'Not Started': notStartedStyleId,
    'In Progress': inProgressStyleId,
    Complete: completeStyleId,
    Blocked: blockedStyleId,
    'On Hold': onHoldStyleId,
  };

  const tasks = [
    { name: 'Requirements Analysis', assignee: 0, priority: 2, status: 2, progress: 1 },
    { name: 'System Design', assignee: 1, priority: 2, status: 2, progress: 1 },
    { name: 'Database Schema', assignee: 2, priority: 2, status: 1, progress: 0.75 },
    { name: 'API Development', assignee: 3, priority: 3, status: 1, progress: 0.5 },
    { name: 'Frontend Setup', assignee: 4, priority: 1, status: 1, progress: 0.6 },
    { name: 'Authentication Module', assignee: 0, priority: 3, status: 3, progress: 0.3 },
    { name: 'User Dashboard', assignee: 1, priority: 1, status: 0, progress: 0 },
    { name: 'Reporting Module', assignee: 2, priority: 1, status: 0, progress: 0 },
    { name: 'Integration Testing', assignee: 3, priority: 2, status: 4, progress: 0.2 },
    { name: 'Performance Testing', assignee: 4, priority: 2, status: 0, progress: 0 },
    { name: 'Security Audit', assignee: 0, priority: 3, status: 0, progress: 0 },
    { name: 'Documentation', assignee: 1, priority: 1, status: 1, progress: 0.4 },
    { name: 'Deployment Setup', assignee: 2, priority: 2, status: 0, progress: 0 },
    { name: 'User Training', assignee: 3, priority: 1, status: 0, progress: 0 },
    { name: 'Go-Live Support', assignee: 4, priority: 3, status: 0, progress: 0 },
  ];

  for (let i = 0; i < tasks.length; i++) {
    const row = i + 4;
    const task = tasks[i];
    const status = statuses[task.status];
    const startDate = dateToSerial(2024, 1, 1 + i * 7);
    const dueDate = dateToSerial(2024, 1, 1 + i * 7 + 14);

    cells.push({
      ref: `A${row}`,
      value: builder.addSharedString(`TASK-${String(i + 1).padStart(3, '0')}`),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `B${row}`,
      value: builder.addSharedString(task.name),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `C${row}`,
      value: builder.addSharedString(assignees[task.assignee]),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `D${row}`,
      value: builder.addSharedString(priorities[task.priority]),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `E${row}`,
      value: builder.addSharedString(status),
      type: 's',
      styleIndex: statusStyles[status],
    });
    cells.push({ ref: `F${row}`, value: startDate, styleIndex: dateStyleId });
    cells.push({ ref: `G${row}`, value: dueDate, styleIndex: dateStyleId });
    cells.push({ ref: `H${row}`, value: task.progress, styleIndex: percentStyleId });
    cells.push({
      ref: `I${row}`,
      value: builder.addSharedString(''),
      type: 's',
      styleIndex: dataStyleId,
    });
  }

  builder.addSheet({
    name: 'Task Tracker',
    cells,
    freeze: { rows: 3, cols: 2 },
    colWidths: [
      { col: 0, width: 12 },
      { col: 1, width: 25 },
      { col: 2, width: 12 },
      { col: 3, width: 10 },
      { col: 4, width: 12 },
      { col: 5, width: 12 },
      { col: 6, width: 12 },
      { col: 7, width: 10 },
      { col: 8, width: 30 },
    ],
    merges: [{ start: 'A1', end: 'I1' }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(REALISTIC_DIR, 'project-tracker.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateInventorySystem(): Promise<void> {
  console.log('  Generating inventory system...');

  const builder = new RealisticXlsxBuilder();

  // Add number formats
  builder.addNumFmt({ id: 164, formatCode: '$#,##0.00' });
  builder.addNumFmt({ id: 165, formatCode: '#,##0' });

  // Add fonts
  const headerFontId = builder.addFont({
    name: 'Calibri',
    size: 11,
    bold: true,
    color: 'FFFFFFFF',
  });
  const lowStockFontId = builder.addFont({
    name: 'Calibri',
    size: 11,
    bold: true,
    color: 'FF9C0006',
  });

  // Add fills
  const headerFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF538135' });
  const lowStockFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFFFC7CE' });

  // Add borders
  const thinBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
  });

  // Add cell XFs
  const headerStyleId = builder.addCellXf({
    fontId: headerFontId,
    fillId: headerFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const dataStyleId = builder.addCellXf({ borderId: thinBorderId, applyBorder: true });
  const numberStyleId = builder.addCellXf({
    numFmtId: 165,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const currencyStyleId = builder.addCellXf({
    numFmtId: 164,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const lowStockStyleId = builder.addCellXf({
    fontId: lowStockFontId,
    fillId: lowStockFillId,
    numFmtId: 165,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyNumberFormat: true,
    applyBorder: true,
  });

  const cells: CellData[] = [];

  // Headers
  const headers = [
    'SKU',
    'Product Name',
    'Category',
    'Supplier',
    'Quantity',
    'Reorder Level',
    'Unit Cost',
    'Total Value',
    'Status',
  ];
  for (let i = 0; i < headers.length; i++) {
    cells.push({
      ref: `${colToLetter(i)}1`,
      value: builder.addSharedString(headers[i]),
      type: 's',
      styleIndex: headerStyleId,
    });
  }

  // Inventory items
  const categories = ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Automotive'];
  const suppliers = ['Supplier A', 'Supplier B', 'Supplier C', 'Supplier D'];
  const products = [
    'Wireless Mouse',
    'USB Cable 3m',
    'HDMI Adapter',
    'Bluetooth Speaker',
    'Power Bank',
    'T-Shirt Cotton',
    'Jeans Slim Fit',
    'Running Shoes',
    'Sports Watch',
    'Backpack Pro',
    'Garden Hose 10m',
    'Plant Pot Set',
    'LED Light Bulbs',
    'Tool Kit Basic',
    'Car Charger',
    'Yoga Mat Premium',
    'Dumbbell Set',
    'Tennis Racket',
    'Soccer Ball',
    'Bike Helmet',
    'Motor Oil 5W30',
    'Air Freshener',
    'Car Vacuum',
    'Jump Starter',
    'Dash Camera',
  ];

  for (let i = 0; i < products.length; i++) {
    const row = i + 2;
    const quantity = Math.floor(Math.random() * 500);
    const reorderLevel = Math.floor(Math.random() * 100) + 20;
    const unitCost = Math.round((Math.random() * 100 + 5) * 100) / 100;
    const isLowStock = quantity < reorderLevel;

    cells.push({
      ref: `A${row}`,
      value: builder.addSharedString(`SKU${String(1000 + i).padStart(5, '0')}`),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `B${row}`,
      value: builder.addSharedString(products[i]),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `C${row}`,
      value: builder.addSharedString(categories[i % categories.length]),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `D${row}`,
      value: builder.addSharedString(suppliers[i % suppliers.length]),
      type: 's',
      styleIndex: dataStyleId,
    });
    cells.push({
      ref: `E${row}`,
      value: quantity,
      styleIndex: isLowStock ? lowStockStyleId : numberStyleId,
    });
    cells.push({ ref: `F${row}`, value: reorderLevel, styleIndex: numberStyleId });
    cells.push({ ref: `G${row}`, value: unitCost, styleIndex: currencyStyleId });
    cells.push({
      ref: `H${row}`,
      formula: `E${row}*G${row}`,
      value: quantity * unitCost,
      styleIndex: currencyStyleId,
    });
    cells.push({
      ref: `I${row}`,
      formula: `IF(E${row}<F${row},"Low Stock","In Stock")`,
      value: builder.addSharedString(isLowStock ? 'Low Stock' : 'In Stock'),
      type: 's',
      styleIndex: dataStyleId,
    });
  }

  builder.addSheet({
    name: 'Inventory',
    cells,
    freeze: { rows: 1, cols: 2 },
    autoFilter: { start: 'A1', end: `I${products.length + 1}` },
    colWidths: [
      { col: 0, width: 15 },
      { col: 1, width: 20 },
      { col: 2, width: 15 },
      { col: 3, width: 12 },
      { col: 4, width: 10 },
      { col: 5, width: 14 },
      { col: 6, width: 12 },
      { col: 7, width: 12 },
      { col: 8, width: 12 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(REALISTIC_DIR, 'inventory-system.xlsx'),
    Buffer.from(buffer),
  );
}

async function generateEmployeeDirectory(): Promise<void> {
  console.log('  Generating employee directory...');

  const builder = new RealisticXlsxBuilder();

  // Add number formats
  builder.addNumFmt({ id: 164, formatCode: 'yyyy-mm-dd' });
  builder.addNumFmt({ id: 165, formatCode: '$#,##0' });

  // Add fonts
  const titleFontId = builder.addFont({ name: 'Calibri', size: 16, bold: true, color: 'FF1F4E79' });
  const headerFontId = builder.addFont({
    name: 'Calibri',
    size: 11,
    bold: true,
    color: 'FFFFFFFF',
  });
  const managerFontId = builder.addFont({ name: 'Calibri', size: 11, bold: true });

  // Add fills
  const headerFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF1F4E79' });
  const managerFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFDCE6F1' });

  // Add borders
  const thinBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
  });

  // Add cell XFs
  const titleStyleId = builder.addCellXf({ fontId: titleFontId, applyFont: true });
  const headerStyleId = builder.addCellXf({
    fontId: headerFontId,
    fillId: headerFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const dataStyleId = builder.addCellXf({ borderId: thinBorderId, applyBorder: true });
  const dateStyleId = builder.addCellXf({
    numFmtId: 164,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const salaryStyleId = builder.addCellXf({
    numFmtId: 165,
    borderId: thinBorderId,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const managerStyleId = builder.addCellXf({
    fontId: managerFontId,
    fillId: managerFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
  });
  const managerDateStyleId = builder.addCellXf({
    fontId: managerFontId,
    fillId: managerFillId,
    numFmtId: 164,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyNumberFormat: true,
    applyBorder: true,
  });
  const managerSalaryStyleId = builder.addCellXf({
    fontId: managerFontId,
    fillId: managerFillId,
    numFmtId: 165,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyNumberFormat: true,
    applyBorder: true,
  });

  const cells: CellData[] = [];

  // Title
  cells.push({
    ref: 'A1',
    value: builder.addSharedString('Employee Directory'),
    type: 's',
    styleIndex: titleStyleId,
  });

  // Headers
  const headers = [
    'Employee ID',
    'First Name',
    'Last Name',
    'Email',
    'Department',
    'Position',
    'Hire Date',
    'Salary',
    'Manager',
  ];
  for (let i = 0; i < headers.length; i++) {
    cells.push({
      ref: `${colToLetter(i)}3`,
      value: builder.addSharedString(headers[i]),
      type: 's',
      styleIndex: headerStyleId,
    });
  }

  // Employee data
  const firstNames = [
    'James',
    'Mary',
    'John',
    'Patricia',
    'Robert',
    'Jennifer',
    'Michael',
    'Linda',
    'William',
    'Elizabeth',
  ];
  const lastNames = [
    'Smith',
    'Johnson',
    'Williams',
    'Brown',
    'Jones',
    'Garcia',
    'Miller',
    'Davis',
    'Rodriguez',
    'Martinez',
  ];
  const departments = ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance', 'Operations'];
  const positions = ['Developer', 'Sales Rep', 'Manager', 'Analyst', 'Director', 'VP'];

  const employees = [];
  for (let i = 0; i < 30; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
    const department = departments[i % departments.length];
    const position = i % 5 === 0 ? 'Manager' : positions[i % positions.length];
    const isManager = position === 'Manager' || position === 'Director' || position === 'VP';

    employees.push({
      id: `EMP${String(1001 + i).padStart(4, '0')}`,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@company.com`,
      department,
      position,
      hireDate: dateToSerial(2015 + (i % 10), (i % 12) + 1, (i % 28) + 1),
      salary: 50000 + Math.floor(Math.random() * 100000),
      manager: i < 5 ? '' : `EMP${String(1001 + (i % 5)).padStart(4, '0')}`,
      isManager,
    });
  }

  for (let i = 0; i < employees.length; i++) {
    const row = i + 4;
    const emp = employees[i];
    const baseStyle = emp.isManager ? managerStyleId : dataStyleId;
    const dtStyle = emp.isManager ? managerDateStyleId : dateStyleId;
    const salStyle = emp.isManager ? managerSalaryStyleId : salaryStyleId;

    cells.push({
      ref: `A${row}`,
      value: builder.addSharedString(emp.id),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `B${row}`,
      value: builder.addSharedString(emp.firstName),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `C${row}`,
      value: builder.addSharedString(emp.lastName),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `D${row}`,
      value: builder.addSharedString(emp.email),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `E${row}`,
      value: builder.addSharedString(emp.department),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({
      ref: `F${row}`,
      value: builder.addSharedString(emp.position),
      type: 's',
      styleIndex: baseStyle,
    });
    cells.push({ ref: `G${row}`, value: emp.hireDate, styleIndex: dtStyle });
    cells.push({ ref: `H${row}`, value: emp.salary, styleIndex: salStyle });
    cells.push({
      ref: `I${row}`,
      value: builder.addSharedString(emp.manager),
      type: 's',
      styleIndex: baseStyle,
    });
  }

  builder.addSheet({
    name: 'Employees',
    cells,
    freeze: { rows: 3, cols: 1 },
    autoFilter: { start: 'A3', end: `I${employees.length + 3}` },
    colWidths: [
      { col: 0, width: 12 },
      { col: 1, width: 12 },
      { col: 2, width: 12 },
      { col: 3, width: 30 },
      { col: 4, width: 14 },
      { col: 5, width: 12 },
      { col: 6, width: 12 },
      { col: 7, width: 12 },
      { col: 8, width: 12 },
    ],
    merges: [{ start: 'A1', end: 'I1' }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(
    path.join(REALISTIC_DIR, 'employee-directory.xlsx'),
    Buffer.from(buffer),
  );
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('Generating realistic test files...');
  console.log(`Output directory: ${REALISTIC_DIR}`);

  // Create output directory
  await fs.promises.mkdir(REALISTIC_DIR, { recursive: true });

  // Generate all realistic test files
  await generateFinancialSpreadsheet();
  await generateSalesReport();
  await generateProjectTracker();
  await generateInventorySystem();
  await generateEmployeeDirectory();

  console.log('\nRealistic test files generated successfully!');

  // Count generated files
  const files = await fs.promises.readdir(REALISTIC_DIR);
  console.log(`Total files: ${files.length}`);
}

main().catch(console.error);

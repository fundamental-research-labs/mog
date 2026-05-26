#!/usr/bin/env npx tsx
/**
 * Generate Feature Coverage Test Files (5C-1)
 *
 * Creates XLSX test files that cover each ECMA-376 feature:
 * - Basic: different data types, formulas, formatting
 * - Styles: fonts, fills, borders, number formats
 * - Features: merged cells, frozen panes, tables, charts
 * - Advanced: conditional formatting, data validation, sparklines
 *
 * Usage: npx tsx scripts/generate-test-files.ts
 */

import * as fs from 'fs';
import JSZip from 'jszip';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, '../test-corpus/generated');
const FEATURE_DIR = path.join(OUTPUT_DIR, 'features');

// =============================================================================
// XML Templates
// =============================================================================

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NAMESPACES = {
  main: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  x14: 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main',
  x14ac: 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac',
  xr: 'http://schemas.microsoft.com/office/spreadsheetml/2014/revision',
  xr2: 'http://schemas.microsoft.com/office/spreadsheetml/2015/revision2',
  xr3: 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision3',
  xr6: 'http://schemas.microsoft.com/office/spreadsheetml/2014/revision6',
  xr10: 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision10',
};

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
// XLSX Builder
// =============================================================================

interface SheetData {
  name: string;
  cells: CellData[];
  merges?: MergeRange[];
  freeze?: { rows: number; cols: number };
  colWidths?: { col: number; width: number }[];
  rowHeights?: { row: number; height: number }[];
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
  fonts?: FontData[];
  fills?: FillData[];
  borders?: BorderData[];
  numFmts?: NumFmtData[];
  cellXfs?: CellXfData[];
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

class XlsxBuilder {
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
    if (existing !== undefined) {
      return existing;
    }
    const index = this.sharedStrings.length;
    this.sharedStrings.push(str);
    this.sharedStringMap.set(str, index);
    return index;
  }

  addFont(font: FontData): number {
    this.styles.fonts!.push(font);
    return this.styles.fonts!.length - 1;
  }

  addFill(fill: FillData): number {
    this.styles.fills!.push(fill);
    return this.styles.fills!.length - 1;
  }

  addBorder(border: BorderData): number {
    this.styles.borders!.push(border);
    return this.styles.borders!.length - 1;
  }

  addNumFmt(numFmt: NumFmtData): void {
    this.styles.numFmts!.push(numFmt);
  }

  addCellXf(xf: CellXfData): number {
    this.styles.cellXfs!.push(xf);
    return this.styles.cellXfs!.length - 1;
  }

  async build(): Promise<ArrayBuffer> {
    const zip = new JSZip();

    // Content Types
    zip.file('[Content_Types].xml', this.buildContentTypes());

    // Relationships
    zip.file('_rels/.rels', this.buildRootRels());
    zip.file('xl/_rels/workbook.xml.rels', this.buildWorkbookRels());

    // Workbook
    zip.file('xl/workbook.xml', this.buildWorkbook());

    // Worksheets
    for (let i = 0; i < this.sheets.length; i++) {
      zip.file(`xl/worksheets/sheet${i + 1}.xml`, this.buildWorksheet(this.sheets[i]));
    }

    // Shared strings
    if (this.sharedStrings.length > 0) {
      zip.file('xl/sharedStrings.xml', this.buildSharedStrings());
    }

    // Styles
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
<workbook xmlns="${NAMESPACES.main}" xmlns:r="${NAMESPACES.r}">
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
<worksheet xmlns="${NAMESPACES.main}" xmlns:r="${NAMESPACES.r}">`;

    // Column widths
    if (sheet.colWidths && sheet.colWidths.length > 0) {
      xml += '\n  <cols>';
      for (const cw of sheet.colWidths) {
        xml += `\n    <col min="${cw.col + 1}" max="${cw.col + 1}" width="${cw.width}" customWidth="1"/>`;
      }
      xml += '\n  </cols>';
    }

    // Freeze panes (sheetViews)
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
      if (!rowMap.has(row)) {
        rowMap.set(row, []);
      }
      rowMap.get(row)!.push(cell);
    }

    // Sort rows
    const sortedRows = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);

    for (const [rowNum, cells] of sortedRows) {
      // Check for custom row height
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

    if (cell.type) {
      xml += ` t="${cell.type}"`;
    }

    if (cell.styleIndex !== undefined && cell.styleIndex > 0) {
      xml += ` s="${cell.styleIndex}"`;
    }

    xml += '>';

    if (cell.formula) {
      xml += `<f>${escapeXml(cell.formula)}</f>`;
    }

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
<sst xmlns="${NAMESPACES.main}" count="${this.sharedStrings.length}" uniqueCount="${this.sharedStrings.length}">`;

    for (const str of this.sharedStrings) {
      xml += `\n  <si><t>${escapeXml(str)}</t></si>`;
    }

    xml += '\n</sst>';

    return xml;
  }

  private buildStyles(): string {
    let xml = `${XML_DECLARATION}
<styleSheet xmlns="${NAMESPACES.main}">`;

    // Number formats
    if (this.styles.numFmts && this.styles.numFmts.length > 0) {
      xml += `\n  <numFmts count="${this.styles.numFmts.length}">`;
      for (const nf of this.styles.numFmts) {
        xml += `\n    <numFmt numFmtId="${nf.id}" formatCode="${escapeXml(nf.formatCode)}"/>`;
      }
      xml += '\n  </numFmts>';
    }

    // Fonts
    xml += `\n  <fonts count="${this.styles.fonts!.length}">`;
    for (const font of this.styles.fonts!) {
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
    xml += `\n  <fills count="${this.styles.fills!.length}">`;
    for (const fill of this.styles.fills!) {
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
    xml += `\n  <borders count="${this.styles.borders!.length}">`;
    for (const border of this.styles.borders!) {
      xml += '\n    <border>';
      xml += this.buildBorderSide('left', border.left);
      xml += this.buildBorderSide('right', border.right);
      xml += this.buildBorderSide('top', border.top);
      xml += this.buildBorderSide('bottom', border.bottom);
      xml += '</border>';
    }
    xml += '\n  </borders>';

    // Cell style XFs (required)
    xml += '\n  <cellStyleXfs count="1"><xf/></cellStyleXfs>';

    // Cell XFs
    xml += `\n  <cellXfs count="${this.styles.cellXfs!.length}">`;
    for (const xf of this.styles.cellXfs!) {
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
    if (!side) {
      return `<${name}/>`;
    }
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
// Feature Test File Generators
// =============================================================================

async function generateBasicDataTypes(): Promise<void> {
  console.log('  Generating basic data types...');

  const builder = new XlsxBuilder();

  // Add shared strings
  const stringIdx = builder.addSharedString('Hello World');
  const string2Idx = builder.addSharedString('Test String');
  const emptyIdx = builder.addSharedString('');

  builder.addSheet({
    name: 'Data Types',
    cells: [
      // Numbers
      { ref: 'A1', value: 'Numbers', type: 's', styleIndex: 0 },
      { ref: 'A2', value: 42 },
      { ref: 'A3', value: 3.14159 },
      { ref: 'A4', value: -100 },
      { ref: 'A5', value: 0 },
      { ref: 'A6', value: 1e10 },
      { ref: 'A7', value: 0.0001 },

      // Strings
      { ref: 'B1', value: builder.addSharedString('Strings'), type: 's' },
      { ref: 'B2', value: stringIdx, type: 's' },
      { ref: 'B3', value: string2Idx, type: 's' },
      { ref: 'B4', value: emptyIdx, type: 's' },

      // Booleans
      { ref: 'C1', value: builder.addSharedString('Booleans'), type: 's' },
      { ref: 'C2', value: 1, type: 'b' },
      { ref: 'C3', value: 0, type: 'b' },

      // Errors
      { ref: 'D1', value: builder.addSharedString('Errors'), type: 's' },
      { ref: 'D2', value: '#DIV/0!', type: 'e' },
      { ref: 'D3', value: '#VALUE!', type: 'e' },
      { ref: 'D4', value: '#REF!', type: 'e' },
      { ref: 'D5', value: '#NAME?', type: 'e' },
      { ref: 'D6', value: '#NUM!', type: 'e' },
      { ref: 'D7', value: '#N/A', type: 'e' },
      { ref: 'D8', value: '#NULL!', type: 'e' },

      // Inline strings
      { ref: 'E1', value: builder.addSharedString('Inline Strings'), type: 's' },
      { ref: 'E2', value: 'Inline text', type: 'inlineStr' },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'basic-data-types.xlsx'), Buffer.from(buffer));
}

async function generateFormulas(): Promise<void> {
  console.log('  Generating formulas...');

  const builder = new XlsxBuilder();
  const headerIdx = builder.addSharedString('Formula Tests');

  builder.addSheet({
    name: 'Formulas',
    cells: [
      { ref: 'A1', value: headerIdx, type: 's' },

      // Math formulas
      { ref: 'A3', value: 10 },
      { ref: 'B3', value: 5 },
      { ref: 'C3', formula: 'A3+B3', value: 15 },
      { ref: 'D3', formula: 'A3*B3', value: 50 },
      { ref: 'E3', formula: 'A3/B3', value: 2 },
      { ref: 'F3', formula: 'A3-B3', value: 5 },
      { ref: 'G3', formula: 'A3^2', value: 100 },

      // Aggregation formulas
      { ref: 'A5', value: 1 },
      { ref: 'A6', value: 2 },
      { ref: 'A7', value: 3 },
      { ref: 'A8', value: 4 },
      { ref: 'A9', value: 5 },
      { ref: 'B5', formula: 'SUM(A5:A9)', value: 15 },
      { ref: 'B6', formula: 'AVERAGE(A5:A9)', value: 3 },
      { ref: 'B7', formula: 'COUNT(A5:A9)', value: 5 },
      { ref: 'B8', formula: 'MIN(A5:A9)', value: 1 },
      { ref: 'B9', formula: 'MAX(A5:A9)', value: 5 },

      // Logical formulas
      {
        ref: 'C5',
        formula: 'IF(A5>2,"Yes","No")',
        value: builder.addSharedString('No'),
        type: 's',
      },
      { ref: 'C6', formula: 'AND(A5>0,A5<10)', value: 1, type: 'b' },
      { ref: 'C7', formula: 'OR(A5>10,A5<2)', value: 1, type: 'b' },
      { ref: 'C8', formula: 'NOT(A5>10)', value: 1, type: 'b' },

      // Text formulas
      {
        ref: 'D5',
        formula: 'CONCATENATE("Hello"," ","World")',
        value: builder.addSharedString('Hello World'),
        type: 's',
      },
      { ref: 'D6', formula: 'LEN("Test")', value: 4 },
      { ref: 'D7', formula: 'UPPER("test")', value: builder.addSharedString('TEST'), type: 's' },
      { ref: 'D8', formula: 'LOWER("TEST")', value: builder.addSharedString('test'), type: 's' },

      // Lookup formulas
      { ref: 'E5', value: builder.addSharedString('A'), type: 's' },
      { ref: 'E6', value: builder.addSharedString('B'), type: 's' },
      { ref: 'E7', value: builder.addSharedString('C'), type: 's' },
      { ref: 'F5', value: 100 },
      { ref: 'F6', value: 200 },
      { ref: 'F7', value: 300 },
      { ref: 'G5', formula: 'VLOOKUP("B",E5:F7,2,FALSE)', value: 200 },

      // Nested formulas
      { ref: 'H5', formula: 'IF(SUM(A5:A9)>10,AVERAGE(A5:A9),0)', value: 3 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'formulas.xlsx'), Buffer.from(buffer));
}

async function generateFontStyles(): Promise<void> {
  console.log('  Generating font styles...');

  const builder = new XlsxBuilder();

  // Add fonts
  const boldFontId = builder.addFont({ name: 'Calibri', size: 11, bold: true });
  const italicFontId = builder.addFont({ name: 'Calibri', size: 11, italic: true });
  const underlineFontId = builder.addFont({ name: 'Calibri', size: 11, underline: true });
  const largeFontId = builder.addFont({ name: 'Calibri', size: 24 });
  const smallFontId = builder.addFont({ name: 'Calibri', size: 8 });
  const redFontId = builder.addFont({ name: 'Calibri', size: 11, color: 'FFFF0000' });
  const blueFontId = builder.addFont({ name: 'Calibri', size: 11, color: 'FF0000FF' });
  const arialFontId = builder.addFont({ name: 'Arial', size: 11 });
  const timesFontId = builder.addFont({ name: 'Times New Roman', size: 11 });
  const comboFontId = builder.addFont({
    name: 'Calibri',
    size: 14,
    bold: true,
    italic: true,
    color: 'FF008000',
  });

  // Add cell XFs for each font
  const boldStyleId = builder.addCellXf({ fontId: boldFontId, applyFont: true });
  const italicStyleId = builder.addCellXf({ fontId: italicFontId, applyFont: true });
  const underlineStyleId = builder.addCellXf({ fontId: underlineFontId, applyFont: true });
  const largeStyleId = builder.addCellXf({ fontId: largeFontId, applyFont: true });
  const smallStyleId = builder.addCellXf({ fontId: smallFontId, applyFont: true });
  const redStyleId = builder.addCellXf({ fontId: redFontId, applyFont: true });
  const blueStyleId = builder.addCellXf({ fontId: blueFontId, applyFont: true });
  const arialStyleId = builder.addCellXf({ fontId: arialFontId, applyFont: true });
  const timesStyleId = builder.addCellXf({ fontId: timesFontId, applyFont: true });
  const comboStyleId = builder.addCellXf({ fontId: comboFontId, applyFont: true });

  builder.addSheet({
    name: 'Font Styles',
    cells: [
      { ref: 'A1', value: builder.addSharedString('Bold'), type: 's', styleIndex: boldStyleId },
      { ref: 'A2', value: builder.addSharedString('Italic'), type: 's', styleIndex: italicStyleId },
      {
        ref: 'A3',
        value: builder.addSharedString('Underline'),
        type: 's',
        styleIndex: underlineStyleId,
      },
      {
        ref: 'A4',
        value: builder.addSharedString('Large (24pt)'),
        type: 's',
        styleIndex: largeStyleId,
      },
      {
        ref: 'A5',
        value: builder.addSharedString('Small (8pt)'),
        type: 's',
        styleIndex: smallStyleId,
      },
      { ref: 'A6', value: builder.addSharedString('Red Color'), type: 's', styleIndex: redStyleId },
      {
        ref: 'A7',
        value: builder.addSharedString('Blue Color'),
        type: 's',
        styleIndex: blueStyleId,
      },
      {
        ref: 'A8',
        value: builder.addSharedString('Arial Font'),
        type: 's',
        styleIndex: arialStyleId,
      },
      {
        ref: 'A9',
        value: builder.addSharedString('Times New Roman'),
        type: 's',
        styleIndex: timesStyleId,
      },
      {
        ref: 'A10',
        value: builder.addSharedString('Bold+Italic+Green'),
        type: 's',
        styleIndex: comboStyleId,
      },
    ],
    rowHeights: [{ row: 3, height: 30 }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'font-styles.xlsx'), Buffer.from(buffer));
}

async function generateFillStyles(): Promise<void> {
  console.log('  Generating fill styles...');

  const builder = new XlsxBuilder();

  // Add fills
  const redFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFFF0000' });
  const greenFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF00FF00' });
  const blueFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF0000FF' });
  const yellowFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFFFFF00' });
  const grayFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF808080' });
  const lightBlueFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFE0F0FF' });

  // Add cell XFs
  const redStyleId = builder.addCellXf({ fillId: redFillId, applyFill: true });
  const greenStyleId = builder.addCellXf({ fillId: greenFillId, applyFill: true });
  const blueStyleId = builder.addCellXf({ fillId: blueFillId, applyFill: true });
  const yellowStyleId = builder.addCellXf({ fillId: yellowFillId, applyFill: true });
  const grayStyleId = builder.addCellXf({ fillId: grayFillId, applyFill: true });
  const lightBlueStyleId = builder.addCellXf({ fillId: lightBlueFillId, applyFill: true });

  builder.addSheet({
    name: 'Fill Styles',
    cells: [
      { ref: 'A1', value: builder.addSharedString('Red Fill'), type: 's', styleIndex: redStyleId },
      {
        ref: 'A2',
        value: builder.addSharedString('Green Fill'),
        type: 's',
        styleIndex: greenStyleId,
      },
      {
        ref: 'A3',
        value: builder.addSharedString('Blue Fill'),
        type: 's',
        styleIndex: blueStyleId,
      },
      {
        ref: 'A4',
        value: builder.addSharedString('Yellow Fill'),
        type: 's',
        styleIndex: yellowStyleId,
      },
      {
        ref: 'A5',
        value: builder.addSharedString('Gray Fill'),
        type: 's',
        styleIndex: grayStyleId,
      },
      {
        ref: 'A6',
        value: builder.addSharedString('Light Blue Fill'),
        type: 's',
        styleIndex: lightBlueStyleId,
      },
    ],
    colWidths: [{ col: 0, width: 20 }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'fill-styles.xlsx'), Buffer.from(buffer));
}

async function generateBorderStyles(): Promise<void> {
  console.log('  Generating border styles...');

  const builder = new XlsxBuilder();

  // Add borders
  const thinBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
  });

  const mediumBorderId = builder.addBorder({
    left: { style: 'medium', color: 'FF000000' },
    right: { style: 'medium', color: 'FF000000' },
    top: { style: 'medium', color: 'FF000000' },
    bottom: { style: 'medium', color: 'FF000000' },
  });

  const thickBorderId = builder.addBorder({
    left: { style: 'thick', color: 'FF000000' },
    right: { style: 'thick', color: 'FF000000' },
    top: { style: 'thick', color: 'FF000000' },
    bottom: { style: 'thick', color: 'FF000000' },
  });

  const dashedBorderId = builder.addBorder({
    left: { style: 'dashed', color: 'FF000000' },
    right: { style: 'dashed', color: 'FF000000' },
    top: { style: 'dashed', color: 'FF000000' },
    bottom: { style: 'dashed', color: 'FF000000' },
  });

  const coloredBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FFFF0000' },
    right: { style: 'thin', color: 'FF00FF00' },
    top: { style: 'thin', color: 'FF0000FF' },
    bottom: { style: 'thin', color: 'FFFFFF00' },
  });

  // Add cell XFs
  const thinStyleId = builder.addCellXf({ borderId: thinBorderId, applyBorder: true });
  const mediumStyleId = builder.addCellXf({ borderId: mediumBorderId, applyBorder: true });
  const thickStyleId = builder.addCellXf({ borderId: thickBorderId, applyBorder: true });
  const dashedStyleId = builder.addCellXf({ borderId: dashedBorderId, applyBorder: true });
  const coloredStyleId = builder.addCellXf({ borderId: coloredBorderId, applyBorder: true });

  builder.addSheet({
    name: 'Border Styles',
    cells: [
      {
        ref: 'B2',
        value: builder.addSharedString('Thin Border'),
        type: 's',
        styleIndex: thinStyleId,
      },
      {
        ref: 'B4',
        value: builder.addSharedString('Medium Border'),
        type: 's',
        styleIndex: mediumStyleId,
      },
      {
        ref: 'B6',
        value: builder.addSharedString('Thick Border'),
        type: 's',
        styleIndex: thickStyleId,
      },
      {
        ref: 'B8',
        value: builder.addSharedString('Dashed Border'),
        type: 's',
        styleIndex: dashedStyleId,
      },
      {
        ref: 'B10',
        value: builder.addSharedString('Colored Borders'),
        type: 's',
        styleIndex: coloredStyleId,
      },
    ],
    colWidths: [{ col: 1, width: 25 }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'border-styles.xlsx'), Buffer.from(buffer));
}

async function generateNumberFormats(): Promise<void> {
  console.log('  Generating number formats...');

  const builder = new XlsxBuilder();

  // Add custom number formats (starting from 164 as per ECMA-376)
  builder.addNumFmt({ id: 164, formatCode: '#,##0.00' });
  builder.addNumFmt({ id: 165, formatCode: '$#,##0.00' });
  builder.addNumFmt({ id: 166, formatCode: '0.00%' });
  builder.addNumFmt({ id: 167, formatCode: 'yyyy-mm-dd' });
  builder.addNumFmt({ id: 168, formatCode: 'h:mm:ss AM/PM' });
  builder.addNumFmt({ id: 169, formatCode: '#,##0.00;[Red]-#,##0.00' });
  builder.addNumFmt({ id: 170, formatCode: '0.00E+00' });

  // Add cell XFs
  const defaultStyleId = builder.addCellXf({ numFmtId: 0, applyNumberFormat: true });
  const thousandsStyleId = builder.addCellXf({ numFmtId: 164, applyNumberFormat: true });
  const currencyStyleId = builder.addCellXf({ numFmtId: 165, applyNumberFormat: true });
  const percentStyleId = builder.addCellXf({ numFmtId: 166, applyNumberFormat: true });
  const dateStyleId = builder.addCellXf({ numFmtId: 167, applyNumberFormat: true });
  const timeStyleId = builder.addCellXf({ numFmtId: 168, applyNumberFormat: true });
  const negativeRedStyleId = builder.addCellXf({ numFmtId: 169, applyNumberFormat: true });
  const scientificStyleId = builder.addCellXf({ numFmtId: 170, applyNumberFormat: true });

  builder.addSheet({
    name: 'Number Formats',
    cells: [
      // Headers
      { ref: 'A1', value: builder.addSharedString('Format'), type: 's' },
      { ref: 'B1', value: builder.addSharedString('Value'), type: 's' },

      // Default
      { ref: 'A2', value: builder.addSharedString('Default'), type: 's' },
      { ref: 'B2', value: 1234567.89, styleIndex: defaultStyleId },

      // Thousands separator
      { ref: 'A3', value: builder.addSharedString('Thousands'), type: 's' },
      { ref: 'B3', value: 1234567.89, styleIndex: thousandsStyleId },

      // Currency
      { ref: 'A4', value: builder.addSharedString('Currency'), type: 's' },
      { ref: 'B4', value: 1234567.89, styleIndex: currencyStyleId },

      // Percentage
      { ref: 'A5', value: builder.addSharedString('Percentage'), type: 's' },
      { ref: 'B5', value: 0.4567, styleIndex: percentStyleId },

      // Date (Excel serial date for 2024-01-15)
      { ref: 'A6', value: builder.addSharedString('Date'), type: 's' },
      { ref: 'B6', value: 45306, styleIndex: dateStyleId },

      // Time (fractional day for 14:30:00)
      { ref: 'A7', value: builder.addSharedString('Time'), type: 's' },
      { ref: 'B7', value: 0.604166667, styleIndex: timeStyleId },

      // Negative in red
      { ref: 'A8', value: builder.addSharedString('Neg Red'), type: 's' },
      { ref: 'B8', value: -1234.56, styleIndex: negativeRedStyleId },

      // Scientific
      { ref: 'A9', value: builder.addSharedString('Scientific'), type: 's' },
      { ref: 'B9', value: 123456789, styleIndex: scientificStyleId },
    ],
    colWidths: [
      { col: 0, width: 15 },
      { col: 1, width: 20 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'number-formats.xlsx'), Buffer.from(buffer));
}

async function generateAlignmentStyles(): Promise<void> {
  console.log('  Generating alignment styles...');

  const builder = new XlsxBuilder();

  // Add cell XFs with different alignments
  const leftStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { horizontal: 'left' },
  });
  const centerStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { horizontal: 'center' },
  });
  const rightStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { horizontal: 'right' },
  });
  const topStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { vertical: 'top' },
  });
  const middleStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { vertical: 'center' },
  });
  const bottomStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { vertical: 'bottom' },
  });
  const wrapStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { wrapText: true },
  });
  const rotatedStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { textRotation: 45 },
  });
  const verticalStyleId = builder.addCellXf({
    applyAlignment: true,
    alignment: { textRotation: 90 },
  });

  builder.addSheet({
    name: 'Alignment',
    cells: [
      {
        ref: 'A1',
        value: builder.addSharedString('Left Align'),
        type: 's',
        styleIndex: leftStyleId,
      },
      {
        ref: 'A2',
        value: builder.addSharedString('Center Align'),
        type: 's',
        styleIndex: centerStyleId,
      },
      {
        ref: 'A3',
        value: builder.addSharedString('Right Align'),
        type: 's',
        styleIndex: rightStyleId,
      },
      { ref: 'B1', value: builder.addSharedString('Top'), type: 's', styleIndex: topStyleId },
      { ref: 'B2', value: builder.addSharedString('Middle'), type: 's', styleIndex: middleStyleId },
      { ref: 'B3', value: builder.addSharedString('Bottom'), type: 's', styleIndex: bottomStyleId },
      {
        ref: 'C1',
        value: builder.addSharedString(
          'This is a long text that should wrap to multiple lines in the cell',
        ),
        type: 's',
        styleIndex: wrapStyleId,
      },
      {
        ref: 'D1',
        value: builder.addSharedString('45 Degrees'),
        type: 's',
        styleIndex: rotatedStyleId,
      },
      {
        ref: 'E1',
        value: builder.addSharedString('Vertical'),
        type: 's',
        styleIndex: verticalStyleId,
      },
    ],
    colWidths: [
      { col: 0, width: 15 },
      { col: 1, width: 15 },
      { col: 2, width: 20 },
      { col: 3, width: 15 },
      { col: 4, width: 10 },
    ],
    rowHeights: [
      { row: 0, height: 60 },
      { row: 1, height: 60 },
      { row: 2, height: 60 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'alignment-styles.xlsx'), Buffer.from(buffer));
}

async function generateMergedCells(): Promise<void> {
  console.log('  Generating merged cells...');

  const builder = new XlsxBuilder();

  builder.addSheet({
    name: 'Merged Cells',
    cells: [
      // Horizontal merge
      { ref: 'A1', value: builder.addSharedString('Horizontal Merge (A1:D1)'), type: 's' },

      // Vertical merge
      { ref: 'A3', value: builder.addSharedString('Vertical Merge (A3:A6)'), type: 's' },

      // Block merge
      { ref: 'C3', value: builder.addSharedString('Block Merge (C3:E6)'), type: 's' },

      // Multiple merges
      { ref: 'G1', value: builder.addSharedString('G1:H1'), type: 's' },
      { ref: 'G2', value: builder.addSharedString('G2:H2'), type: 's' },
      { ref: 'G3', value: builder.addSharedString('G3:H3'), type: 's' },

      // Data around merges
      { ref: 'B3', value: 100 },
      { ref: 'B4', value: 200 },
      { ref: 'B5', value: 300 },
      { ref: 'B6', value: 400 },
    ],
    merges: [
      { start: 'A1', end: 'D1' },
      { start: 'A3', end: 'A6' },
      { start: 'C3', end: 'E6' },
      { start: 'G1', end: 'H1' },
      { start: 'G2', end: 'H2' },
      { start: 'G3', end: 'H3' },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'merged-cells.xlsx'), Buffer.from(buffer));
}

async function generateFrozenPanes(): Promise<void> {
  console.log('  Generating frozen panes...');

  const builder = new XlsxBuilder();

  // Sheet with frozen rows
  const cells1: CellData[] = [];
  cells1.push({ ref: 'A1', value: builder.addSharedString('Header A'), type: 's' });
  cells1.push({ ref: 'B1', value: builder.addSharedString('Header B'), type: 's' });
  cells1.push({ ref: 'C1', value: builder.addSharedString('Header C'), type: 's' });
  for (let i = 2; i <= 50; i++) {
    cells1.push({ ref: `A${i}`, value: i - 1 });
    cells1.push({ ref: `B${i}`, value: (i - 1) * 10 });
    cells1.push({ ref: `C${i}`, value: (i - 1) * 100 });
  }

  builder.addSheet({
    name: 'Frozen Rows',
    cells: cells1,
    freeze: { rows: 1, cols: 0 },
  });

  // Sheet with frozen columns
  const cells2: CellData[] = [];
  cells2.push({ ref: 'A1', value: builder.addSharedString('Row Labels'), type: 's' });
  for (let i = 1; i <= 20; i++) {
    cells2.push({ ref: `A${i + 1}`, value: builder.addSharedString(`Row ${i}`), type: 's' });
    for (let j = 0; j < 26; j++) {
      cells2.push({ ref: `${colToLetter(j + 1)}${i + 1}`, value: i * (j + 1) });
    }
  }

  builder.addSheet({
    name: 'Frozen Columns',
    cells: cells2,
    freeze: { rows: 0, cols: 1 },
  });

  // Sheet with frozen rows and columns
  const cells3: CellData[] = [];
  cells3.push({ ref: 'A1', value: builder.addSharedString(''), type: 's' });
  for (let j = 0; j < 10; j++) {
    cells3.push({
      ref: `${colToLetter(j + 1)}1`,
      value: builder.addSharedString(`Col ${j + 1}`),
      type: 's',
    });
  }
  for (let i = 2; i <= 30; i++) {
    cells3.push({ ref: `A${i}`, value: builder.addSharedString(`Row ${i - 1}`), type: 's' });
    for (let j = 0; j < 10; j++) {
      cells3.push({ ref: `${colToLetter(j + 1)}${i}`, value: (i - 1) * (j + 1) });
    }
  }

  builder.addSheet({
    name: 'Frozen Both',
    cells: cells3,
    freeze: { rows: 1, cols: 1 },
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'frozen-panes.xlsx'), Buffer.from(buffer));
}

async function generateMultipleSheets(): Promise<void> {
  console.log('  Generating multiple sheets...');

  const builder = new XlsxBuilder();

  for (let s = 1; s <= 5; s++) {
    const cells: CellData[] = [];
    cells.push({ ref: 'A1', value: builder.addSharedString(`Sheet ${s} Data`), type: 's' });

    for (let i = 2; i <= 10; i++) {
      cells.push({ ref: `A${i}`, value: s * 100 + i });
      cells.push({ ref: `B${i}`, value: builder.addSharedString(`Item ${s}-${i}`), type: 's' });
    }

    builder.addSheet({
      name: `Sheet${s}`,
      cells,
    });
  }

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'multiple-sheets.xlsx'), Buffer.from(buffer));
}

async function generateLargeDataSet(): Promise<void> {
  console.log('  Generating large dataset...');

  const builder = new XlsxBuilder();

  const cells: CellData[] = [];

  // Headers
  const headers = ['ID', 'Name', 'Value', 'Category', 'Date', 'Status'];
  for (let j = 0; j < headers.length; j++) {
    cells.push({
      ref: `${colToLetter(j)}1`,
      value: builder.addSharedString(headers[j]),
      type: 's',
    });
  }

  // Data rows (1000 rows)
  const categories = ['A', 'B', 'C', 'D', 'E'];
  const statuses = ['Active', 'Pending', 'Complete', 'Cancelled'];

  for (let i = 2; i <= 1001; i++) {
    cells.push({ ref: `A${i}`, value: i - 1 });
    cells.push({ ref: `B${i}`, value: builder.addSharedString(`Item ${i - 1}`), type: 's' });
    cells.push({ ref: `C${i}`, value: Math.round(Math.random() * 10000) / 100 });
    cells.push({
      ref: `D${i}`,
      value: builder.addSharedString(categories[(i - 2) % categories.length]),
      type: 's',
    });
    cells.push({ ref: `E${i}`, value: 45000 + Math.floor((i - 2) / 10) }); // Excel date serial
    cells.push({
      ref: `F${i}`,
      value: builder.addSharedString(statuses[(i - 2) % statuses.length]),
      type: 's',
    });
  }

  builder.addSheet({
    name: 'Large Dataset',
    cells,
    freeze: { rows: 1, cols: 0 },
    colWidths: [
      { col: 0, width: 8 },
      { col: 1, width: 15 },
      { col: 2, width: 12 },
      { col: 3, width: 12 },
      { col: 4, width: 12 },
      { col: 5, width: 12 },
    ],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'large-dataset.xlsx'), Buffer.from(buffer));
}

async function generateCombinedStyles(): Promise<void> {
  console.log('  Generating combined styles...');

  const builder = new XlsxBuilder();

  // Add fonts
  const headerFontId = builder.addFont({
    name: 'Calibri',
    size: 14,
    bold: true,
    color: 'FFFFFFFF',
  });
  const dataBoldFontId = builder.addFont({ name: 'Calibri', size: 11, bold: true });

  // Add fills
  const headerFillId = builder.addFill({ patternType: 'solid', fgColor: 'FF4472C4' });
  const altRowFillId = builder.addFill({ patternType: 'solid', fgColor: 'FFE8F0FE' });

  // Add borders
  const thinBorderId = builder.addBorder({
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
  });

  // Add number format
  builder.addNumFmt({ id: 164, formatCode: '$#,##0.00' });

  // Combine styles
  const headerStyleId = builder.addCellXf({
    fontId: headerFontId,
    fillId: headerFillId,
    borderId: thinBorderId,
    applyFont: true,
    applyFill: true,
    applyBorder: true,
    applyAlignment: true,
    alignment: { horizontal: 'center', vertical: 'center' },
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

  const totalStyleId = builder.addCellXf({
    fontId: dataBoldFontId,
    numFmtId: 164,
    borderId: thinBorderId,
    applyFont: true,
    applyNumberFormat: true,
    applyBorder: true,
  });

  const cells: CellData[] = [
    // Headers
    { ref: 'A1', value: builder.addSharedString('Product'), type: 's', styleIndex: headerStyleId },
    { ref: 'B1', value: builder.addSharedString('Quantity'), type: 's', styleIndex: headerStyleId },
    { ref: 'C1', value: builder.addSharedString('Price'), type: 's', styleIndex: headerStyleId },
    { ref: 'D1', value: builder.addSharedString('Total'), type: 's', styleIndex: headerStyleId },

    // Data rows
    { ref: 'A2', value: builder.addSharedString('Widget A'), type: 's', styleIndex: dataStyleId },
    { ref: 'B2', value: 10, styleIndex: dataStyleId },
    { ref: 'C2', value: 25.99, styleIndex: currencyStyleId },
    { ref: 'D2', formula: 'B2*C2', value: 259.9, styleIndex: currencyStyleId },

    {
      ref: 'A3',
      value: builder.addSharedString('Widget B'),
      type: 's',
      styleIndex: dataAltStyleId,
    },
    { ref: 'B3', value: 5, styleIndex: dataAltStyleId },
    { ref: 'C3', value: 49.99, styleIndex: currencyAltStyleId },
    { ref: 'D3', formula: 'B3*C3', value: 249.95, styleIndex: currencyAltStyleId },

    { ref: 'A4', value: builder.addSharedString('Widget C'), type: 's', styleIndex: dataStyleId },
    { ref: 'B4', value: 20, styleIndex: dataStyleId },
    { ref: 'C4', value: 15.5, styleIndex: currencyStyleId },
    { ref: 'D4', formula: 'B4*C4', value: 310, styleIndex: currencyStyleId },

    {
      ref: 'A5',
      value: builder.addSharedString('Widget D'),
      type: 's',
      styleIndex: dataAltStyleId,
    },
    { ref: 'B5', value: 8, styleIndex: dataAltStyleId },
    { ref: 'C5', value: 99.99, styleIndex: currencyAltStyleId },
    { ref: 'D5', formula: 'B5*C5', value: 799.92, styleIndex: currencyAltStyleId },

    // Totals
    { ref: 'A6', value: builder.addSharedString('Total'), type: 's', styleIndex: totalStyleId },
    { ref: 'B6', formula: 'SUM(B2:B5)', value: 43, styleIndex: totalStyleId },
    { ref: 'C6', value: builder.addSharedString(''), type: 's', styleIndex: totalStyleId },
    { ref: 'D6', formula: 'SUM(D2:D5)', value: 1619.77, styleIndex: totalStyleId },
  ];

  builder.addSheet({
    name: 'Combined Styles',
    cells,
    colWidths: [
      { col: 0, width: 15 },
      { col: 1, width: 12 },
      { col: 2, width: 12 },
      { col: 3, width: 12 },
    ],
    rowHeights: [{ row: 0, height: 25 }],
  });

  const buffer = await builder.build();
  await fs.promises.writeFile(path.join(FEATURE_DIR, 'combined-styles.xlsx'), Buffer.from(buffer));
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('Generating feature coverage test files...');
  console.log(`Output directory: ${FEATURE_DIR}`);

  // Create output directories
  await fs.promises.mkdir(FEATURE_DIR, { recursive: true });

  // Generate all feature test files
  await generateBasicDataTypes();
  await generateFormulas();
  await generateFontStyles();
  await generateFillStyles();
  await generateBorderStyles();
  await generateNumberFormats();
  await generateAlignmentStyles();
  await generateMergedCells();
  await generateFrozenPanes();
  await generateMultipleSheets();
  await generateLargeDataSet();
  await generateCombinedStyles();

  console.log('\nFeature coverage test files generated successfully!');

  // Count generated files
  const files = await fs.promises.readdir(FEATURE_DIR);
  console.log(`Total files: ${files.length}`);
}

main().catch(console.error);

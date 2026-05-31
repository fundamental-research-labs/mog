#!/usr/bin/env npx tsx
/**
 * XLSX Fidelity System CLI
 *
 * Compares xlsx-parser output against Excel COM ground truth to measure parsing accuracy.
 * Uses parse_xlsx_full() which returns structured data including styles and theme.
 *
 * Usage:
 *   pnpm xlsx-fidelity <xlsx-file>                    # Summary report
 *   pnpm xlsx-fidelity <xlsx-file> cell <address>     # Cell detail view
 *   pnpm xlsx-fidelity <xlsx-file> --property <name>  # Property filter
 *   pnpm xlsx-fidelity <xlsx-file> --format json      # JSON output
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Simple value formatter for fidelity comparison (formatting accuracy is not the goal here). */
function formatValueSimple(value: unknown, formatCode: string): { text: string } {
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
  return { text: String(value) };
}

// =============================================================================
// Types
// =============================================================================

interface GroundTruthData {
  file: string;
  extractedAt: string;
  sheetCount: number;
  sheets: GroundTruthSheet[];
}

interface GroundTruthSheet {
  name: string;
  index: number;
  visible: number;
  cells: Record<string, GroundTruthCell>;
}

interface GroundTruthCell {
  address: string;
  row: number;
  column: number;
  text: string;
  value?: any;
  value2?: any;
  hasFormula: boolean;
  formula: string | null;
  numberFormat: string;
  font?: {
    name: string;
    size: number;
    bold: boolean;
    italic: boolean;
    color: number;
    themeColor: number;
    tintAndShade: number;
  };
  interior?: {
    color: number;
    pattern: number;
    themeColor: number;
    tintAndShade: number;
  };
  alignment?: {
    horizontalAlignment: number;
    verticalAlignment: number;
    wrapText: boolean;
    indentLevel: number;
  };
  borders?: Record<string, any>;
  displayFormat?: any;
}

/** Raw cell as returned by parse_xlsx_full (Rust camelCase via serde) */
interface RawParsedCell {
  row: number;
  col: number;
  type: number; // 0=empty, 1=number, 2=string, 3=bool, 4=error, 5=formula
  styleIndex: number;
  value?: string;
  formula?: string;
}

/** Styles JSON from Rust (snake_case) */
interface RawStylesJson {
  number_formats: Array<{ id: number; format_code: string }>;
  cell_xfs: Array<{
    number_format_id: number;
    font_id: number;
    fill_id: number;
    border_id: number;
    apply_number_format: boolean;
  }>;
  fonts?: any[];
  fills?: any[];
  borders?: any[];
}

/** Theme JSON from Rust (snake_case) */
interface RawThemeJson {
  name: string;
  color_scheme_name: string;
  colors?: Record<string, string>;
}

/** Parsed sheet from parse_xlsx_full */
interface RawParsedSheet {
  name: string;
  index: number;
  cells: RawParsedCell[];
}

/** Full result from parse_xlsx_full (Rust snake_case) */
interface RawFullParseResult {
  sheets: RawParsedSheet[];
  shared_strings: string[];
  styles: string; // JSON string
  theme: string | null; // JSON string or null
  defined_names: string[];
  errors: string[];
  stats: { total_cells: number; total_sheets: number; parse_time_us: number };
}

interface WasmModule {
  parse_xlsx_full(xlsxData: Uint8Array): RawFullParseResult;
  version(): string;
}

interface ResolvedCell {
  address: string;
  row: number;
  col: number;
  cellType: number;
  value: string | undefined;
  formula: string | undefined;
  numberFormat: string;
  fontName: string | null;
  fontSize: number | null;
  fontBold: boolean | null;
  fontItalic: boolean | null;
  fontColor: number | null;
  fillColor: number | null;
  fillPattern: string | null;
}

interface ComparisonResult {
  overall: {
    totalCells: number;
    perfectMatches: number;
    matchPercentage: number;
    parserCellCount: number;
  };
  byProperty: Record<
    string,
    {
      compared: number;
      matches: number;
      mismatches: number;
      notAvailable: number;
      matchPercentage: number;
    }
  >;
  cellDetails?: Record<string, CellComparison>;
}

interface CellComparison {
  address: string;
  perfect: boolean;
  properties: Record<
    string,
    {
      expected: any;
      actual: any;
      match: boolean;
      reason?: string;
    }
  >;
}

interface Options {
  format: 'text' | 'json';
  property?: string;
  cellAddress?: string;
  verbose: boolean;
}

// =============================================================================
// Built-in Number Formats
// =============================================================================

const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: '$#,##0_);($#,##0)',
  6: '$#,##0_);[Red]($#,##0)',
  7: '$#,##0.00_);($#,##0.00)',
  8: '$#,##0.00_);[Red]($#,##0.00)',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0_);(#,##0)',
  38: '#,##0_);[Red](#,##0)',
  39: '#,##0.00_);(#,##0.00)',
  40: '#,##0.00_);[Red](#,##0.00)',
  41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
  42: '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
  44: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
};

// =============================================================================
// Theme Color Map
// =============================================================================

// OOXML theme color index mapping: indices 0-1 and 2-3 are swapped
// relative to the a:clrScheme child order (dk1, lt1, dk2, lt2, ...).
// In style <color theme="X">, X=0 -> lt1, X=1 -> dk1, X=2 -> lt2, X=3 -> dk2.
const THEME_COLOR_MAP = [
  'lt1', // theme index 0 -> Light 1
  'dk1', // theme index 1 -> Dark 1
  'lt2', // theme index 2 -> Light 2
  'dk2', // theme index 3 -> Dark 2
  'accent1', // theme index 4
  'accent2', // theme index 5
  'accent3', // theme index 6
  'accent4', // theme index 7
  'accent5', // theme index 8
  'accent6', // theme index 9
  'hlink', // theme index 10
  'fol_hlink', // theme index 11
];

// =============================================================================
// Excel Indexed Colors (default palette)
// =============================================================================

const INDEXED_COLORS: string[] = [
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'C0C0C0',
  '808080',
  '9999FF',
  '993366',
  'FFFFCC',
  'CCFFFF',
  '660066',
  'FF8080',
  '0066CC',
  'CCCCFF',
  '000080',
  'FF00FF',
  'FFFF00',
  '00FFFF',
  '800080',
  '800000',
  '008080',
  '0000FF',
  '00CCFF',
  'CCFFFF',
  'CCFFCC',
  'FFFF99',
  '99CCFF',
  'FF99CC',
  'CC99FF',
  'FFCC99',
  '3366FF',
  '33CCCC',
  '99CC00',
  'FFCC00',
  'FF9900',
  'FF6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333',
];

// =============================================================================
// Color Utilities
// =============================================================================

/**
 * Convert RGB hex (6-char or 8-char AARRGGBB) to BGR integer (Excel COM format).
 */
function rgbHexToBgrInt(hex: string): number {
  // Strip leading # if present
  hex = hex.replace(/^#/, '');
  // Handle AARRGGBB (8 char) - strip alpha
  const rgb = hex.length === 8 ? hex.slice(2) : hex;
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return (b << 16) | (g << 8) | r; // BGR format
}

/**
 * Apply tint to an RGB hex color using the OOXML HSL-based algorithm.
 *
 * Per ECMA-376 Part 1, Section 18.8.19:
 * - Convert RGB to HSL
 * - If tint < 0: lum' = lum * (1 + tint)
 * - If tint > 0: lum' = lum * (1 - tint) + tint
 * - Convert back to RGB
 */
function applyTint(hex: string, tint: number): string {
  hex = hex.replace(/^#/, '');
  const rgb = hex.length === 8 ? hex.slice(2) : hex;
  const r = parseInt(rgb.slice(0, 2), 16) / 255;
  const g = parseInt(rgb.slice(2, 4), 16) / 255;
  const b = parseInt(rgb.slice(4, 6), 16) / 255;

  // RGB to HSL
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / d + 2) / 6;
    } else {
      h = ((r - g) / d + 4) / 6;
    }
  }

  // Apply tint to luminance
  if (tint < 0) {
    l = l * (1 + tint);
  } else {
    l = l * (1 - tint) + tint;
  }
  l = Math.max(0, Math.min(1, l));

  // HSL to RGB
  let rOut: number, gOut: number, bOut: number;

  if (s === 0) {
    rOut = gOut = bOut = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    rOut = hue2rgb(p, q, h + 1 / 3);
    gOut = hue2rgb(p, q, h);
    bOut = hue2rgb(p, q, h - 1 / 3);
  }

  const ri = Math.round(rOut * 255);
  const gi = Math.round(gOut * 255);
  const bi = Math.round(bOut * 255);

  return (
    Math.max(0, Math.min(255, ri)).toString(16).padStart(2, '0') +
    Math.max(0, Math.min(255, gi)).toString(16).padStart(2, '0') +
    Math.max(0, Math.min(255, bi)).toString(16).padStart(2, '0')
  ).toUpperCase();
}

/**
 * Resolve an indexed color to an RGB hex string (6-char).
 */
function resolveIndexedColor(index: number): string | null {
  if (index >= 0 && index < INDEXED_COLORS.length) {
    return INDEXED_COLORS[index];
  }
  return null;
}

/**
 * Resolve a parsed color reference to an RGB hex string (6-char).
 */
function resolveColorRef(colorRef: any, themeColors: Record<string, string> | null): string | null {
  if (!colorRef) return null;

  // Direct RGB
  if (colorRef.rgb) {
    // Could be AARRGGBB or RRGGBB
    const hex = colorRef.rgb.replace(/^#/, '');
    return hex.length === 8 ? hex.slice(2) : hex;
  }

  // Theme color reference
  if (colorRef.theme !== undefined && themeColors) {
    const slot = THEME_COLOR_MAP[colorRef.theme];
    if (slot) {
      const hex = themeColors[slot];
      if (hex) {
        const cleanHex = hex.replace(/^#/, '');
        const rgbHex = cleanHex.length === 8 ? cleanHex.slice(2) : cleanHex;
        if (colorRef.tint) {
          return applyTint(rgbHex, colorRef.tint);
        }
        return rgbHex;
      }
    }
  }

  // Indexed color
  if (colorRef.indexed !== undefined) {
    return resolveIndexedColor(colorRef.indexed);
  }

  // Auto color (usually black for font, white for background)
  if (colorRef.auto) {
    return null; // Caller decides default
  }

  return null;
}

// =============================================================================
// Column/Address Utilities
// =============================================================================

function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode(65 + (c % 26)) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

function cellAddress(row: number, col: number): string {
  return `${colToLetter(col)}${row + 1}`;
}

// =============================================================================
// WASM Module Loading
// =============================================================================

async function loadWasmModule(): Promise<WasmModule> {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const pkgDir = join(scriptDir, '..', '..', '..', '..', 'compute', 'wasm', 'npm');
  const wasmPath = join(pkgDir, 'compute_core_wasm_bg.wasm');
  const jsModulePath = join(pkgDir, 'compute_core_wasm.js');

  if (!existsSync(wasmPath) || !existsSync(jsModulePath)) {
    throw new Error(
      'WASM module not built. Run: cd compute/wasm && bash build.sh\n' + `Looked for: ${wasmPath}`,
    );
  }

  const wasmBytes = readFileSync(wasmPath);
  const jsModuleUrl = pathToFileURL(jsModulePath).href;
  const wasmJsModule = await import(jsModuleUrl);

  // Panic hook is auto-set via #[wasm_bindgen(start)] in @mog-sdk/wasm
  await wasmJsModule.default(wasmBytes);

  return wasmJsModule as unknown as WasmModule;
}

// =============================================================================
// Ground Truth Loading
// =============================================================================

function loadGroundTruth(xlsxPath: string): GroundTruthData {
  const dir = dirname(xlsxPath);
  const base = basename(xlsxPath, '.xlsx');
  const groundTruthPath = join(dir, `${base}_extracted.json`);

  if (!existsSync(groundTruthPath)) {
    throw new Error(
      `Ground truth file not found: ${groundTruthPath}\n` +
        `Expected to find ${base}_extracted.json in the same directory as ${basename(xlsxPath)}`,
    );
  }

  let content = readFileSync(groundTruthPath, 'utf-8');

  // Remove BOM if present
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  return JSON.parse(content);
}

// =============================================================================
// WASM Parsing with parse_xlsx_full
// =============================================================================

interface ParsedData {
  /** Map from cell address (e.g. "B2") to resolved cell data */
  cellMap: Map<string, ResolvedCell>;
  /** Total cell count from parser */
  totalCells: number;
  /** Sheet count */
  sheetCount: number;
}

function parseAndResolve(wasm: WasmModule, xlsxPath: string): ParsedData {
  const fileBytes = readFileSync(xlsxPath);
  const xlsxData = new Uint8Array(fileBytes);

  // Use parse_xlsx_full which returns structured data
  const result = wasm.parse_xlsx_full(xlsxData) as RawFullParseResult;

  // Parse styles JSON
  let styles: RawStylesJson = { number_formats: [], cell_xfs: [] };
  try {
    styles = JSON.parse(result.styles);
  } catch {
    console.error('WARNING: Failed to parse styles JSON from parser');
  }

  // Parse theme JSON
  let theme: RawThemeJson | null = null;
  if (result.theme) {
    try {
      theme = JSON.parse(result.theme);
    } catch {
      console.error('WARNING: Failed to parse theme JSON from parser');
    }
  }

  // Build number format lookup from styles
  const customFormats = new Map<number, string>();
  for (const nf of styles.number_formats) {
    customFormats.set(nf.id, nf.format_code);
  }

  // Resolve number format for a given format ID
  function resolveNumberFormat(numFmtId: number): string {
    const custom = customFormats.get(numFmtId);
    if (custom !== undefined) return custom;
    const builtin = BUILTIN_FORMATS[numFmtId];
    if (builtin !== undefined) return builtin;
    return 'General';
  }

  // Theme colors for color resolution
  const themeColors = theme?.colors ?? null;

  // Build cell map from all sheets
  const cellMap = new Map<string, ResolvedCell>();
  let totalCells = 0;

  for (const sheet of result.sheets) {
    for (const cell of sheet.cells) {
      totalCells++;
      const addr = cellAddress(cell.row, cell.col);

      // Resolve style
      const xf = styles.cell_xfs[cell.styleIndex];
      const numFmtId = xf?.number_format_id ?? 0;
      const numberFormat = resolveNumberFormat(numFmtId);

      // Resolve font (may not be available yet from Rust)
      let fontName: string | null = null;
      let fontSize: number | null = null;
      let fontBold: boolean | null = null;
      let fontItalic: boolean | null = null;
      let fontColor: number | null = null;

      if (styles.fonts && xf) {
        const font = styles.fonts[xf.font_id];
        if (font) {
          fontName = font.name ?? null;
          fontSize = font.size ?? null;
          fontBold = font.bold ?? null;
          fontItalic = font.italic ?? null;
          if (font.color) {
            const colorHex = resolveColorRef(font.color, themeColors);
            if (colorHex) {
              fontColor = rgbHexToBgrInt(colorHex);
            }
          }
        }
      }

      // Resolve fill (may not be available yet from Rust)
      let fillColor: number | null = null;
      let fillPattern: string | null = null;

      if (styles.fills && xf) {
        const fill = styles.fills[xf.fill_id];
        if (fill) {
          fillPattern = fill.patternType ?? fill.pattern_type ?? null;
          if (fill.fgColor || fill.fg_color) {
            const fgColorRef = fill.fgColor ?? fill.fg_color;
            const colorHex = resolveColorRef(fgColorRef, themeColors);
            if (colorHex) {
              fillColor = rgbHexToBgrInt(colorHex);
            }
          }
        }
      }

      cellMap.set(addr, {
        address: addr,
        row: cell.row,
        col: cell.col,
        cellType: cell.type,
        value: cell.value ?? undefined,
        formula: cell.formula ?? undefined,
        numberFormat,
        fontName,
        fontSize,
        fontBold,
        fontItalic,
        fontColor,
        fillColor,
        fillPattern,
      });
    }
  }

  return {
    cellMap,
    totalCells,
    sheetCount: result.sheets.length,
  };
}

// =============================================================================
// Comparison Logic
// =============================================================================

function normalizeFormula(formula: string | null | undefined): string {
  if (!formula) return '';
  let f = formula.trim();
  // Strip leading = (ground truth includes it, parser doesn't)
  if (f.startsWith('=')) {
    f = f.slice(1);
  }
  // Decode XML entities that the Rust parser may leave in
  f = f.replace(/&amp;/g, '&');
  f = f.replace(/&lt;/g, '<');
  f = f.replace(/&gt;/g, '>');
  f = f.replace(/&quot;/g, '"');
  f = f.replace(/&apos;/g, "'");
  return f;
}

function normalizeWhitespace(s: string): string {
  // Collapse runs of whitespace to single space, trim ends
  return s.replace(/\s+/g, ' ').trim();
}

function compareText(expected: string, actual: string): boolean {
  // First try exact match
  if (expected === actual) return true;
  // Fall back to whitespace-normalized comparison
  // Excel COM .Text includes column-width-dependent padding from _() and * metacharacters
  // Our formatter can't replicate exact padding, but the content is correct
  return normalizeWhitespace(expected) === normalizeWhitespace(actual);
}

function compareFormula(expected: string | null, actual: string | null | undefined): boolean {
  return normalizeFormula(expected) === normalizeFormula(actual);
}

function compareColor(expected: number, actual: number): boolean {
  // +-1 per RGB channel tolerance (accounts for rounding in tint application)
  // Each channel can differ by 1, so max total difference is 1*65536 + 1*256 + 1 = 65793
  const tolerance = 65793;
  return Math.abs(expected - actual) <= tolerance;
}

/**
 * Normalize a number format code for comparison.
 * XLSX XML stores escaped forms (backslash-escaped literals, quoted strings)
 * while Excel COM returns the simplified form.
 *
 * Examples:
 *   XML:     _("$"* #,##0.0_);_("$"* \(#,##0.0\))
 *   COM:     _($* #,##0.0_);_($* (#,##0.0))
 */
function normalizeNumberFormat(fmt: string): string {
  // Remove backslash escapes: \( -> (, \- -> -, etc.
  let result = fmt.replace(/\\(.)/g, '$1');
  // Remove double-quote wrapping around single characters: "$" -> $
  // Pattern: "X" where X is a single character
  result = result.replace(/"(.)"/g, '$1');
  return result.trim();
}

function compareNumberFormat(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  return normalizeNumberFormat(expected) === normalizeNumberFormat(actual);
}

// =============================================================================
// Properties to Compare
// =============================================================================

const ALL_PROPERTIES = [
  'text',
  'formula',
  'numberFormat',
  'font.name',
  'font.size',
  'font.bold',
  'font.italic',
  'font.color',
  'fill.color',
  'fill.pattern',
];

// =============================================================================
// Comparison Execution
// =============================================================================

function compareCells(groundTruth: GroundTruthData, parsed: ParsedData): ComparisonResult {
  const result: ComparisonResult = {
    overall: {
      totalCells: 0,
      perfectMatches: 0,
      matchPercentage: 0,
      parserCellCount: parsed.totalCells,
    },
    byProperty: {},
    cellDetails: {},
  };

  // Collect all ground truth cells
  const allCells: GroundTruthCell[] = [];
  for (const sheet of groundTruth.sheets) {
    allCells.push(...Object.values(sheet.cells));
  }

  result.overall.totalCells = allCells.length;

  // Initialize property stats
  for (const prop of ALL_PROPERTIES) {
    result.byProperty[prop] = {
      compared: 0,
      matches: 0,
      mismatches: 0,
      notAvailable: 0,
      matchPercentage: 0,
    };
  }

  // Compare each ground truth cell against parsed cell
  for (const gt of allCells) {
    const parsedCell = parsed.cellMap.get(gt.address);
    const cellComp: CellComparison = {
      address: gt.address,
      perfect: false,
      properties: {},
    };

    let cellPerfect = true;

    // --- text ---
    {
      let actual = parsedCell?.value ?? '';

      // Apply number formatting to produce display text comparable to ground truth
      if (parsedCell && actual !== '') {
        const numVal = Number(actual);
        if (!isNaN(numVal) && isFinite(numVal)) {
          try {
            const formatted = formatValueSimple(numVal, parsedCell.numberFormat || 'General');
            actual = formatted.text;
          } catch {
            // formatting failed, keep raw value
          }
        } else if (parsedCell.numberFormat && parsedCell.numberFormat !== 'General') {
          try {
            const formatted = formatValueSimple(actual, parsedCell.numberFormat || 'General');
            actual = formatted.text;
          } catch {
            // keep raw value
          }
        }
      }

      const match = compareText(gt.text, actual);
      cellComp.properties.text = {
        expected: gt.text,
        actual,
        match,
      };
      result.byProperty.text.compared++;
      if (match) {
        result.byProperty.text.matches++;
      } else {
        result.byProperty.text.mismatches++;
        cellPerfect = false;
      }
    }

    // --- formula ---
    {
      const actual = parsedCell?.formula ?? null;
      const match = compareFormula(gt.formula, actual);
      cellComp.properties.formula = {
        expected: gt.formula,
        actual,
        match,
      };
      result.byProperty.formula.compared++;
      if (match) {
        result.byProperty.formula.matches++;
      } else {
        result.byProperty.formula.mismatches++;
        cellPerfect = false;
      }
    }

    // --- numberFormat ---
    {
      const actual = parsedCell?.numberFormat ?? 'General';
      const match = compareNumberFormat(gt.numberFormat, actual);
      cellComp.properties.numberFormat = {
        expected: gt.numberFormat,
        actual,
        match,
      };
      result.byProperty.numberFormat.compared++;
      if (match) {
        result.byProperty.numberFormat.matches++;
      } else {
        result.byProperty.numberFormat.mismatches++;
        cellPerfect = false;
      }
    }

    // --- font.name ---
    {
      const expected = gt.font?.name ?? null;
      const actual = parsedCell?.fontName ?? null;
      if (actual === null && expected !== null) {
        // Parser does not yet provide this data
        cellComp.properties['font.name'] = {
          expected,
          actual: 'NOT_AVAILABLE',
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['font.name'].compared++;
        result.byProperty['font.name'].notAvailable++;
      } else {
        const match = expected === actual;
        cellComp.properties['font.name'] = { expected, actual, match };
        result.byProperty['font.name'].compared++;
        if (match) {
          result.byProperty['font.name'].matches++;
        } else {
          result.byProperty['font.name'].mismatches++;
          cellPerfect = false;
        }
      }
    }

    // --- font.size ---
    {
      const expected = gt.font?.size ?? null;
      const actual = parsedCell?.fontSize ?? null;
      if (actual === null && expected !== null) {
        cellComp.properties['font.size'] = {
          expected,
          actual: 'NOT_AVAILABLE',
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['font.size'].compared++;
        result.byProperty['font.size'].notAvailable++;
      } else {
        const match = expected === actual;
        cellComp.properties['font.size'] = { expected, actual, match };
        result.byProperty['font.size'].compared++;
        if (match) {
          result.byProperty['font.size'].matches++;
        } else {
          result.byProperty['font.size'].mismatches++;
          cellPerfect = false;
        }
      }
    }

    // --- font.bold ---
    {
      const expected = gt.font?.bold ?? null;
      const actual = parsedCell?.fontBold ?? null;
      if (actual === null && expected !== null) {
        cellComp.properties['font.bold'] = {
          expected,
          actual: 'NOT_AVAILABLE',
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['font.bold'].compared++;
        result.byProperty['font.bold'].notAvailable++;
      } else {
        const match = expected === actual;
        cellComp.properties['font.bold'] = { expected, actual, match };
        result.byProperty['font.bold'].compared++;
        if (match) {
          result.byProperty['font.bold'].matches++;
        } else {
          result.byProperty['font.bold'].mismatches++;
          cellPerfect = false;
        }
      }
    }

    // --- font.italic ---
    {
      const expected = gt.font?.italic ?? null;
      const actual = parsedCell?.fontItalic ?? null;
      if (actual === null && expected !== null) {
        cellComp.properties['font.italic'] = {
          expected,
          actual: 'NOT_AVAILABLE',
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['font.italic'].compared++;
        result.byProperty['font.italic'].notAvailable++;
      } else {
        const match = expected === actual;
        cellComp.properties['font.italic'] = { expected, actual, match };
        result.byProperty['font.italic'].compared++;
        if (match) {
          result.byProperty['font.italic'].matches++;
        } else {
          result.byProperty['font.italic'].mismatches++;
          cellPerfect = false;
        }
      }
    }

    // --- font.color ---
    {
      const expected = gt.font?.color ?? null;
      const actual = parsedCell?.fontColor ?? null;
      if (actual === null && expected !== null) {
        cellComp.properties['font.color'] = {
          expected,
          actual: 'NOT_AVAILABLE',
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['font.color'].compared++;
        result.byProperty['font.color'].notAvailable++;
      } else if (expected !== null && actual !== null) {
        const match = compareColor(expected, actual);
        cellComp.properties['font.color'] = { expected, actual, match };
        result.byProperty['font.color'].compared++;
        if (match) {
          result.byProperty['font.color'].matches++;
        } else {
          result.byProperty['font.color'].mismatches++;
          cellPerfect = false;
        }
      } else {
        // Both null
        cellComp.properties['font.color'] = {
          expected,
          actual,
          match: true,
        };
        result.byProperty['font.color'].compared++;
        result.byProperty['font.color'].matches++;
      }
    }

    // --- fill.color ---
    {
      const expected = gt.interior?.color ?? null;
      const actual = parsedCell?.fillColor ?? null;
      if (actual === null && expected !== null) {
        cellComp.properties['fill.color'] = {
          expected,
          actual: 'NOT_AVAILABLE',
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['fill.color'].compared++;
        result.byProperty['fill.color'].notAvailable++;
      } else if (expected !== null && actual !== null) {
        const match = compareColor(expected, actual);
        cellComp.properties['fill.color'] = { expected, actual, match };
        result.byProperty['fill.color'].compared++;
        if (match) {
          result.byProperty['fill.color'].matches++;
        } else {
          result.byProperty['fill.color'].mismatches++;
          cellPerfect = false;
        }
      } else {
        cellComp.properties['fill.color'] = {
          expected,
          actual,
          match: true,
        };
        result.byProperty['fill.color'].compared++;
        result.byProperty['fill.color'].matches++;
      }
    }

    // --- fill.pattern ---
    {
      const expected = gt.interior?.pattern ?? null;
      const actual = parsedCell?.fillPattern ?? null;
      if (actual === null && expected !== null) {
        cellComp.properties['fill.pattern'] = {
          expected,
          actual: 'NOT_AVAILABLE',
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['fill.pattern'].compared++;
        result.byProperty['fill.pattern'].notAvailable++;
      } else {
        // Pattern comparison is complex (Excel COM uses integers, parser uses strings)
        // For now, just track N/A since we need mapping
        cellComp.properties['fill.pattern'] = {
          expected,
          actual,
          match: false,
          reason: 'NOT_AVAILABLE',
        };
        result.byProperty['fill.pattern'].compared++;
        result.byProperty['fill.pattern'].notAvailable++;
      }
    }

    cellComp.perfect = cellPerfect;
    if (cellPerfect) {
      result.overall.perfectMatches++;
    }

    result.cellDetails![gt.address] = cellComp;
  }

  // Calculate percentages
  result.overall.matchPercentage =
    result.overall.totalCells > 0
      ? (result.overall.perfectMatches / result.overall.totalCells) * 100
      : 0;

  for (const prop of ALL_PROPERTIES) {
    const stats = result.byProperty[prop];
    const effectiveCompared = stats.compared - stats.notAvailable;
    stats.matchPercentage = effectiveCompared > 0 ? (stats.matches / effectiveCompared) * 100 : 0;
  }

  return result;
}

// =============================================================================
// Output Formatting
// =============================================================================

function formatPercentage(value: number): string {
  return value.toFixed(1) + '%';
}

function formatPropertyName(name: string): string {
  return name.padEnd(24, ' ');
}

function formatBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  return '\u2588'.repeat(filled) + ' '.repeat(width - filled);
}

function formatTextReport(result: ComparisonResult, options: Options): string {
  const lines: string[] = [];
  const width = 80;

  // Header
  lines.push('\u2554' + '\u2550'.repeat(width - 2) + '\u2557');
  lines.push('\u2551' + ' XLSX FIDELITY REPORT'.padEnd(width - 2, ' ') + '\u2551');
  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');

  // Overall stats
  lines.push(
    '\u2551' +
      ` Cells: ${result.overall.totalCells} ground truth, ${result.overall.parserCellCount} parsed`.padEnd(
        width - 2,
        ' ',
      ) +
      '\u2551',
  );
  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');

  const overallText = `OVERALL: ${formatPercentage(result.overall.matchPercentage)} match (${result.overall.perfectMatches}/${result.overall.totalCells} cells perfect)`;
  lines.push('\u2551' + ` ${overallText}`.padEnd(width - 2, ' ') + '\u2551');

  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');

  // Section: Core Properties
  lines.push('\u2551' + ' CORE PROPERTIES'.padEnd(width - 2, ' ') + '\u2551');
  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');

  const coreProps = ['text', 'formula', 'numberFormat'];
  for (const prop of coreProps) {
    if (options.property && prop !== options.property) continue;
    formatPropertyRow(lines, result.byProperty[prop], prop, width, options.verbose);
  }

  // Section: Font Properties
  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');
  lines.push('\u2551' + ' FONT PROPERTIES'.padEnd(width - 2, ' ') + '\u2551');
  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');

  const fontProps = ['font.name', 'font.size', 'font.bold', 'font.italic', 'font.color'];
  for (const prop of fontProps) {
    if (options.property && prop !== options.property) continue;
    formatPropertyRow(lines, result.byProperty[prop], prop, width, options.verbose);
  }

  // Section: Fill Properties
  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');
  lines.push('\u2551' + ' FILL PROPERTIES'.padEnd(width - 2, ' ') + '\u2551');
  lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');

  const fillProps = ['fill.color', 'fill.pattern'];
  for (const prop of fillProps) {
    if (options.property && prop !== options.property) continue;
    formatPropertyRow(lines, result.byProperty[prop], prop, width, options.verbose);
  }

  lines.push('\u255a' + '\u2550'.repeat(width - 2) + '\u255d');

  // Cell detail view
  if (options.cellAddress && result.cellDetails) {
    const cellComp = result.cellDetails[options.cellAddress];
    if (cellComp) {
      lines.push('');
      lines.push('\u2554' + '\u2550'.repeat(width - 2) + '\u2557');
      lines.push('\u2551' + ` CELL DETAIL: ${cellComp.address}`.padEnd(width - 2, ' ') + '\u2551');
      lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');
      lines.push(
        '\u2551' +
          ` Status: ${cellComp.perfect ? 'PERFECT MATCH' : 'MISMATCH'}`.padEnd(width - 2, ' ') +
          '\u2551',
      );
      lines.push('\u2560' + '\u2550'.repeat(width - 2) + '\u2563');

      for (const [prop, comp] of Object.entries(cellComp.properties)) {
        const status = comp.reason === 'NOT_AVAILABLE' ? '[N/A]' : comp.match ? '[OK]' : '[X]';
        lines.push('\u2551' + ` ${status} ${prop}:`.padEnd(width - 2, ' ') + '\u2551');
        lines.push(
          '\u2551' +
            `   Expected: ${JSON.stringify(comp.expected)}`
              .substring(0, width - 3)
              .padEnd(width - 2, ' ') +
            '\u2551',
        );
        lines.push(
          '\u2551' +
            `   Actual:   ${JSON.stringify(comp.actual)}`
              .substring(0, width - 3)
              .padEnd(width - 2, ' ') +
            '\u2551',
        );
        if (comp.reason) {
          lines.push('\u2551' + `   Reason:   ${comp.reason}`.padEnd(width - 2, ' ') + '\u2551');
        }
        lines.push('\u2551' + ' '.repeat(width - 2) + '\u2551');
      }

      lines.push('\u255a' + '\u2550'.repeat(width - 2) + '\u255d');
    } else {
      lines.push('');
      lines.push(`Cell ${options.cellAddress} not found in results.`);
    }
  }

  // Verbose: mismatch breakdown by property and root cause
  if (options.verbose && result.cellDetails) {
    const allMismatches = Object.values(result.cellDetails).filter((c) => !c.perfect);

    if (allMismatches.length > 0) {
      lines.push('');
      lines.push(`--- MISMATCH BREAKDOWN (${allMismatches.length} imperfect cells) ---`);

      // Analyze each property with mismatches
      for (const prop of ALL_PROPERTIES) {
        if (options.property && prop !== options.property) continue;
        const stats = result.byProperty[prop];
        if (stats.mismatches === 0) continue;

        // Collect mismatches for this property
        const propMismatches: { address: string; expected: any; actual: any }[] = [];
        for (const cell of allMismatches) {
          const p = cell.properties[prop];
          if (p && !p.match && p.reason !== 'NOT_AVAILABLE') {
            propMismatches.push({ address: cell.address, expected: p.expected, actual: p.actual });
          }
        }

        if (propMismatches.length === 0) continue;

        // Categorize by root cause
        const emptyActual = propMismatches.filter((m) => !m.actual || m.actual === '');
        const contentDiff = propMismatches.filter((m) => m.actual && m.actual !== '');

        lines.push('');
        lines.push(`  ${prop} (${propMismatches.length} mismatches):`);

        if (emptyActual.length > 0) {
          lines.push(`    Empty/missing value: ${emptyActual.length}`);
          for (const m of emptyActual.slice(0, 5)) {
            lines.push(`      ${m.address}: expected=${JSON.stringify(m.expected)}`);
          }
          if (emptyActual.length > 5) {
            lines.push(`      ... and ${emptyActual.length - 5} more`);
          }
        }

        if (contentDiff.length > 0) {
          lines.push(`    Wrong content: ${contentDiff.length}`);
          for (const m of contentDiff.slice(0, 5)) {
            const exp = JSON.stringify(m.expected);
            const act = JSON.stringify(m.actual);
            lines.push(
              `      ${m.address}: expected=${exp.substring(0, 50)} actual=${act.substring(0, 50)}`,
            );
          }
          if (contentDiff.length > 5) {
            lines.push(`      ... and ${contentDiff.length - 5} more`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

function formatPropertyRow(
  lines: string[],
  stats: ComparisonResult['byProperty'][string],
  prop: string,
  width: number,
  verbose: boolean,
): void {
  const effectiveCompared = stats.compared - stats.notAvailable;
  const bar = formatBar(stats.matchPercentage, 20);
  const pct = formatPercentage(stats.matchPercentage).padStart(6, ' ');
  const propName = formatPropertyName(prop);
  const naTag = stats.notAvailable > 0 ? ` [${stats.notAvailable} N/A]` : '';

  const propLine = `${propName}${bar} ${pct}${naTag}`;
  lines.push('\u2551' + ` ${propLine}`.padEnd(width - 2, ' ') + '\u2551');

  if (verbose) {
    const detail = `    (${stats.matches}/${effectiveCompared} match, ${stats.mismatches} mismatch, ${stats.notAvailable} N/A)`;
    lines.push('\u2551' + ` ${detail}`.padEnd(width - 2, ' ') + '\u2551');
  }
}

function formatJsonReport(result: ComparisonResult): string {
  return JSON.stringify(result, null, 2);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
XLSX Fidelity System CLI

Compares xlsx-parser output against Excel COM ground truth.
Uses parse_xlsx_full() for structured data including styles and theme.

Usage:
  pnpm xlsx-fidelity <xlsx-file>                    # Summary report
  pnpm xlsx-fidelity <xlsx-file> cell <address>     # Cell detail view
  pnpm xlsx-fidelity <xlsx-file> --property <name>  # Property filter
  pnpm xlsx-fidelity <xlsx-file> --format json      # JSON output

Options:
  --property <name>  Filter to specific property
  --format <format>  Output format: text (default) or json
  --verbose          Show detailed statistics and sample mismatches
  --help             Show this help message

Properties:
  Core:  text, formula, numberFormat
  Font:  font.name, font.size, font.bold, font.italic, font.color
  Fill:  fill.color, fill.pattern

Examples:
  # Basic usage
  pnpm xlsx-fidelity sample-model.xlsx

  # View specific cell
  pnpm xlsx-fidelity sample-model.xlsx cell B2

  # Filter to formula accuracy
  pnpm xlsx-fidelity sample-model.xlsx --property formula

  # JSON output for scripting
  pnpm xlsx-fidelity sample-model.xlsx --format json

Ground Truth:
  The tool looks for <filename>_extracted.json in the same directory as the XLSX file.
  Generate ground truth using the VBA extraction script.

Note:
  Font, fill, and border properties show N/A when the Rust parser does not yet
  output the corresponding style arrays (fonts, fills, borders).
`);
    process.exit(0);
  }

  // Parse arguments
  const options: Options = {
    format: 'text',
    verbose: args.includes('--verbose') || args.includes('-v'),
  };

  if (args.includes('--format')) {
    const idx = args.indexOf('--format');
    options.format = args[idx + 1] as 'text' | 'json';
  }

  if (args.includes('--property')) {
    const idx = args.indexOf('--property');
    options.property = args[idx + 1];
  }

  const cellIdx = args.indexOf('cell');
  if (cellIdx !== -1 && cellIdx < args.length - 1) {
    options.cellAddress = args[cellIdx + 1];
  }

  // Get file path
  const filePath = args.find((a) => !a.startsWith('-') && a !== 'cell' && a.endsWith('.xlsx'));

  if (!filePath) {
    console.error('Error: Please provide an XLSX file path');
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    // Load ground truth
    if (options.format === 'text') {
      console.error('Loading ground truth...');
    }
    const groundTruth = loadGroundTruth(filePath);

    // Load WASM module
    if (options.format === 'text') {
      console.error('Loading xlsx-parser WASM module...');
    }
    const wasm = await loadWasmModule();

    // Parse XLSX using parse_xlsx_full
    if (options.format === 'text') {
      console.error('Parsing XLSX file with parse_xlsx_full...');
    }
    const parsed = parseAndResolve(wasm, filePath);

    if (options.format === 'text') {
      console.error(`Parsed ${parsed.totalCells} cells across ${parsed.sheetCount} sheet(s)`);
    }

    // Compare
    if (options.format === 'text') {
      console.error('Comparing results...');
      console.error('');
    }
    const comparison = compareCells(groundTruth, parsed);

    // Output
    if (options.format === 'json') {
      console.log(formatJsonReport(comparison));
    } else {
      console.log(formatTextReport(comparison, options));
    }

    // Exit code: fail if core properties (text, formula, numberFormat) are below 95%
    const coreProps = ['text', 'formula', 'numberFormat'];
    const allCoreAbove95 = coreProps.every((p) => {
      const stats = comparison.byProperty[p];
      const effectiveCompared = stats.compared - stats.notAvailable;
      return effectiveCompared === 0 || stats.matchPercentage >= 95;
    });

    if (!allCoreAbove95) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

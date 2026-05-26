/**
 * BinaryViewportBuffer + CellAccessor + buildTestViewportBuffer tests.
 *
 * Covers:
 *   - Header parsing
 *   - Cell offset computation
 *   - CellAccessor field decoding (all 7 fixed fields)
 *   - Flag bit decoding (all 10 flags)
 *   - String pool decoding + NO_STRING sentinel
 *   - Patch overlay (numeric + string)
 *   - String decode cache + invalidation
 *   - Format palette lookup
 *   - Merge records
 *   - Row/Col dimension records
 *   - Patch key uniqueness
 *   - Test builder roundtrip
 */

// Polyfill window for Node test environment (devtools reporting uses `window`)
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {};
}

import {
  BinaryViewportBuffer,
  CELL_STRIDE,
  HEADER_SIZE,
  PATCH_KEY_COL_BITS,
  ValueType,
} from '../binary-viewport-buffer';
import type { TestCell } from '../viewport-test-builder';
import { buildTestViewportBuffer } from '../viewport-test-builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build flags with the given value type and optional flag bits. */
function makeFlags(
  valueType: number,
  opts: {
    hasFormula?: boolean;
    hasComment?: boolean;
    hasSparkline?: boolean;
    hasHyperlink?: boolean;
    isCheckbox?: boolean;
    isProjectedPosition?: boolean;
    hasValidationError?: boolean;
  } = {},
): number {
  let f = valueType & 0x7;
  if (opts.hasFormula) f |= 0x8;
  if (opts.hasComment) f |= 0x10;
  if (opts.hasSparkline) f |= 0x20;
  if (opts.hasHyperlink) f |= 0x40;
  if (opts.isCheckbox) f |= 0x80;
  if (opts.isProjectedPosition) f |= 0x100;
  if (opts.hasValidationError) f |= 0x200;
  return f;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BinaryViewportBuffer', () => {
  let vb: BinaryViewportBuffer;

  beforeEach(() => {
    vb = new BinaryViewportBuffer();
  });

  // -----------------------------------------------------------------------
  // Header parsing
  // -----------------------------------------------------------------------

  describe('setBuffer / header parsing', () => {
    it('correctly parses all header fields', () => {
      const buf = buildTestViewportBuffer({
        rows: 5,
        cols: 10,
        startRow: 100,
        startCol: 3,
        generation: 42,
        isDelta: true,
        protocolVersion: 2,
      });

      vb.setBuffer(buf);

      expect(vb.getStartRow()).toBe(100);
      expect(vb.getStartCol()).toBe(3);
      expect(vb.getRows()).toBe(5);
      expect(vb.getCols()).toBe(10);
      expect(vb.getCellCount()).toBe(50);
      expect(vb.getGeneration()).toBe(42);
      expect(vb.isDelta()).toBe(true);
      expect(vb.getProtocolVersion()).toBe(2);
      expect(vb.hasBuffer()).toBe(true);
    });

    it('hasBuffer returns false before setBuffer', () => {
      expect(vb.hasBuffer()).toBe(false);
    });

    it('parses position arrays from unaligned Uint8Array views', () => {
      const aligned = buildTestViewportBuffer({
        rows: 2,
        cols: 2,
        rowPositions: [0, 20, 40],
        colPositions: [0, 64, 128],
      });
      const unaligned = Buffer.concat([Buffer.from([0]), Buffer.from(aligned)]).subarray(1);

      vb.setBuffer(unaligned);

      expect(Array.from(vb.getRowPositions() ?? [])).toEqual([0, 20, 40]);
      expect(Array.from(vb.getColPositions() ?? [])).toEqual([0, 64, 128]);
    });
  });

  // -----------------------------------------------------------------------
  // Cell offset computation
  // -----------------------------------------------------------------------

  describe('cellOffset', () => {
    beforeEach(() => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 3, cols: 4, startRow: 10, startCol: 5 }));
    });

    it('returns correct byte position for first cell', () => {
      expect(vb.cellOffset(10, 5)).toBe(HEADER_SIZE);
    });

    it('returns correct byte position for cell at (11, 7)', () => {
      // localRow=1, localCol=2, index = 1*4+2 = 6
      expect(vb.cellOffset(11, 7)).toBe(HEADER_SIZE + 6 * CELL_STRIDE);
    });

    it('returns correct byte position for last cell', () => {
      // localRow=2, localCol=3, index = 2*4+3 = 11
      expect(vb.cellOffset(12, 8)).toBe(HEADER_SIZE + 11 * CELL_STRIDE);
    });

    it('returns -1 for row before viewport', () => {
      expect(vb.cellOffset(9, 5)).toBe(-1);
    });

    it('returns -1 for row after viewport', () => {
      expect(vb.cellOffset(13, 5)).toBe(-1);
    });

    it('returns -1 for col before viewport', () => {
      expect(vb.cellOffset(10, 4)).toBe(-1);
    });

    it('returns -1 for col after viewport', () => {
      expect(vb.cellOffset(10, 9)).toBe(-1);
    });
  });

  // -----------------------------------------------------------------------
  // CellAccessor — fixed fields
  // -----------------------------------------------------------------------

  describe('CellAccessor.moveTo', () => {
    it('decodes all 7 fixed fields correctly', () => {
      const cells: TestCell[] = [
        {
          numberValue: 42.5,
          display: 'hello',
          error: 'ERR',
          flags: makeFlags(ValueType.Number, { hasFormula: true }),
          formatIdx: 7,
        },
      ];

      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();

      expect(acc.moveTo(0, 0)).toBe(true);
      expect(acc.numberValue).toBe(42.5);
      expect(acc.flags).toBe(makeFlags(ValueType.Number, { hasFormula: true }));
      expect(acc.formatIdx).toBe(7);
      // Display and error offsets are internal, but we verify through the text getters
      expect(acc.displayText).toBe('hello');
      expect(acc.errorText).toBe('ERR');
    });

    it('returns false for out-of-bounds cell', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 2, cols: 2 }));
      const acc = vb.createAccessor();

      expect(acc.moveTo(5, 5)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Flag bit decoding
  // -----------------------------------------------------------------------

  describe('CellAccessor flag bits', () => {
    it('decodes valueType (bits 0-2)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(ValueType.Text) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.valueType).toBe(ValueType.Text);
    });

    it('decodes hasFormula (bit 3)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(0, { hasFormula: true }) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.hasFormula).toBe(true);
    });

    it('decodes hasComment (bit 4)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(0, { hasComment: true }) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.hasComment).toBe(true);
    });

    it('decodes hasSparkline (bit 5)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(0, { hasSparkline: true }) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.hasSparkline).toBe(true);
    });

    it('decodes hasHyperlink (bit 6)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(0, { hasHyperlink: true }) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.hasHyperlink).toBe(true);
    });

    it('decodes isCheckbox (bit 7)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(0, { isCheckbox: true }) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.isCheckbox).toBe(true);
    });

    it('decodes isProjectedPosition (bit 8)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(0, { isProjectedPosition: true }) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.isProjectedPosition).toBe(true);
    });

    it('decodes hasValidationError (bit 9)', () => {
      const cells: TestCell[] = [{ flags: makeFlags(0, { hasValidationError: true }) }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.hasValidationError).toBe(true);
    });

    it('decodes multiple flags simultaneously', () => {
      const cells: TestCell[] = [
        {
          flags: makeFlags(ValueType.Error, {
            hasFormula: true,
            hasComment: true,
            hasHyperlink: true,
            hasValidationError: true,
          }),
        },
      ];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);

      expect(acc.valueType).toBe(ValueType.Error);
      expect(acc.hasFormula).toBe(true);
      expect(acc.hasComment).toBe(true);
      expect(acc.hasSparkline).toBe(false);
      expect(acc.hasHyperlink).toBe(true);
      expect(acc.isCheckbox).toBe(false);
      expect(acc.isProjectedPosition).toBe(false);
      expect(acc.hasValidationError).toBe(true);
    });

    it('all flags false when flags = 0', () => {
      const cells: TestCell[] = [{ flags: 0 }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);

      expect(acc.valueType).toBe(ValueType.Null);
      expect(acc.hasFormula).toBe(false);
      expect(acc.hasComment).toBe(false);
      expect(acc.hasSparkline).toBe(false);
      expect(acc.hasHyperlink).toBe(false);
      expect(acc.isCheckbox).toBe(false);
      expect(acc.isProjectedPosition).toBe(false);
      expect(acc.hasValidationError).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // String pool — displayText / errorText
  // -----------------------------------------------------------------------

  describe('displayText', () => {
    it('returns null for NO_STRING sentinel (empty cell)', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1 }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.displayText).toBeNull();
    });

    it('decodes display text from string pool', () => {
      const cells: TestCell[] = [{ display: 'Hello, World!' }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.displayText).toBe('Hello, World!');
    });

    it('decodes unicode display text', () => {
      const cells: TestCell[] = [{ display: 'price: \u00a5123' }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.displayText).toBe('price: \u00a5123');
    });
  });

  describe('errorText', () => {
    it('returns null for NO_STRING sentinel', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1 }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.errorText).toBeNull();
    });

    it('decodes error text from string pool', () => {
      const cells: TestCell[] = [{ error: '#DIV/0!' }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.errorText).toBe('#DIV/0!');
    });
  });

  // -----------------------------------------------------------------------
  // Patching
  // -----------------------------------------------------------------------

  // patchCellValue tests removed — patchCellValue was the old JSON mutation path,
  // replaced by applyBinaryMutation() + ViewportCoordinator overlay.

  // -----------------------------------------------------------------------
  // String decode cache
  // -----------------------------------------------------------------------

  describe('string decode cache', () => {
    it('returns same string on second read (cache hit)', () => {
      const cells: TestCell[] = [{ display: 'cached' }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();

      acc.moveTo(0, 0);
      const first = acc.displayText;
      acc.moveTo(0, 0);
      const second = acc.displayText;

      expect(first).toBe('cached');
      expect(second).toBe('cached');
      // Same reference from cache
      expect(first).toBe(second);
    });

    it('cache is invalidated by writeOverlayEntryToBase', () => {
      const cells: TestCell[] = [{ display: 'before' }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));
      const acc = vb.createAccessor();

      acc.moveTo(0, 0);
      expect(acc.displayText).toBe('before');

      // Write overlay entry (coordinator path for re-application after fetch)
      vb.writeOverlayEntryToBase(0, 0, {
        flags: 0,
        numberValue: 0,
        formatIdx: 0,
        displayString: 'after',
        errorString: null,
        bgColorOverride: 0,
        fontColorOverride: 0,
      });

      acc.moveTo(0, 0);
      expect(acc.displayText).toBe('after');
    });
  });

  // -----------------------------------------------------------------------
  // Format palette
  // -----------------------------------------------------------------------

  describe('getFormatByIndex', () => {
    it('returns correct palette entry', () => {
      const palette = [{ bold: true }, { italic: true, fontSize: 14 }, { fontColor: '#ff0000' }];
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          palette,
          paletteStartIndex: 1,
        }),
      );

      expect(vb.getFormatByIndex(1)).toEqual({ bold: true });
      expect(vb.getFormatByIndex(2)).toEqual({ italic: true, fontSize: 14 });
      expect(vb.getFormatByIndex(3)).toEqual({ fontColor: '#ff0000' });
    });

    it('returns empty format for out-of-range index', () => {
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          palette: [{ bold: true }],
          paletteStartIndex: 0,
        }),
      );

      const result = vb.getFormatByIndex(99);
      expect(result).toEqual({});
    });

    it('returns empty format for index below start_index', () => {
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          palette: [{ bold: true }],
          paletteStartIndex: 5,
        }),
      );

      expect(vb.getFormatByIndex(0)).toEqual({});
      expect(vb.getFormatByIndex(4)).toEqual({});
    });

    it('CellAccessor.format resolves through palette', () => {
      const palette = [{ bold: true }, { italic: true }];
      const cells: TestCell[] = [{ formatIdx: 1 }];
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells,
          palette,
          paletteStartIndex: 0,
        }),
      );

      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.format).toEqual({ italic: true });
    });
  });

  // -----------------------------------------------------------------------
  // Merge records
  // -----------------------------------------------------------------------

  describe('getMerges', () => {
    it('returns empty array when no merges', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1 }));
      expect(vb.getMerges()).toEqual([]);
    });

    it('returns correct merge regions', () => {
      const merges = [
        { startRow: 0, startCol: 0, endRow: 1, endCol: 2 },
        { startRow: 3, startCol: 1, endRow: 5, endCol: 4 },
      ];
      vb.setBuffer(buildTestViewportBuffer({ rows: 6, cols: 5, merges }));

      const result = vb.getMerges();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        start_row: 0,
        start_col: 0,
        end_row: 1,
        end_col: 2,
      });
      expect(result[1]).toEqual({
        start_row: 3,
        start_col: 1,
        end_row: 5,
        end_col: 4,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Row/Col dimensions
  // -----------------------------------------------------------------------

  describe('getRowDimensions', () => {
    it('returns empty array when no row dimensions', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1 }));
      expect(vb.getRowDimensions()).toEqual([]);
    });

    it('returns correct row dimension data', () => {
      const rowDimensions = [
        { row: 0, height: 20.5 },
        { row: 3, height: 40, hidden: true },
      ];
      vb.setBuffer(buildTestViewportBuffer({ rows: 5, cols: 1, rowDimensions }));

      const result = vb.getRowDimensions();
      expect(result).toHaveLength(2);
      expect(result[0].row).toBe(0);
      expect(result[0].height).toBeCloseTo(20.5);
      expect(result[0].hidden).toBe(false);
      expect(result[1].row).toBe(3);
      expect(result[1].height).toBeCloseTo(40);
      expect(result[1].hidden).toBe(true);
    });
  });

  describe('getColDimensions', () => {
    it('returns empty array when no col dimensions', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1 }));
      expect(vb.getColDimensions()).toEqual([]);
    });

    it('returns correct col dimension data', () => {
      const colDimensions = [
        { col: 0, width: 100.25 },
        { col: 2, width: 50, hidden: true },
      ];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 3, colDimensions }));

      const result = vb.getColDimensions();
      expect(result).toHaveLength(2);
      expect(result[0].col).toBe(0);
      expect(result[0].width).toBeCloseTo(100.25);
      expect(result[0].hidden).toBe(false);
      expect(result[1].col).toBe(2);
      expect(result[1].width).toBeCloseTo(50);
      expect(result[1].hidden).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Patch key uniqueness
  // -----------------------------------------------------------------------

  describe('patch key uniqueness', () => {
    it('row * PATCH_KEY_COL_BITS + col is unique for valid Excel ranges', () => {
      // Excel max: 1,048,576 rows x 16,384 cols
      // PATCH_KEY_COL_BITS = 0x100000 = 1,048,576
      // Key = row * 1,048,576 + col
      // For row=0, col=16383 -> key = 16383
      // For row=1, col=0 -> key = 1,048,576
      // These must not collide
      const key1 = 0 * PATCH_KEY_COL_BITS + 16383;
      const key2 = 1 * PATCH_KEY_COL_BITS + 0;
      expect(key1).not.toBe(key2);
      expect(key1).toBe(16383);
      expect(key2).toBe(PATCH_KEY_COL_BITS);

      // Max possible key within valid Excel range
      const maxRow = 1048575; // 2^20 - 1
      const maxCol = 16383; // 2^14 - 1
      const maxKey = maxRow * PATCH_KEY_COL_BITS + maxCol;
      // Ensure it fits in a JS safe integer
      expect(maxKey).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });
  });

  // -----------------------------------------------------------------------
  // Test builder roundtrip
  // -----------------------------------------------------------------------

  describe('buildTestViewportBuffer roundtrip', () => {
    it('roundtrips a 3x4 viewport with all features', () => {
      const cells: TestCell[] = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          cells.push({
            numberValue: r * 10 + c,
            display: `R${r}C${c}`,
            flags: makeFlags(ValueType.Number),
            formatIdx: r === 0 ? 1 : 0,
          });
        }
      }

      const palette = [{ bold: true }, { italic: true }];
      const merges = [{ startRow: 5, startCol: 2, endRow: 6, endCol: 3 }];
      const rowDimensions = [{ row: 5, height: 25 }];
      const colDimensions = [{ col: 2, width: 80 }];

      const buf = buildTestViewportBuffer({
        rows: 3,
        cols: 4,
        startRow: 5,
        startCol: 2,
        cells,
        palette,
        paletteStartIndex: 0,
        merges,
        rowDimensions,
        colDimensions,
        generation: 7,
      });

      vb.setBuffer(buf);

      // Verify header
      expect(vb.getStartRow()).toBe(5);
      expect(vb.getStartCol()).toBe(2);
      expect(vb.getRows()).toBe(3);
      expect(vb.getCols()).toBe(4);
      expect(vb.getCellCount()).toBe(12);
      expect(vb.getGeneration()).toBe(7);

      // Verify all cells via accessor
      const acc = vb.createAccessor();
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          expect(acc.moveTo(r + 5, c + 2)).toBe(true);
          expect(acc.numberValue).toBe(r * 10 + c);
          expect(acc.displayText).toBe(`R${r}C${c}`);
          expect(acc.valueType).toBe(ValueType.Number);
          expect(acc.formatIdx).toBe(r === 0 ? 1 : 0);
        }
      }

      // Verify format palette
      expect(acc.moveTo(5, 2)).toBe(true); // row 0, formatIdx 1
      expect(acc.format).toEqual({ italic: true });
      expect(acc.moveTo(6, 2)).toBe(true); // row 1, formatIdx 0
      expect(acc.format).toEqual({ bold: true });

      // Verify merges
      const m = vb.getMerges();
      expect(m).toHaveLength(1);
      expect(m[0]).toEqual({
        start_row: 5,
        start_col: 2,
        end_row: 6,
        end_col: 3,
      });

      // Verify dimensions
      const rd = vb.getRowDimensions();
      expect(rd).toHaveLength(1);
      expect(rd[0].row).toBe(5);
      expect(rd[0].height).toBeCloseTo(25);

      const cd = vb.getColDimensions();
      expect(cd).toHaveLength(1);
      expect(cd[0].col).toBe(2);
      expect(cd[0].width).toBeCloseTo(80);
    });

    it('roundtrips empty viewport', () => {
      const buf = buildTestViewportBuffer({ rows: 2, cols: 2 });
      vb.setBuffer(buf);

      expect(vb.getCellCount()).toBe(4);
      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.displayText).toBeNull();
      expect(acc.errorText).toBeNull();
      expect(acc.numberValue).toBeNaN();
      expect(acc.flags).toBe(0);
    });

    it('roundtrips cells with both display and error text', () => {
      const cells: TestCell[] = [{ display: 'value', error: '#REF!' }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));

      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.displayText).toBe('value');
      expect(acc.errorText).toBe('#REF!');
    });

    it('handles cells with only error text (no display)', () => {
      const cells: TestCell[] = [{ error: '#N/A' }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1, cells }));

      const acc = vb.createAccessor();
      acc.moveTo(0, 0);
      expect(acc.displayText).toBeNull();
      expect(acc.errorText).toBe('#N/A');
    });
  });

  // -----------------------------------------------------------------------
  // Multiple cells with shared string pool
  // -----------------------------------------------------------------------

  describe('multi-cell string pool', () => {
    it('correctly decodes strings for multiple cells sharing the pool', () => {
      const cells: TestCell[] = [
        { display: 'alpha' },
        { display: 'beta' },
        { display: 'gamma' },
        { display: 'delta' },
      ];
      vb.setBuffer(buildTestViewportBuffer({ rows: 2, cols: 2, cells }));

      const acc = vb.createAccessor();

      acc.moveTo(0, 0);
      expect(acc.displayText).toBe('alpha');

      acc.moveTo(0, 1);
      expect(acc.displayText).toBe('beta');

      acc.moveTo(1, 0);
      expect(acc.displayText).toBe('gamma');

      acc.moveTo(1, 1);
      expect(acc.displayText).toBe('delta');
    });
  });

  // -----------------------------------------------------------------------
  // Lazy dimension index (getRowDimension / getColDimension)
  // -----------------------------------------------------------------------

  describe('getRowDimension', () => {
    it('returns correct dimension for a known row', () => {
      const rowDimensions = [
        { row: 0, height: 20.5 },
        { row: 3, height: 40, hidden: true },
      ];
      vb.setBuffer(buildTestViewportBuffer({ rows: 5, cols: 1, rowDimensions }));

      const dim = vb.getRowDimension(3);
      expect(dim).not.toBeNull();
      expect(dim!.row).toBe(3);
      expect(dim!.height).toBeCloseTo(40);
      expect(dim!.hidden).toBe(true);
    });

    it('returns null for unknown row', () => {
      const rowDimensions = [{ row: 0, height: 20 }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 5, cols: 1, rowDimensions }));

      expect(vb.getRowDimension(99)).toBeNull();
    });
  });

  describe('getColDimension', () => {
    it('returns correct dimension for a known col', () => {
      const colDimensions = [
        { col: 0, width: 100 },
        { col: 2, width: 50, hidden: true },
      ];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 3, colDimensions }));

      const dim = vb.getColDimension(2);
      expect(dim).not.toBeNull();
      expect(dim!.col).toBe(2);
      expect(dim!.width).toBeCloseTo(50);
      expect(dim!.hidden).toBe(true);
    });

    it('returns null for unknown col', () => {
      const colDimensions = [{ col: 0, width: 100 }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 3, colDimensions }));

      expect(vb.getColDimension(99)).toBeNull();
    });
  });

  describe('dimension index invalidation', () => {
    it('is rebuilt after setBuffer()', () => {
      const rowDimensions1 = [{ row: 0, height: 20 }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 2, cols: 1, rowDimensions: rowDimensions1 }));
      expect(vb.getRowDimension(0)!.height).toBeCloseTo(20);

      const rowDimensions2 = [{ row: 0, height: 55 }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 2, cols: 1, rowDimensions: rowDimensions2 }));
      expect(vb.getRowDimension(0)!.height).toBeCloseTo(55);
    });
  });

  // -----------------------------------------------------------------------
  // getBounds / setSheetId
  // -----------------------------------------------------------------------

  describe('getBounds', () => {
    it('returns null when no buffer', () => {
      expect(vb.getBounds()).toBeNull();
    });

    it('returns correct bounds from header fields', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 5, cols: 10, startRow: 100, startCol: 3 }));

      const bounds = vb.getBounds();
      expect(bounds).not.toBeNull();
      expect(bounds!.startRow).toBe(100);
      expect(bounds!.startCol).toBe(3);
      expect(bounds!.endRow).toBe(104);
      expect(bounds!.endCol).toBe(12);
    });

    it('reflects setSheetId in sheetId field', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1 }));
      vb.setSheetId('my-sheet-id');

      expect(vb.getBounds()!.sheetId).toBe('my-sheet-id');
    });
  });

  // -----------------------------------------------------------------------
  // Dimension patching
  // -----------------------------------------------------------------------

  describe('patchRowDimension', () => {
    it('adds a new row dimension', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 3, cols: 1 }));

      vb.patchRowDimension(5, 30);
      const dim = vb.getRowDimension(5);
      expect(dim).not.toBeNull();
      expect(dim!.row).toBe(5);
      expect(dim!.height).toBe(30);
      expect(dim!.hidden).toBe(false);
    });

    it('updates an existing row dimension', () => {
      const rowDimensions = [{ row: 0, height: 20 }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 2, cols: 1, rowDimensions }));

      vb.patchRowDimension(0, 99, true);
      const dim = vb.getRowDimension(0);
      expect(dim!.height).toBe(99);
      expect(dim!.hidden).toBe(true);
    });

    it('patched dimensions are cleared after setBuffer()', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 2, cols: 1 }));
      vb.patchRowDimension(42, 100);
      expect(vb.getRowDimension(42)).not.toBeNull();

      vb.setBuffer(buildTestViewportBuffer({ rows: 2, cols: 1 }));
      expect(vb.getRowDimension(42)).toBeNull();
    });
  });

  describe('patchColDimension', () => {
    it('adds a new col dimension', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 3 }));

      vb.patchColDimension(7, 200);
      const dim = vb.getColDimension(7);
      expect(dim).not.toBeNull();
      expect(dim!.col).toBe(7);
      expect(dim!.width).toBe(200);
      expect(dim!.hidden).toBe(false);
    });

    it('updates an existing col dimension', () => {
      const colDimensions = [{ col: 1, width: 80 }];
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 3, colDimensions }));

      vb.patchColDimension(1, 150, true);
      const dim = vb.getColDimension(1);
      expect(dim!.width).toBe(150);
      expect(dim!.hidden).toBe(true);
    });

    it('patched dimensions are cleared after setBuffer()', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 3 }));
      vb.patchColDimension(99, 300);
      expect(vb.getColDimension(99)).not.toBeNull();

      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 3 }));
      expect(vb.getColDimension(99)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // isInViewport
  // -----------------------------------------------------------------------

  describe('isInViewport', () => {
    beforeEach(() => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 3, cols: 4, startRow: 10, startCol: 5 }));
    });

    it('returns true for cells within viewport', () => {
      expect(vb.isInViewport(10, 5)).toBe(true);
      expect(vb.isInViewport(11, 7)).toBe(true);
      expect(vb.isInViewport(12, 8)).toBe(true);
    });

    it('returns false for cells outside viewport', () => {
      expect(vb.isInViewport(9, 5)).toBe(false);
      expect(vb.isInViewport(13, 5)).toBe(false);
      expect(vb.isInViewport(10, 4)).toBe(false);
      expect(vb.isInViewport(10, 9)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Visible window
  // -----------------------------------------------------------------------

  describe('setVisibleWindow', () => {
    it('stores and retrieves visible window bounds', () => {
      vb.setBuffer(buildTestViewportBuffer({ rows: 1, cols: 1 }));

      const bounds = {
        sheetId: 'sheet1',
        startRow: 0,
        startCol: 0,
        endRow: 10,
        endCol: 5,
      };
      vb.setVisibleWindow(bounds);
      expect(vb.getVisibleWindow()).toBe(bounds);

      vb.setVisibleWindow(null);
      expect(vb.getVisibleWindow()).toBeNull();
    });
  });
});

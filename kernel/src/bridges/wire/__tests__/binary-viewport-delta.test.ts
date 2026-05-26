/**
 * Tests for BinaryViewportBuffer.applyDelta()
 *
 * Verifies:
 *   - Delta merge produces correct combined buffer
 *   - String pool rebasing is correct
 *   - Format palette appending works
 *   - Delta cells are placed at correct grid positions
 *   - Cells from old buffer in overlap region are preserved
 */
// Polyfill window for Node test environment (devtools reporting uses `window`)
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {};
}

import { BinaryViewportBuffer, ValueType } from '../binary-viewport-buffer';
import type { TestCell, TestViewportOptions } from '../viewport-test-builder';
import { buildTestViewportBuffer } from '../viewport-test-builder';

// ---------------------------------------------------------------------------
// Helper: build a delta buffer (isDelta = true)
// ---------------------------------------------------------------------------

function buildDeltaBuffer(opts: TestViewportOptions): Uint8Array {
  return buildTestViewportBuffer({ ...opts, isDelta: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BinaryViewportBuffer.applyDelta', () => {
  it('should merge a scroll-down delta into an existing buffer', () => {
    // Existing buffer: rows 0..5, cols 0..3 (5 rows, 3 cols = 15 cells)
    const existingCells: TestCell[] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        existingCells.push({
          display: `E${r}-${c}`,
          flags: ValueType.Text << 0,
          numberValue: 0,
          formatIdx: 0,
        });
      }
    }

    const existingBuf = buildTestViewportBuffer({
      rows: 5,
      cols: 3,
      startRow: 0,
      startCol: 0,
      cells: existingCells,
      palette: [{}],
    });

    // Delta: rows 5..8 (3 new rows), cols 0..3
    const deltaCells: TestCell[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        deltaCells.push({
          display: `D${r + 5}-${c}`,
          flags: ValueType.Text << 0,
          numberValue: 0,
          formatIdx: 0,
        });
      }
    }

    const deltaBuf = buildDeltaBuffer({
      rows: 3,
      cols: 3,
      startRow: 5,
      startCol: 0,
      cells: deltaCells,
      palette: [],
      paletteStartIndex: 1,
    });

    // Apply delta
    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    vb.applyDelta(deltaBuf, 0, 0, 8, 3);

    // Verify combined dimensions
    expect(vb.getStartRow()).toBe(0);
    expect(vb.getStartCol()).toBe(0);
    expect(vb.getRows()).toBe(8);
    expect(vb.getCols()).toBe(3);
    expect(vb.getCellCount()).toBe(24); // 8 * 3

    // Verify existing cells are preserved
    const accessor = vb.createAccessor();
    expect(accessor.moveTo(0, 0)).toBe(true);
    expect(accessor.displayText).toBe('E0-0');

    expect(accessor.moveTo(4, 2)).toBe(true);
    expect(accessor.displayText).toBe('E4-2');

    // Verify delta cells are placed correctly
    expect(accessor.moveTo(5, 0)).toBe(true);
    expect(accessor.displayText).toBe('D5-0');

    expect(accessor.moveTo(7, 2)).toBe(true);
    expect(accessor.displayText).toBe('D7-2');
  });

  it('should correctly rebase string pool offsets in delta cells', () => {
    // Existing buffer: 1 cell with a long display string
    const existingBuf = buildTestViewportBuffer({
      rows: 1,
      cols: 1,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'EXISTING_STRING_DATA', flags: ValueType.Text, numberValue: 0 }],
      palette: [{}],
    });

    // Delta: 1 cell at row 1, col 0
    const deltaBuf = buildDeltaBuffer({
      rows: 1,
      cols: 1,
      startRow: 1,
      startCol: 0,
      cells: [{ display: 'DELTA_STRING', flags: ValueType.Text, numberValue: 0 }],
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    vb.applyDelta(deltaBuf, 0, 0, 2, 1);

    const accessor = vb.createAccessor();

    // Existing cell string should still be readable
    expect(accessor.moveTo(0, 0)).toBe(true);
    expect(accessor.displayText).toBe('EXISTING_STRING_DATA');

    // Delta cell string should be readable (rebased offset)
    expect(accessor.moveTo(1, 0)).toBe(true);
    expect(accessor.displayText).toBe('DELTA_STRING');
  });

  it('should append delta format palette entries', () => {
    // Existing buffer with 2 palette entries
    const existingBuf = buildTestViewportBuffer({
      rows: 1,
      cols: 1,
      startRow: 0,
      startCol: 0,
      cells: [{ display: '42', flags: ValueType.Number, numberValue: 42, formatIdx: 1 }],
      palette: [{}, { bold: true }],
    });

    // Delta with 1 new palette entry (start_index=2)
    const deltaBuf = buildDeltaBuffer({
      rows: 1,
      cols: 1,
      startRow: 1,
      startCol: 0,
      cells: [{ display: 'italic', flags: ValueType.Text, numberValue: 0, formatIdx: 2 }],
      palette: [{ italic: true }],
      paletteStartIndex: 2,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    vb.applyDelta(deltaBuf, 0, 0, 2, 1);

    const accessor = vb.createAccessor();

    // Existing cell should still use format index 1 (bold)
    expect(accessor.moveTo(0, 0)).toBe(true);
    const fmt0 = accessor.format;
    expect(fmt0.bold).toBe(true);

    // Delta cell should use format index 2 (italic)
    expect(accessor.moveTo(1, 0)).toBe(true);
    const fmt1 = accessor.format;
    expect(fmt1.italic).toBe(true);
  });

  it('should preserve cells from old buffer in overlap region', () => {
    // Existing: rows 0..10, cols 0..4
    const existingCells: TestCell[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 4; c++) {
        existingCells.push({
          display: `old-${r}-${c}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const existingBuf = buildTestViewportBuffer({
      rows: 10,
      cols: 4,
      startRow: 0,
      startCol: 0,
      cells: existingCells,
      palette: [{}],
    });

    // Delta: rows 10..15, cols 0..4 (scroll down past existing)
    const deltaCells: TestCell[] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 4; c++) {
        deltaCells.push({
          display: `new-${r + 10}-${c}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const deltaBuf = buildDeltaBuffer({
      rows: 5,
      cols: 4,
      startRow: 10,
      startCol: 0,
      cells: deltaCells,
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    // New prefetch bounds: rows 3..15, cols 0..4
    vb.applyDelta(deltaBuf, 3, 0, 15, 4);

    const accessor = vb.createAccessor();

    // Cells from old buffer within new bounds should be preserved
    expect(accessor.moveTo(3, 0)).toBe(true);
    expect(accessor.displayText).toBe('old-3-0');

    expect(accessor.moveTo(9, 3)).toBe(true);
    expect(accessor.displayText).toBe('old-9-3');

    // Delta cells should be placed correctly
    expect(accessor.moveTo(10, 0)).toBe(true);
    expect(accessor.displayText).toBe('new-10-0');

    expect(accessor.moveTo(14, 3)).toBe(true);
    expect(accessor.displayText).toBe('new-14-3');

    // Cells outside old buffer and not in delta (rows 0..3) should not be accessible
    expect(accessor.moveTo(0, 0)).toBe(false);
    expect(accessor.moveTo(2, 0)).toBe(false);
  });

  it('should handle error strings in delta cells', () => {
    const existingBuf = buildTestViewportBuffer({
      rows: 1,
      cols: 1,
      startRow: 0,
      startCol: 0,
      cells: [{ display: 'ok', flags: ValueType.Text, numberValue: 0 }],
      palette: [{}],
    });

    const deltaBuf = buildDeltaBuffer({
      rows: 1,
      cols: 1,
      startRow: 1,
      startCol: 0,
      cells: [{ error: '#DIV/0!', flags: ValueType.Error, numberValue: NaN }],
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    vb.applyDelta(deltaBuf, 0, 0, 2, 1);

    const accessor = vb.createAccessor();

    // Existing cell
    expect(accessor.moveTo(0, 0)).toBe(true);
    expect(accessor.displayText).toBe('ok');

    // Delta error cell
    expect(accessor.moveTo(1, 0)).toBe(true);
    expect(accessor.valueType).toBe(ValueType.Error);
    expect(accessor.errorText).toBe('#DIV/0!');
  });

  it('should handle applyDelta with no existing buffer (fallback to setBuffer)', () => {
    const deltaBuf = buildDeltaBuffer({
      rows: 2,
      cols: 2,
      startRow: 0,
      startCol: 0,
      cells: [
        { display: 'a', flags: ValueType.Text, numberValue: 0 },
        { display: 'b', flags: ValueType.Text, numberValue: 0 },
        { display: 'c', flags: ValueType.Text, numberValue: 0 },
        { display: 'd', flags: ValueType.Text, numberValue: 0 },
      ],
      palette: [{}],
    });

    const vb = new BinaryViewportBuffer();
    // No existing buffer — applyDelta should just set the buffer
    vb.applyDelta(deltaBuf, 0, 0, 2, 2);

    expect(vb.hasBuffer()).toBe(true);
    expect(vb.getRows()).toBe(2);
    expect(vb.getCols()).toBe(2);

    const accessor = vb.createAccessor();
    expect(accessor.moveTo(0, 0)).toBe(true);
    expect(accessor.displayText).toBe('a');
  });

  it('should merge row and column dimensions from both buffers', () => {
    const existingBuf = buildTestViewportBuffer({
      rows: 3,
      cols: 2,
      startRow: 0,
      startCol: 0,
      cells: [],
      palette: [{}],
      rowDimensions: [
        { row: 0, height: 20 },
        { row: 1, height: 25 },
        { row: 2, height: 30 },
      ],
      colDimensions: [
        { col: 0, width: 100 },
        { col: 1, width: 150 },
      ],
    });

    const deltaBuf = buildDeltaBuffer({
      rows: 2,
      cols: 2,
      startRow: 3,
      startCol: 0,
      cells: [],
      palette: [],
      paletteStartIndex: 1,
      rowDimensions: [
        { row: 3, height: 35 },
        { row: 4, height: 40 },
      ],
      colDimensions: [
        { col: 0, width: 100 },
        { col: 1, width: 150 },
      ],
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    vb.applyDelta(deltaBuf, 0, 0, 5, 2);

    const rowDims = vb.getRowDimensions();
    const colDims = vb.getColDimensions();

    // Should have rows 0..4
    expect(rowDims.length).toBe(5);
    expect(rowDims[0].row).toBe(0);
    expect(rowDims[0].height).toBeCloseTo(20, 0);
    expect(rowDims[3].row).toBe(3);
    expect(rowDims[3].height).toBeCloseTo(35, 0);
    expect(rowDims[4].row).toBe(4);
    expect(rowDims[4].height).toBeCloseTo(40, 0);

    // Should have cols 0..1
    expect(colDims.length).toBe(2);
  });

  it('should handle scroll-left delta correctly', () => {
    // Existing: rows 0..3, cols 5..10
    const existingCells: TestCell[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        existingCells.push({
          display: `E-${r}-${c + 5}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const existingBuf = buildTestViewportBuffer({
      rows: 3,
      cols: 5,
      startRow: 0,
      startCol: 5,
      cells: existingCells,
      palette: [{}],
    });

    // Delta: rows 0..3, cols 2..5 (scroll left)
    const deltaCells: TestCell[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        deltaCells.push({
          display: `D-${r}-${c + 2}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const deltaBuf = buildDeltaBuffer({
      rows: 3,
      cols: 3,
      startRow: 0,
      startCol: 2,
      cells: deltaCells,
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    // New prefetch: rows 0..3, cols 2..10
    vb.applyDelta(deltaBuf, 0, 2, 3, 10);

    const accessor = vb.createAccessor();

    // Delta cells (new left strip)
    expect(accessor.moveTo(0, 2)).toBe(true);
    expect(accessor.displayText).toBe('D-0-2');

    expect(accessor.moveTo(2, 4)).toBe(true);
    expect(accessor.displayText).toBe('D-2-4');

    // Existing cells (right side)
    expect(accessor.moveTo(0, 5)).toBe(true);
    expect(accessor.displayText).toBe('E-0-5');

    expect(accessor.moveTo(2, 9)).toBe(true);
    expect(accessor.displayText).toBe('E-2-9');
  });

  it('should handle scroll-right delta correctly', () => {
    // Existing: rows 0..3, cols 0..5
    const existingCells: TestCell[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        existingCells.push({
          display: `E-${r}-${c}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const existingBuf = buildTestViewportBuffer({
      rows: 3,
      cols: 5,
      startRow: 0,
      startCol: 0,
      cells: existingCells,
      palette: [{}],
    });

    // Delta: rows 0..3, cols 5..8 (scroll right)
    const deltaCells: TestCell[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        deltaCells.push({
          display: `D-${r}-${c + 5}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const deltaBuf = buildDeltaBuffer({
      rows: 3,
      cols: 3,
      startRow: 0,
      startCol: 5,
      cells: deltaCells,
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    // New prefetch: rows 0..3, cols 0..8
    vb.applyDelta(deltaBuf, 0, 0, 3, 8);

    const accessor = vb.createAccessor();

    // Existing cells (left side)
    expect(accessor.moveTo(0, 0)).toBe(true);
    expect(accessor.displayText).toBe('E-0-0');
    expect(accessor.moveTo(2, 4)).toBe(true);
    expect(accessor.displayText).toBe('E-2-4');

    // Delta cells (new right strip)
    expect(accessor.moveTo(0, 5)).toBe(true);
    expect(accessor.displayText).toBe('D-0-5');
    expect(accessor.moveTo(2, 7)).toBe(true);
    expect(accessor.displayText).toBe('D-2-7');
  });

  it('should handle diagonal scroll delta (scroll down-right)', () => {
    // Existing: rows 0..4, cols 0..4
    const existingCells: TestCell[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        existingCells.push({
          display: `E-${r}-${c}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const existingBuf = buildTestViewportBuffer({
      rows: 4,
      cols: 4,
      startRow: 0,
      startCol: 0,
      cells: existingCells,
      palette: [{}],
    });

    // Delta covers the full new region (diagonal fallback sends full bounds)
    // New prefetch: rows 2..6, cols 2..6
    const deltaCells: TestCell[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        deltaCells.push({
          display: `D-${r + 2}-${c + 2}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const deltaBuf = buildDeltaBuffer({
      rows: 4,
      cols: 4,
      startRow: 2,
      startCol: 2,
      cells: deltaCells,
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    vb.applyDelta(deltaBuf, 2, 2, 6, 6);

    const accessor = vb.createAccessor();

    // Overlap region (rows 2-3, cols 2-3): delta cells take priority
    expect(accessor.moveTo(2, 2)).toBe(true);
    expect(accessor.displayText).toBe('D-2-2');
    expect(accessor.moveTo(3, 3)).toBe(true);
    expect(accessor.displayText).toBe('D-3-3');

    // New rows from delta
    expect(accessor.moveTo(5, 5)).toBe(true);
    expect(accessor.displayText).toBe('D-5-5');

    // Old cells outside new bounds should not be accessible
    expect(accessor.moveTo(0, 0)).toBe(false);
    expect(accessor.moveTo(1, 1)).toBe(false);
  });

  it('should handle delta cells overwriting existing cells in overlap region', () => {
    // Existing: rows 0..4, cols 0..3
    const existingCells: TestCell[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        existingCells.push({
          display: `old-${r}-${c}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const existingBuf = buildTestViewportBuffer({
      rows: 4,
      cols: 3,
      startRow: 0,
      startCol: 0,
      cells: existingCells,
      palette: [{}],
    });

    // Delta covers rows 2..6, cols 0..3 — rows 2-3 overlap with existing
    const deltaCells: TestCell[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        deltaCells.push({
          display: `new-${r + 2}-${c}`,
          flags: ValueType.Number | (1 << 3), // has_formula flag set
          numberValue: (r + 2) * 100 + c,
        });
      }
    }

    const deltaBuf = buildDeltaBuffer({
      rows: 4,
      cols: 3,
      startRow: 2,
      startCol: 0,
      cells: deltaCells,
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    // New prefetch: rows 0..6, cols 0..3
    vb.applyDelta(deltaBuf, 0, 0, 6, 3);

    const accessor = vb.createAccessor();

    // Non-overlapping old cells preserved
    expect(accessor.moveTo(0, 0)).toBe(true);
    expect(accessor.displayText).toBe('old-0-0');
    expect(accessor.moveTo(1, 2)).toBe(true);
    expect(accessor.displayText).toBe('old-1-2');

    // Overlap region: delta cells should win over old cells
    expect(accessor.moveTo(2, 0)).toBe(true);
    expect(accessor.displayText).toBe('new-2-0');
    expect(accessor.hasFormula).toBe(true);
    expect(accessor.numberValue).toBe(200);

    expect(accessor.moveTo(3, 1)).toBe(true);
    expect(accessor.displayText).toBe('new-3-1');
    expect(accessor.hasFormula).toBe(true);

    // New rows from delta
    expect(accessor.moveTo(5, 2)).toBe(true);
    expect(accessor.displayText).toBe('new-5-2');
  });

  it('should handle empty/null cells in delta', () => {
    // Existing: rows 0..2, cols 0..2 with text
    const existingCells: TestCell[] = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        existingCells.push({
          display: `val-${r}-${c}`,
          flags: ValueType.Text,
          numberValue: 0,
        });
      }
    }

    const existingBuf = buildTestViewportBuffer({
      rows: 2,
      cols: 2,
      startRow: 0,
      startCol: 0,
      cells: existingCells,
      palette: [{}],
    });

    // Delta: rows 2..4, cols 0..2 — mix of null and text cells
    const deltaCells: TestCell[] = [
      // (2,0): null cell — no display, no error
      { flags: ValueType.Null, numberValue: NaN },
      // (2,1): text cell
      { display: 'hello', flags: ValueType.Text, numberValue: 0 },
      // (3,0): text cell
      { display: 'world', flags: ValueType.Text, numberValue: 0 },
      // (3,1): null cell
      { flags: ValueType.Null, numberValue: NaN },
    ];

    const deltaBuf = buildDeltaBuffer({
      rows: 2,
      cols: 2,
      startRow: 2,
      startCol: 0,
      cells: deltaCells,
      palette: [],
      paletteStartIndex: 1,
    });

    const vb = new BinaryViewportBuffer();
    vb.setBuffer(existingBuf);
    vb.applyDelta(deltaBuf, 0, 0, 4, 2);

    const accessor = vb.createAccessor();

    // Existing cells preserved
    expect(accessor.moveTo(0, 0)).toBe(true);
    expect(accessor.displayText).toBe('val-0-0');

    // Null delta cell — should have Null value type and no display text
    expect(accessor.moveTo(2, 0)).toBe(true);
    expect(accessor.valueType).toBe(ValueType.Null);
    expect(accessor.displayText).toBeNull();

    // Text delta cell
    expect(accessor.moveTo(2, 1)).toBe(true);
    expect(accessor.valueType).toBe(ValueType.Text);
    expect(accessor.displayText).toBe('hello');

    // Another text cell
    expect(accessor.moveTo(3, 0)).toBe(true);
    expect(accessor.displayText).toBe('world');

    // Another null cell
    expect(accessor.moveTo(3, 1)).toBe(true);
    expect(accessor.valueType).toBe(ValueType.Null);
    expect(accessor.displayText).toBeNull();
  });
});

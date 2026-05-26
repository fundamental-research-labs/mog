/**
 * BinaryViewportBuffer.applyBinaryMutation() tests.
 *
 * Covers the binary mutation patching path: viewport buffer is loaded with
 * initial data, then a binary mutation is applied via BinaryMutationReader,
 * and the buffer reflects the updates correctly via CellAccessor.
 *
 * Test categories:
 *   1. Basic numeric patch
 *   2. Display text rebase to overflow pool
 *   3. Error text rebase
 *   4. Flags update
 *   5. Format index update
 *   6. Out-of-viewport patch is skipped
 *   7. String cache invalidation
 *   8. Spill patches applied correctly
 *   9. Multiple patches in one mutation
 *  10. Clearing display text (NO_STRING for display)
 */

// Polyfill window for Node test environment (devtools reporting uses `window`)
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {};
}

import { BinaryMutationReader } from '../binary-mutation-reader';
import { BinaryViewportBuffer, CellAccessor, ValueType } from '../binary-viewport-buffer';
import {
  HAS_FORMULA,
  VALUE_TYPE_ERROR,
  VALUE_TYPE_NUMBER,
  VALUE_TYPE_TEXT,
} from '../constants.gen';
import type { TestMutationOptions } from '../mutation-test-builder';
import { buildTestMutationBuffer } from '../mutation-test-builder';
import type { TestViewportOptions } from '../viewport-test-builder';
import { buildTestViewportBuffer } from '../viewport-test-builder';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function setupViewportAndMutate(
  viewportOpts: TestViewportOptions,
  mutationOpts: TestMutationOptions,
): { vb: BinaryViewportBuffer; accessor: CellAccessor } {
  const vb = new BinaryViewportBuffer();
  vb.setBuffer(buildTestViewportBuffer(viewportOpts));
  const reader = new BinaryMutationReader(buildTestMutationBuffer(mutationOpts));
  vb.applyBinaryMutation(reader);
  const accessor = new CellAccessor(vb);
  return { vb, accessor };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BinaryViewportBuffer.applyBinaryMutation', () => {
  // -----------------------------------------------------------------------
  // 1. Basic numeric patch
  // -----------------------------------------------------------------------

  describe('basic numeric patch', () => {
    it('updates numberValue and displayText at (0,0)', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 3,
          cols: 3,
          cells: [
            { numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER },
            // remaining cells empty
          ],
        },
        {
          patches: [{ row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER }],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.numberValue).toBe(100);
      expect(accessor.displayText).toBe('100');
    });

    it('leaves cell at (0,1) unchanged', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 3,
          cols: 3,
          cells: [
            { numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER },
            { numberValue: 7, display: '7', flags: VALUE_TYPE_NUMBER },
          ],
        },
        {
          patches: [{ row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER }],
        },
      );

      expect(accessor.moveTo(0, 1)).toBe(true);
      expect(accessor.numberValue).toBe(7);
      expect(accessor.displayText).toBe('7');
    });
  });

  // -----------------------------------------------------------------------
  // 2. Display text rebase to overflow pool
  // -----------------------------------------------------------------------

  describe('display text rebase to overflow pool', () => {
    it('reads new longer display text through overflow pool', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 1,
          cols: 1,
          cells: [{ display: 'old', flags: VALUE_TYPE_TEXT }],
        },
        {
          patches: [{ row: 0, col: 0, display: 'new-longer-text', flags: VALUE_TYPE_TEXT }],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.displayText).toBe('new-longer-text');
    });
  });

  // -----------------------------------------------------------------------
  // 3. Error text rebase
  // -----------------------------------------------------------------------

  describe('error text rebase', () => {
    it('reads error text after mutation adds an error', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER }],
        },
        {
          patches: [{ row: 0, col: 0, error: '#DIV/0!', flags: VALUE_TYPE_ERROR }],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.errorText).toBe('#DIV/0!');
      expect(accessor.valueType).toBe(ValueType.Error);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Flags update
  // -----------------------------------------------------------------------

  describe('flags update', () => {
    it('updates flags to include HAS_FORMULA', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 5, display: '5', flags: VALUE_TYPE_NUMBER }],
        },
        {
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 5,
              display: '5',
              flags: VALUE_TYPE_NUMBER | HAS_FORMULA,
            },
          ],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.hasFormula).toBe(true);
      expect(accessor.valueType).toBe(ValueType.Number);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Format index update
  // -----------------------------------------------------------------------

  describe('format index update', () => {
    it('updates formatIdx from 0 to 5', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 }],
        },
        {
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 5,
            },
          ],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.formatIdx).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Out-of-viewport patch is skipped
  // -----------------------------------------------------------------------

  describe('out-of-viewport patch is skipped', () => {
    it('does not crash and leaves viewport cells unchanged', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 3,
          cols: 3,
          startRow: 0,
          startCol: 0,
          cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
        },
        {
          patches: [
            { row: 100, col: 100, numberValue: 999, display: '999', flags: VALUE_TYPE_NUMBER },
          ],
        },
      );

      // Original cell unchanged
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.numberValue).toBe(1);
      expect(accessor.displayText).toBe('1');
    });
  });

  // -----------------------------------------------------------------------
  // 7. String cache invalidation
  // -----------------------------------------------------------------------

  describe('string cache invalidation', () => {
    it('returns new display text after mutation replaces cached value', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells: [{ display: 'cached', flags: VALUE_TYPE_TEXT }],
        }),
      );

      // Read display text to populate the cache
      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.displayText).toBe('cached');

      // Apply mutation with new display text
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [{ row: 0, col: 0, display: 'fresh', flags: VALUE_TYPE_TEXT }],
        }),
      );
      vb.applyBinaryMutation(reader);

      // Re-read: should see the new value, not the cached one
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.displayText).toBe('fresh');
    });
  });

  // -----------------------------------------------------------------------
  // 8. Spill patches applied correctly
  // -----------------------------------------------------------------------

  describe('spill patches applied correctly', () => {
    it('applies both regular and spill patches', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 5,
          cols: 5,
        },
        {
          patches: [{ row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER }],
          spillPatches: [
            { row: 1, col: 0, numberValue: 20, display: '20', flags: VALUE_TYPE_NUMBER },
          ],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.numberValue).toBe(10);
      expect(accessor.displayText).toBe('10');

      expect(accessor.moveTo(1, 0)).toBe(true);
      expect(accessor.numberValue).toBe(20);
      expect(accessor.displayText).toBe('20');
    });
  });

  // -----------------------------------------------------------------------
  // 9. Multiple patches in one mutation
  // -----------------------------------------------------------------------

  describe('multiple patches in one mutation', () => {
    it('updates all 3 cells in a single mutation', () => {
      // 3x3 viewport, populate first 3 cells (row-major: (0,0), (0,1), (0,2))
      const cells = [
        { numberValue: 1, display: 'A', flags: VALUE_TYPE_NUMBER },
        { numberValue: 2, display: 'B', flags: VALUE_TYPE_NUMBER },
        { numberValue: 3, display: 'C', flags: VALUE_TYPE_NUMBER },
      ];

      const { accessor } = setupViewportAndMutate(
        { rows: 3, cols: 3, cells },
        {
          patches: [
            { row: 0, col: 0, numberValue: 10, display: 'X', flags: VALUE_TYPE_NUMBER },
            { row: 0, col: 1, numberValue: 20, display: 'Y', flags: VALUE_TYPE_NUMBER },
            { row: 0, col: 2, numberValue: 30, display: 'Z', flags: VALUE_TYPE_NUMBER },
          ],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.numberValue).toBe(10);
      expect(accessor.displayText).toBe('X');

      expect(accessor.moveTo(0, 1)).toBe(true);
      expect(accessor.numberValue).toBe(20);
      expect(accessor.displayText).toBe('Y');

      expect(accessor.moveTo(0, 2)).toBe(true);
      expect(accessor.numberValue).toBe(30);
      expect(accessor.displayText).toBe('Z');
    });
  });

  // -----------------------------------------------------------------------
  // 10. Clearing display text (mutation patch has NO_STRING for display)
  // -----------------------------------------------------------------------

  describe('clearing display text', () => {
    it('returns null for display text when mutation patch has no display', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 1,
          cols: 1,
          cells: [{ display: 'hello', flags: VALUE_TYPE_TEXT }],
        },
        {
          // Patch with no display field => builder writes NO_STRING for display_off
          patches: [{ row: 0, col: 0, flags: 0 }],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.displayText).toBeNull();
    });
  });

  // =======================================================================
  // FORMAT MUTATION INTEGRATION TESTS
  //
  // These tests exercise the full format mutation pipeline:
  //   viewport buffer (with palette) → mutation (with palette delta + formatIdx)
  //   → applyBinaryMutation → CellAccessor.format resolution
  //
  // This is the exact path that runs when a user toggles bold/italic/etc.
  // in the spreadsheet UI.
  // =======================================================================

  // -----------------------------------------------------------------------
  // 11. Format mutation with palette delta — the bold toggle scenario
  // -----------------------------------------------------------------------

  describe('format mutation with palette delta (bold toggle)', () => {
    it('applies palette delta and resolves accessor.format with bold=true', () => {
      // Initial state: cell A1 has value "1", formatIdx=0 pointing to empty format
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 3,
          cols: 3,
          cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 }],
          palette: [{}], // index 0 = empty format
          paletteStartIndex: 0,
        }),
      );

      // Verify initial state
      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.displayText).toBe('1');
      expect(accessor.formatIdx).toBe(0);
      expect(accessor.format).toEqual({});

      // Apply format mutation: bold toggle adds a new palette entry {bold: true}
      // and patches the cell's formatIdx from 0 to 1
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
          ],
          palette: { startIndex: 1, formats: [{ bold: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      // After mutation: cell should have bold format and preserved display text
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.displayText).toBe('1');
      expect(accessor.numberValue).toBe(1);
      expect(accessor.formatIdx).toBe(1);
      expect(accessor.format).toEqual({ bold: true });
    });

    it('preserves existing palette entries when merging delta', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 2,
          cols: 1,
          cells: [
            { numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 },
            { numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER, formatIdx: 1 },
          ],
          palette: [{}, { italic: true }],
          paletteStartIndex: 0,
        }),
      );

      // Verify initial formats
      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.format).toEqual({});
      expect(accessor.moveTo(1, 0)).toBe(true);
      expect(accessor.format).toEqual({ italic: true });

      // Mutation adds bold+italic as palette entry 2, updates cell (0,0)
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 2,
            },
          ],
          palette: { startIndex: 2, formats: [{ bold: true, italic: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      // Cell (0,0) now uses new palette entry
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.formatIdx).toBe(2);
      expect(accessor.format).toEqual({ bold: true, italic: true });

      // Cell (1,0) still uses original palette entry
      expect(accessor.moveTo(1, 0)).toBe(true);
      expect(accessor.formatIdx).toBe(1);
      expect(accessor.format).toEqual({ italic: true });
    });
  });

  // -----------------------------------------------------------------------
  // 12. Format-only mutation preserves display text and value
  // -----------------------------------------------------------------------

  describe('format-only mutation preserves cell data', () => {
    it('keeps display text and number value unchanged when only formatIdx changes', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 42.5, display: '42.50', flags: VALUE_TYPE_NUMBER, formatIdx: 0 }],
          palette: [{ numberFormat: '0.00' }],
          paletteStartIndex: 0,
        }),
      );

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.numberValue).toBe(42.5);
      expect(accessor.displayText).toBe('42.50');

      // Bold mutation: same value, same display, new format
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 42.5,
              display: '42.50',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
          ],
          palette: { startIndex: 1, formats: [{ numberFormat: '0.00', bold: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.numberValue).toBe(42.5);
      expect(accessor.displayText).toBe('42.50');
      expect(accessor.format).toEqual({ numberFormat: '0.00', bold: true });
    });
  });

  // -----------------------------------------------------------------------
  // 13. Multi-cell format mutation with shared palette delta
  // -----------------------------------------------------------------------

  describe('multi-cell format mutation with shared palette delta', () => {
    it('applies same palette entry to multiple cells', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 3,
          cols: 1,
          cells: [
            { numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 },
            { numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER, formatIdx: 0 },
            { numberValue: 3, display: '3', flags: VALUE_TYPE_NUMBER, formatIdx: 0 },
          ],
          palette: [{}],
          paletteStartIndex: 0,
        }),
      );

      // Bold all three cells — all get formatIdx 1, palette adds one entry
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
            {
              row: 1,
              col: 0,
              numberValue: 2,
              display: '2',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
            {
              row: 2,
              col: 0,
              numberValue: 3,
              display: '3',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
          ],
          palette: { startIndex: 1, formats: [{ bold: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      const accessor = new CellAccessor(vb);
      for (let row = 0; row < 3; row++) {
        expect(accessor.moveTo(row, 0)).toBe(true);
        expect(accessor.displayText).toBe(String(row + 1));
        expect(accessor.formatIdx).toBe(1);
        expect(accessor.format).toEqual({ bold: true });
      }
    });

    it('applies different palette entries to different cells', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 2,
          cols: 1,
          cells: [
            { numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 },
            { numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER, formatIdx: 0 },
          ],
          palette: [{}],
          paletteStartIndex: 0,
        }),
      );

      // Cell 0 gets bold, cell 1 gets italic — two new palette entries
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
            {
              row: 1,
              col: 0,
              numberValue: 2,
              display: '2',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 2,
            },
          ],
          palette: { startIndex: 1, formats: [{ bold: true }, { italic: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.format).toEqual({ bold: true });
      expect(accessor.moveTo(1, 0)).toBe(true);
      expect(accessor.format).toEqual({ italic: true });
    });
  });

  // -----------------------------------------------------------------------
  // 14. Color override mutations
  // -----------------------------------------------------------------------

  describe('color override mutations', () => {
    it('applies bgColorOverride and fontColorOverride', () => {
      const { accessor } = setupViewportAndMutate(
        {
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
        },
        {
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              bgColorOverride: 0xff0000ff, // red RGBA
              fontColorOverride: 0x00ff00ff, // green RGBA
            },
          ],
        },
      );

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.getBgColorOverride()).not.toBeNull();
      expect(accessor.getFontColorOverride()).not.toBeNull();
    });

    it('clears color overrides when mutation sets them to zero', () => {
      // Start with color overrides
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells: [
            {
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              bgColorOverride: 0xff0000ff,
              fontColorOverride: 0x00ff00ff,
            },
          ],
        }),
      );

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.getBgColorOverride()).not.toBeNull();

      // Mutation clears overrides
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              bgColorOverride: 0,
              fontColorOverride: 0,
            },
          ],
        }),
      );
      vb.applyBinaryMutation(reader);

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.getBgColorOverride()).toBeNull();
      expect(accessor.getFontColorOverride()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 15. Sequential format mutations (multiple mutations to same cell)
  // -----------------------------------------------------------------------

  describe('sequential format mutations', () => {
    it('applies bold then italic via two separate mutations', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 }],
          palette: [{}],
          paletteStartIndex: 0,
        }),
      );

      // First mutation: apply bold
      const reader1 = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
          ],
          palette: { startIndex: 1, formats: [{ bold: true }] },
        }),
      );
      vb.applyBinaryMutation(reader1);

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.format).toEqual({ bold: true });

      // Second mutation: apply bold + italic (combined format)
      const reader2 = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 2,
            },
          ],
          palette: { startIndex: 2, formats: [{ bold: true, italic: true }] },
        }),
      );
      vb.applyBinaryMutation(reader2);

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.formatIdx).toBe(2);
      expect(accessor.format).toEqual({ bold: true, italic: true });
    });
  });

  // -----------------------------------------------------------------------
  // 16. Format mutation with display text change (number format)
  // -----------------------------------------------------------------------

  describe('format mutation with display text change', () => {
    it('updates both format and display text when number format changes', () => {
      // Cell has value 0.5 displayed as "0.5" with no format
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 0.5, display: '0.5', flags: VALUE_TYPE_NUMBER, formatIdx: 0 }],
          palette: [{}],
          paletteStartIndex: 0,
        }),
      );

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.displayText).toBe('0.5');

      // Apply percentage format: display changes to "50%", format changes
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 0.5,
              display: '50%',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
          ],
          palette: { startIndex: 1, formats: [{ numberFormat: '0%' }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.numberValue).toBe(0.5);
      expect(accessor.displayText).toBe('50%');
      expect(accessor.format).toEqual({ numberFormat: '0%' });
    });
  });

  // -----------------------------------------------------------------------
  // 17. Palette delta with no overlapping indices (gap in palette)
  // -----------------------------------------------------------------------

  describe('palette delta with gap', () => {
    it('handles palette delta starting beyond current palette end', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 }],
          palette: [{}],
          paletteStartIndex: 0,
        }),
      );

      // Palette delta indices are absolute global indices. When a stale
      // viewport receives a delta starting beyond its current palette end,
      // missing slots are filled with empty placeholders so later formatIdx
      // lookups still resolve against the global index space.
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 3,
            },
          ],
          palette: { startIndex: 3, formats: [{ bold: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.formatIdx).toBe(3);
      expect(vb.getFormatByIndex(1)).toEqual({});
      expect(vb.getFormatByIndex(2)).toEqual({});
      expect(vb.getFormatByIndex(3)).toEqual({ bold: true });
      expect(accessor.format).toEqual({ bold: true });
    });
  });

  // -----------------------------------------------------------------------
  // 18. Mutation with palette delta but no cell patches
  // -----------------------------------------------------------------------

  describe('mutation with palette delta but no patches', () => {
    it('appends palette entries even when no cells are patched', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 1,
          cols: 1,
          cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER, formatIdx: 0 }],
          palette: [{}],
          paletteStartIndex: 0,
        }),
      );

      // Mutation adds palette entry but patches no cells
      // (e.g., format was applied to a cell outside viewport)
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [],
          palette: { startIndex: 1, formats: [{ bold: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      // Palette should be extended, so a subsequent mutation using formatIdx=1 works
      const reader2 = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 0,
              col: 0,
              numberValue: 1,
              display: '1',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
          ],
        }),
      );
      vb.applyBinaryMutation(reader2);

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(0, 0)).toBe(true);
      expect(accessor.format).toEqual({ bold: true });
    });
  });

  // -----------------------------------------------------------------------
  // 19. Format mutation on offset viewport (startRow/startCol != 0)
  // -----------------------------------------------------------------------

  describe('format mutation on offset viewport', () => {
    it('correctly patches cells when viewport starts at non-zero offset', () => {
      const vb = new BinaryViewportBuffer();
      vb.setBuffer(
        buildTestViewportBuffer({
          rows: 3,
          cols: 3,
          startRow: 10,
          startCol: 5,
          cells: [
            { numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER, formatIdx: 0 },
            // remaining 8 cells empty
          ],
          palette: [{}],
          paletteStartIndex: 0,
        }),
      );

      // Mutation targets cell at absolute position (10, 5) — first cell in viewport
      const reader = new BinaryMutationReader(
        buildTestMutationBuffer({
          patches: [
            {
              row: 10,
              col: 5,
              numberValue: 100,
              display: '100',
              flags: VALUE_TYPE_NUMBER,
              formatIdx: 1,
            },
          ],
          palette: { startIndex: 1, formats: [{ bold: true }] },
        }),
      );
      vb.applyBinaryMutation(reader);

      const accessor = new CellAccessor(vb);
      expect(accessor.moveTo(10, 5)).toBe(true);
      expect(accessor.displayText).toBe('100');
      expect(accessor.format).toEqual({ bold: true });
    });
  });
});

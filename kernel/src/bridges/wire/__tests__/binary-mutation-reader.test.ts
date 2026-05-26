/**
 * BinaryMutationReader + buildTestMutationBuffer tests.
 *
 * Covers:
 *   - Header parsing (patchCount, generation, sheetId, flags)
 *   - Cell patch decoding (row, col, recordOffset, displayText, errorText)
 *   - Spill patch decoding (spillPatchCount, row, col, displayText, errorText)
 *   - Edge cases (empty mutation, unicode, large patch count, NO_STRING sentinel)
 *   - Number value and flags via patchRecordOffset
 */

import { BinaryMutationReader } from '../binary-mutation-reader';
import type { TestMutationPatch } from '../mutation-test-builder';
import { buildTestMutationBuffer } from '../mutation-test-builder';

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

describe('BinaryMutationReader', () => {
  describe('header parsing', () => {
    it('patchCount returns correct count', () => {
      const buf = buildTestMutationBuffer({
        patches: [
          { row: 0, col: 0, display: 'a' },
          { row: 1, col: 1, display: 'b' },
          { row: 2, col: 2, display: 'c' },
        ],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.patchCount).toBe(3);
    });

    it('generation returns correct generation counter', () => {
      const buf = buildTestMutationBuffer({ generation: 42 });
      const reader = new BinaryMutationReader(buf);
      expect(reader.generation).toBe(42);
    });

    it('generation defaults to 0', () => {
      const buf = buildTestMutationBuffer({});
      const reader = new BinaryMutationReader(buf);
      expect(reader.generation).toBe(0);
    });

    it('sheetId() decodes UTF-8 sheet ID correctly', () => {
      const buf = buildTestMutationBuffer({ sheetId: 'my-sheet-42' });
      const reader = new BinaryMutationReader(buf);
      expect(reader.sheetId()).toBe('my-sheet-42');
    });

    it('sheetId() decodes default sheet ID', () => {
      const buf = buildTestMutationBuffer({});
      const reader = new BinaryMutationReader(buf);
      expect(reader.sheetId()).toBe('sheet-1');
    });

    it('hasErrors reflects flag bit 1', () => {
      const buf = buildTestMutationBuffer({ hasErrors: true });
      const reader = new BinaryMutationReader(buf);
      expect(reader.hasErrors).toBe(true);
    });

    it('hasProjectionChanges reflects flag bit 0', () => {
      const buf = buildTestMutationBuffer({
        spillPatches: [{ row: 0, col: 0, display: 'spill' }],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.hasProjectionChanges).toBe(true);
    });

    it('both flags false by default', () => {
      const buf = buildTestMutationBuffer({});
      const reader = new BinaryMutationReader(buf);
      expect(reader.hasErrors).toBe(false);
      expect(reader.hasProjectionChanges).toBe(false);
    });

    it('both flags true simultaneously', () => {
      const buf = buildTestMutationBuffer({
        hasErrors: true,
        spillPatches: [{ row: 0, col: 0, display: 'spill' }],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.hasErrors).toBe(true);
      expect(reader.hasProjectionChanges).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Cell patch decoding
  // -----------------------------------------------------------------------

  describe('cell patch decoding', () => {
    it('patchRow(i) / patchCol(i) return correct row/col for each patch', () => {
      const buf = buildTestMutationBuffer({
        patches: [
          { row: 10, col: 5, display: 'a' },
          { row: 200, col: 30, display: 'b' },
          { row: 0, col: 0, display: 'c' },
        ],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchRow(0)).toBe(10);
      expect(reader.patchCol(0)).toBe(5);
      expect(reader.patchRow(1)).toBe(200);
      expect(reader.patchCol(1)).toBe(30);
      expect(reader.patchRow(2)).toBe(0);
      expect(reader.patchCol(2)).toBe(0);
    });

    it('patchRecordOffset(i) returns correct absolute byte offset', () => {
      const buf = buildTestMutationBuffer({
        sheetId: 'test',
        patches: [
          { row: 0, col: 0 },
          { row: 1, col: 1 },
        ],
      });
      const reader = new BinaryMutationReader(buf);

      // Header = 16 bytes, sheetId "test" = 4 bytes, patches start at 20
      // Patch 0: offset 20, record starts at 20 + 8 = 28
      // Patch 1: offset 20 + 40, record starts at 60 + 8 = 68
      expect(reader.patchRecordOffset(0)).toBe(28);
      expect(reader.patchRecordOffset(1)).toBe(68);
    });

    it('patchDisplayText(i) decodes display string from string pool', () => {
      const buf = buildTestMutationBuffer({
        patches: [
          { row: 0, col: 0, display: 'Hello, World!' },
          { row: 1, col: 0, display: 'Goodbye' },
        ],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchDisplayText(0)).toBe('Hello, World!');
      expect(reader.patchDisplayText(1)).toBe('Goodbye');
    });

    it('patchErrorText(i) decodes error string from string pool', () => {
      const buf = buildTestMutationBuffer({
        patches: [
          { row: 0, col: 0, error: '#DIV/0!' },
          { row: 1, col: 0, error: '#REF!' },
        ],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchErrorText(0)).toBe('#DIV/0!');
      expect(reader.patchErrorText(1)).toBe('#REF!');
    });

    it('patch with both display AND error text', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: 'value', error: '#ERR' }],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchDisplayText(0)).toBe('value');
      expect(reader.patchErrorText(0)).toBe('#ERR');
    });

    it('patch with display text only (no error)', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: 'hello' }],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchDisplayText(0)).toBe('hello');
      expect(reader.patchErrorText(0)).toBeNull();
    });

    it('patch with error text only (no display)', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, error: '#N/A' }],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchDisplayText(0)).toBeNull();
      expect(reader.patchErrorText(0)).toBe('#N/A');
    });

    it('patch with neither display nor error (both return null)', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 42 }],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchDisplayText(0)).toBeNull();
      expect(reader.patchErrorText(0)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Spill patch decoding
  // -----------------------------------------------------------------------

  describe('spill patch decoding', () => {
    it('spillPatchCount returns correct count when spill section present', () => {
      const buf = buildTestMutationBuffer({
        spillPatches: [
          { row: 0, col: 0, display: 'a' },
          { row: 1, col: 1, display: 'b' },
        ],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.spillPatchCount).toBe(2);
    });

    it('spillPatchCount returns 0 when no spill section', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: 'a' }],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.spillPatchCount).toBe(0);
    });

    it('spillPatchRow(i) / spillPatchCol(i) return correct positions', () => {
      const buf = buildTestMutationBuffer({
        spillPatches: [
          { row: 50, col: 10, display: 'x' },
          { row: 100, col: 20, display: 'y' },
        ],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.spillPatchRow(0)).toBe(50);
      expect(reader.spillPatchCol(0)).toBe(10);
      expect(reader.spillPatchRow(1)).toBe(100);
      expect(reader.spillPatchCol(1)).toBe(20);
    });

    it('spillPatchDisplayText(i) decodes from shared string pool', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: 'regular' }],
        spillPatches: [{ row: 1, col: 0, display: 'spill-value' }],
      });
      const reader = new BinaryMutationReader(buf);

      // Regular patch string still works
      expect(reader.patchDisplayText(0)).toBe('regular');
      // Spill patch string from same shared pool
      expect(reader.spillPatchDisplayText(0)).toBe('spill-value');
    });

    it('spillPatchErrorText(i) decodes from shared string pool', () => {
      const buf = buildTestMutationBuffer({
        spillPatches: [{ row: 0, col: 0, error: '#SPILL!' }],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.spillPatchErrorText(0)).toBe('#SPILL!');
    });

    it('spill patch with no display/error returns null', () => {
      const buf = buildTestMutationBuffer({
        spillPatches: [{ row: 0, col: 0, numberValue: 99 }],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.spillPatchDisplayText(0)).toBeNull();
      expect(reader.spillPatchErrorText(0)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('empty mutation (0 patches, 0 spill patches)', () => {
      const buf = buildTestMutationBuffer({ patches: [], spillPatches: [] });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchCount).toBe(0);
      expect(reader.spillPatchCount).toBe(0);
      expect(reader.hasProjectionChanges).toBe(false);
      expect(reader.hasErrors).toBe(false);
    });

    it('unicode strings in display text (emoji)', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: '🎉🚀💯' }],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.patchDisplayText(0)).toBe('🎉🚀💯');
    });

    it('unicode strings in display text (CJK)', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: '你好世界' }],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.patchDisplayText(0)).toBe('你好世界');
    });

    it('unicode strings in display text (multi-byte UTF-8)', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: 'price: ¥123 — €456' }],
      });
      const reader = new BinaryMutationReader(buf);
      expect(reader.patchDisplayText(0)).toBe('price: ¥123 — €456');
    });

    it('unicode sheet ID', () => {
      const buf = buildTestMutationBuffer({ sheetId: 'シート1' });
      const reader = new BinaryMutationReader(buf);
      expect(reader.sheetId()).toBe('シート1');
    });

    it('large patch count (100 patches) — verify last patch is correctly positioned', () => {
      const patches: TestMutationPatch[] = [];
      for (let i = 0; i < 100; i++) {
        patches.push({ row: i, col: i * 2, display: `cell-${i}` });
      }
      const buf = buildTestMutationBuffer({ patches });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchCount).toBe(100);

      // Verify first patch
      expect(reader.patchRow(0)).toBe(0);
      expect(reader.patchCol(0)).toBe(0);
      expect(reader.patchDisplayText(0)).toBe('cell-0');

      // Verify last patch
      expect(reader.patchRow(99)).toBe(99);
      expect(reader.patchCol(99)).toBe(198);
      expect(reader.patchDisplayText(99)).toBe('cell-99');

      // Verify a middle patch
      expect(reader.patchRow(50)).toBe(50);
      expect(reader.patchCol(50)).toBe(100);
      expect(reader.patchDisplayText(50)).toBe('cell-50');
    });

    it('NO_STRING sentinel (0xFFFFFFFF) returns null from display/error text methods', () => {
      // A patch with no display/error will have NO_STRING sentinel written by the builder
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 3.14 }],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchDisplayText(0)).toBeNull();
      expect(reader.patchErrorText(0)).toBeNull();
    });

    it('multiple patches where only some have display/error text', () => {
      const buf = buildTestMutationBuffer({
        patches: [
          { row: 0, col: 0, display: 'first', error: '#ERR1' },
          { row: 1, col: 0, numberValue: 42 },
          { row: 2, col: 0, display: 'third' },
          { row: 3, col: 0, error: '#ERR2' },
          { row: 4, col: 0, numberValue: 99 },
        ],
      });
      const reader = new BinaryMutationReader(buf);

      expect(reader.patchCount).toBe(5);

      // Patch 0: both display and error
      expect(reader.patchDisplayText(0)).toBe('first');
      expect(reader.patchErrorText(0)).toBe('#ERR1');

      // Patch 1: neither
      expect(reader.patchDisplayText(1)).toBeNull();
      expect(reader.patchErrorText(1)).toBeNull();

      // Patch 2: display only
      expect(reader.patchDisplayText(2)).toBe('third');
      expect(reader.patchErrorText(2)).toBeNull();

      // Patch 3: error only
      expect(reader.patchDisplayText(3)).toBeNull();
      expect(reader.patchErrorText(3)).toBe('#ERR2');

      // Patch 4: neither
      expect(reader.patchDisplayText(4)).toBeNull();
      expect(reader.patchErrorText(4)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Number value and flags
  // -----------------------------------------------------------------------

  describe('number value and flags via patchRecordOffset', () => {
    it('patchRecordOffset lets external code read raw f64 number value', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 3.14159, display: '3.14159' }],
      });
      const reader = new BinaryMutationReader(buf);

      const recOff = reader.patchRecordOffset(0);
      const value = reader._view.getFloat64(recOff, true);
      expect(value).toBeCloseTo(3.14159);
    });

    it('NaN number value for text cells', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, display: 'hello' }],
      });
      const reader = new BinaryMutationReader(buf);

      const recOff = reader.patchRecordOffset(0);
      const value = reader._view.getFloat64(recOff, true);
      expect(value).toBeNaN();
    });

    it('numeric number value for number cells', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: -123.456, display: '-123.456' }],
      });
      const reader = new BinaryMutationReader(buf);

      const recOff = reader.patchRecordOffset(0);
      const value = reader._view.getFloat64(recOff, true);
      expect(value).toBeCloseTo(-123.456);
    });

    it('flags field is readable via patchRecordOffset', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, flags: 0x0109 }],
      });
      const reader = new BinaryMutationReader(buf);

      const recOff = reader.patchRecordOffset(0);
      // Flags at offset 16 within the record
      const flags = reader._view.getUint16(recOff + 16, true);
      expect(flags).toBe(0x0109);
    });

    it('formatIdx field is readable via patchRecordOffset', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, formatIdx: 7 }],
      });
      const reader = new BinaryMutationReader(buf);

      const recOff = reader.patchRecordOffset(0);
      // formatIdx at offset 18 within the record
      const formatIdx = reader._view.getUint16(recOff + 18, true);
      expect(formatIdx).toBe(7);
    });

    it('zero number value is distinct from NaN', () => {
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 0, display: '0' }],
      });
      const reader = new BinaryMutationReader(buf);

      const recOff = reader.patchRecordOffset(0);
      const value = reader._view.getFloat64(recOff, true);
      expect(value).toBe(0);
      expect(value).not.toBeNaN();
    });
  });

  // -----------------------------------------------------------------------
  // Combined regular + spill patches
  // -----------------------------------------------------------------------

  describe('combined regular + spill patches', () => {
    it('both regular and spill patches decode correctly together', () => {
      const buf = buildTestMutationBuffer({
        sheetId: 'combo-sheet',
        generation: 5,
        hasErrors: true,
        patches: [
          { row: 0, col: 0, display: 'reg-0', numberValue: 1 },
          { row: 0, col: 1, display: 'reg-1', error: '#ERR' },
        ],
        spillPatches: [
          { row: 10, col: 10, display: 'spill-0' },
          { row: 11, col: 11, display: 'spill-1', error: '#SPILL!' },
        ],
      });
      const reader = new BinaryMutationReader(buf);

      // Header
      expect(reader.sheetId()).toBe('combo-sheet');
      expect(reader.generation).toBe(5);
      expect(reader.hasErrors).toBe(true);
      expect(reader.hasProjectionChanges).toBe(true);

      // Regular patches
      expect(reader.patchCount).toBe(2);
      expect(reader.patchRow(0)).toBe(0);
      expect(reader.patchCol(0)).toBe(0);
      expect(reader.patchDisplayText(0)).toBe('reg-0');
      expect(reader.patchRow(1)).toBe(0);
      expect(reader.patchCol(1)).toBe(1);
      expect(reader.patchDisplayText(1)).toBe('reg-1');
      expect(reader.patchErrorText(1)).toBe('#ERR');

      // Spill patches
      expect(reader.spillPatchCount).toBe(2);
      expect(reader.spillPatchRow(0)).toBe(10);
      expect(reader.spillPatchCol(0)).toBe(10);
      expect(reader.spillPatchDisplayText(0)).toBe('spill-0');
      expect(reader.spillPatchRow(1)).toBe(11);
      expect(reader.spillPatchCol(1)).toBe(11);
      expect(reader.spillPatchDisplayText(1)).toBe('spill-1');
      expect(reader.spillPatchErrorText(1)).toBe('#SPILL!');
    });
  });

  // -----------------------------------------------------------------------
  // Builder roundtrip
  // -----------------------------------------------------------------------

  describe('buildTestMutationBuffer roundtrip', () => {
    it('roundtrips all fields for a complex mutation', () => {
      const patches: TestMutationPatch[] = [];
      for (let i = 0; i < 5; i++) {
        patches.push({
          row: i * 10,
          col: i * 3,
          numberValue: i * 1.1,
          display: `display-${i}`,
          error: i % 2 === 0 ? `error-${i}` : undefined,
          flags: i,
          formatIdx: i + 10,
        });
      }

      const spillPatches: TestMutationPatch[] = [
        { row: 100, col: 200, display: 'spill-a', numberValue: 77.7 },
        { row: 101, col: 201, error: '#SPILL!', numberValue: 88.8 },
      ];

      const buf = buildTestMutationBuffer({
        sheetId: 'roundtrip-sheet',
        generation: 255,
        hasErrors: true,
        patches,
        spillPatches,
      });

      const reader = new BinaryMutationReader(buf);

      // Header
      expect(reader.sheetId()).toBe('roundtrip-sheet');
      expect(reader.generation).toBe(255);
      expect(reader.hasErrors).toBe(true);
      expect(reader.hasProjectionChanges).toBe(true);
      expect(reader.patchCount).toBe(5);
      expect(reader.spillPatchCount).toBe(2);

      // Verify all regular patches
      for (let i = 0; i < 5; i++) {
        expect(reader.patchRow(i)).toBe(i * 10);
        expect(reader.patchCol(i)).toBe(i * 3);
        expect(reader.patchDisplayText(i)).toBe(`display-${i}`);

        if (i % 2 === 0) {
          expect(reader.patchErrorText(i)).toBe(`error-${i}`);
        } else {
          expect(reader.patchErrorText(i)).toBeNull();
        }

        // Verify number value via record offset
        const recOff = reader.patchRecordOffset(i);
        const numVal = reader._view.getFloat64(recOff, true);
        expect(numVal).toBeCloseTo(i * 1.1);

        // Verify flags and formatIdx
        const flags = reader._view.getUint16(recOff + 16, true);
        expect(flags).toBe(i);
        const formatIdx = reader._view.getUint16(recOff + 18, true);
        expect(formatIdx).toBe(i + 10);
      }

      // Verify spill patches
      expect(reader.spillPatchRow(0)).toBe(100);
      expect(reader.spillPatchCol(0)).toBe(200);
      expect(reader.spillPatchDisplayText(0)).toBe('spill-a');
      expect(reader.spillPatchErrorText(0)).toBeNull();

      expect(reader.spillPatchRow(1)).toBe(101);
      expect(reader.spillPatchCol(1)).toBe(201);
      expect(reader.spillPatchDisplayText(1)).toBeNull();
      expect(reader.spillPatchErrorText(1)).toBe('#SPILL!');
    });
  });
});

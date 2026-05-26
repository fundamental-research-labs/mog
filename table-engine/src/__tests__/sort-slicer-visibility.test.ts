/**
 * Tests for slicer (CRUD) and visibility modules.
 *
 * Sort, slicer-cache, and filter evaluation now delegate to WASM
 * and are tested by the Rust test suite (550+ tests).
 *
 * This file retains tests for modules that stay in TypeScript:
 * - slicer.ts (object construction/CRUD)
 * - visibility.ts (simple bitmap ops)
 */

import type { CellValue, Slicer, SlicerCache, ValueFilter } from '../types';

// Mock the WASM backend with pure-JS implementations of the functions under test.
jest.mock('../wasm-backend', () => {
  function cellValuesEqual(a: CellValue, b: CellValue): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a === 'number' && typeof b === 'number') {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      return a === b;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.toLowerCase() === b.toLowerCase();
    }
    return false;
  }

  return {
    getWasm: () => ({
      table_toggle_slicer_value: (slicer: Slicer, value: CellValue): Slicer => {
        if (!slicer.multiSelect) {
          // Single-select: if already selected, clear; otherwise replace
          if (
            slicer.selectedValues.length === 1 &&
            cellValuesEqual(slicer.selectedValues[0], value)
          ) {
            return { ...slicer, selectedValues: [] };
          }
          return { ...slicer, selectedValues: [value] };
        }
        // Multi-select: toggle
        const idx = slicer.selectedValues.findIndex((v) => cellValuesEqual(v, value));
        if (idx >= 0) {
          return { ...slicer, selectedValues: slicer.selectedValues.filter((_, i) => i !== idx) };
        }
        return { ...slicer, selectedValues: [...slicer.selectedValues, value] };
      },

      table_select_slicer_values: (slicer: Slicer, values: readonly CellValue[]): Slicer => {
        return { ...slicer, selectedValues: [...values] };
      },

      table_clear_slicer_selection: (slicer: Slicer): Slicer => {
        return { ...slicer, selectedValues: [] };
      },

      table_select_all_slicer_values: (slicer: Slicer, cache: SlicerCache): Slicer => {
        return { ...slicer, selectedValues: cache.items.map((item) => item.value) };
      },

      table_slicer_to_filter_criteria: (slicer: Slicer) => {
        if (slicer.selectedValues.length === 0) {
          return { type: 'condition' as const, conditions: [], logic: 'and' as const };
        }
        const hasNull = slicer.selectedValues.some((v) => v === null);
        const nonNull = slicer.selectedValues.filter((v) => v !== null);
        return {
          type: 'values' as const,
          included: nonNull,
          includeBlanks: hasNull,
        };
      },

      table_compose_bitmaps: (bitmaps: number[][]): number[] => {
        if (bitmaps.length === 0) return [];
        const minLen = Math.min(...bitmaps.map((b) => b.length));
        if (bitmaps.length === 1) return bitmaps[0].slice(0, minLen);
        const result: number[] = new Array(minLen);
        for (let i = 0; i < minLen; i++) {
          result[i] = bitmaps.every((b) => b[i] === 1) ? 1 : 0;
        }
        return result;
      },

      table_create_row_visibility: (bitmap: number[]) => {
        let visibleCount = 0;
        let firstVisibleRow = -1;
        let lastVisibleRow = -1;
        for (let i = 0; i < bitmap.length; i++) {
          if (bitmap[i] === 1) {
            visibleCount++;
            if (firstVisibleRow === -1) firstVisibleRow = i;
            lastVisibleRow = i;
          }
        }
        return {
          bitmap: [...bitmap],
          visibleCount,
          totalCount: bitmap.length,
          firstVisibleRow,
          lastVisibleRow,
        };
      },

      // Compare functions — needed because compare.ts now delegates to WASM
      table_compare_values: (a: CellValue, b: CellValue): number => {
        const ERROR_SORT_ORDER: Record<string, number> = {
          Null: 0,
          Div0: 1,
          Value: 2,
          Ref: 3,
          Name: 4,
          Num: 5,
          Na: 6,
          GettingData: 7,
          Spill: 8,
          Calc: 9,
          Circ: 3,
        };

        function isCellErr(v: CellValue): boolean {
          return (
            typeof v === 'object' &&
            v !== null &&
            'type' in v &&
            (v as { type: string }).type === 'error'
          );
        }
        function getErrVal(v: CellValue): string | null {
          if (isCellErr(v)) return (v as { value: string }).value;
          return null;
        }
        function tRank(v: CellValue): number {
          if (v === null || v === undefined) return 4;
          if (isCellErr(v)) return 3;
          if (typeof v === 'boolean') return 2;
          if (typeof v === 'string') return 1;
          return 0;
        }

        const rankA = tRank(a);
        const rankB = tRank(b);
        if (rankA !== rankB) return rankA - rankB;
        if (rankA === 4) return 0;
        if (rankA === 3) {
          const errA = getErrVal(a)!;
          const errB = getErrVal(b)!;
          const orderA = ERROR_SORT_ORDER[errA] ?? 99;
          const orderB = ERROR_SORT_ORDER[errB] ?? 99;
          if (orderA !== orderB) return orderA - orderB;
          return errA < errB ? -1 : errA > errB ? 1 : 0;
        }
        if (rankA === 2) {
          const bA = a as boolean;
          const bB = b as boolean;
          if (bA === bB) return 0;
          return bA ? 1 : -1;
        }
        if (rankA === 1) {
          return (a as string).toLowerCase().localeCompare((b as string).toLowerCase());
        }
        const nA = a as number;
        const nB = b as number;
        if (Number.isNaN(nA)) return Number.isNaN(nB) ? 0 : 1;
        if (Number.isNaN(nB)) return -1;
        return nA < nB ? -1 : nA > nB ? 1 : 0;
      },

      table_cell_values_equal: (a: CellValue, b: CellValue): boolean => {
        return cellValuesEqual(a, b);
      },

      table_cell_value_key: (value: CellValue): string => {
        function isCellErr(v: CellValue): boolean {
          return (
            typeof v === 'object' &&
            v !== null &&
            'type' in v &&
            (v as { type: string }).type === 'error'
          );
        }
        if (value === null || value === undefined) return '__NULL__';
        if (isCellErr(value)) return `__ERR__:${(value as { value: string }).value}`;
        if (typeof value === 'boolean') return `__BOOL__:${value}`;
        if (typeof value === 'number') return `__NUM__:${value}`;
        if (typeof value === 'string') return `__STR__:${value.toLowerCase()}`;
        return `__UNK__:${String(value)}`;
      },

      table_value_in_list: (value: CellValue, list: readonly CellValue[]): boolean => {
        function isCellErr(v: CellValue): boolean {
          return (
            typeof v === 'object' &&
            v !== null &&
            'type' in v &&
            (v as { type: string }).type === 'error'
          );
        }
        if (value === null || value === undefined) {
          return list.some((v) => v === null || v === undefined);
        }
        if (isCellErr(value)) {
          const errorVal = (value as { value: string }).value;
          return list.some((v) => isCellErr(v) && (v as { value: string }).value === errorVal);
        }
        if (typeof value === 'string') {
          const lower = value.toLowerCase();
          return list.some((v) => typeof v === 'string' && v.toLowerCase() === lower);
        }
        if (typeof value === 'number' && Number.isNaN(value)) {
          return list.some((v) => typeof v === 'number' && Number.isNaN(v));
        }
        return list.some((v) => v === value);
      },

      table_format_cell_display: (value: CellValue): string => {
        const ERROR_DISPLAY_MAP: Record<string, string> = {
          Null: '#NULL!',
          Div0: '#DIV/0!',
          Value: '#VALUE!',
          Ref: '#REF!',
          Name: '#NAME?',
          Num: '#NUM!',
          Na: '#N/A',
          GettingData: '#GETTING_DATA',
          Spill: '#SPILL!',
          Calc: '#CALC!',
          Circ: '#REF!',
        };
        function isCellErr(v: CellValue): boolean {
          return (
            typeof v === 'object' &&
            v !== null &&
            'type' in v &&
            (v as { type: string }).type === 'error'
          );
        }
        if (value === null || value === undefined) return '(Blank)';
        if (isCellErr(value)) {
          const variant = (value as { value: string }).value;
          return ERROR_DISPLAY_MAP[variant] ?? '#CALC!';
        }
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        return String(value);
      },
    }),
    initTableWasm: jest.fn(),
    hasWasm: () => true,
  };
});

import { compareValues } from '../compare';
import {
  clearSlicerSelection,
  createSlicer,
  selectAllSlicerValues,
  setSlicerSelection,
  slicerToFilterCriteria,
  toggleSlicerValue,
} from '../slicer';

import { composeBitmaps, createRowVisibility } from '../visibility';

// ═══════════════════════════════════════════
//  SLICER TESTS
// ═══════════════════════════════════════════

describe('slicer', () => {
  describe('createSlicer', () => {
    it('creates with defaults', () => {
      const s = createSlicer({
        id: 's1',
        name: 'Region',
        sourceType: 'table',
        sourceId: 'table1',
        sourceColumnId: 'col1',
      });
      expect(s.id).toBe('s1');
      expect(s.name).toBe('Region');
      expect(s.sourceType).toBe('table');
      expect(s.sourceId).toBe('table1');
      expect(s.sourceColumnId).toBe('col1');
      expect(s.selectedValues).toEqual([]);
      expect(s.multiSelect).toBe(true);
      expect(s.showItemsWithNoData).toBe(false);
      expect(s.sortOrder).toBe('ascending');
    });

    it('creates with custom options', () => {
      const s = createSlicer({
        id: 's2',
        name: 'Status',
        sourceType: 'pivot',
        sourceId: 'pivot1',
        sourceColumnId: 'field1',
        multiSelect: false,
        showItemsWithNoData: true,
        sortOrder: 'descending',
      });
      expect(s.multiSelect).toBe(false);
      expect(s.showItemsWithNoData).toBe(true);
      expect(s.sortOrder).toBe('descending');
    });
  });

  describe('toggleSlicerValue (multi-select)', () => {
    const slicer = createSlicer({
      id: 's1',
      name: 'Region',
      sourceType: 'table',
      sourceId: 'table1',
      sourceColumnId: 'col1',
      multiSelect: true,
    });

    it('adds value when not selected', () => {
      const s = toggleSlicerValue(slicer, 'East');
      expect(s.selectedValues).toEqual(['East']);
    });

    it('removes value when already selected', () => {
      const s1 = toggleSlicerValue(slicer, 'East');
      const s2 = toggleSlicerValue(s1, 'West');
      expect(s2.selectedValues).toEqual(['East', 'West']);
      const s3 = toggleSlicerValue(s2, 'East');
      expect(s3.selectedValues).toEqual(['West']);
    });

    it('handles null values', () => {
      const s1 = toggleSlicerValue(slicer, null);
      expect(s1.selectedValues).toEqual([null]);
      const s2 = toggleSlicerValue(s1, null);
      expect(s2.selectedValues).toEqual([]);
    });

    it('treats strings case-insensitively (toggling "hello" removes "Hello")', () => {
      const s1 = toggleSlicerValue(slicer, 'Hello');
      expect(s1.selectedValues).toEqual(['Hello']);
      // Toggling "hello" (lowercase) should remove "Hello", not add a second entry
      const s2 = toggleSlicerValue(s1, 'hello');
      expect(s2.selectedValues).toEqual([]);
    });

    it('adds NaN to selection', () => {
      const s = toggleSlicerValue(slicer, NaN);
      expect(s.selectedValues).toHaveLength(1);
      expect(Number.isNaN(s.selectedValues[0] as number)).toBe(true);
    });

    it('removes NaN from selection (toggle off)', () => {
      const s1 = toggleSlicerValue(slicer, NaN);
      expect(s1.selectedValues).toHaveLength(1);
      const s2 = toggleSlicerValue(s1, NaN);
      expect(s2.selectedValues).toEqual([]);
    });
  });

  describe('toggleSlicerValue (single-select)', () => {
    const slicer = createSlicer({
      id: 's1',
      name: 'Region',
      sourceType: 'table',
      sourceId: 'table1',
      sourceColumnId: 'col1',
      multiSelect: false,
    });

    it('selects value when nothing selected', () => {
      const s = toggleSlicerValue(slicer, 'East');
      expect(s.selectedValues).toEqual(['East']);
    });

    it('replaces selection with new value', () => {
      const s1 = toggleSlicerValue(slicer, 'East');
      const s2 = toggleSlicerValue(s1, 'West');
      expect(s2.selectedValues).toEqual(['West']);
    });

    it('clears selection when toggling same value', () => {
      const s1 = toggleSlicerValue(slicer, 'East');
      const s2 = toggleSlicerValue(s1, 'East');
      expect(s2.selectedValues).toEqual([]);
    });
  });

  describe('setSlicerSelection', () => {
    const slicer = createSlicer({
      id: 's1',
      name: 'Region',
      sourceType: 'table',
      sourceId: 'table1',
      sourceColumnId: 'col1',
    });

    it('sets selection to given values', () => {
      const s = setSlicerSelection(slicer, ['East', 'West']);
      expect(s.selectedValues).toEqual(['East', 'West']);
    });

    it('replaces existing selection', () => {
      const s1 = setSlicerSelection(slicer, ['East']);
      const s2 = setSlicerSelection(s1, ['North', 'South']);
      expect(s2.selectedValues).toEqual(['North', 'South']);
    });
  });

  describe('clearSlicerSelection', () => {
    it('clears all selected values', () => {
      const slicer = createSlicer({
        id: 's1',
        name: 'Region',
        sourceType: 'table',
        sourceId: 'table1',
        sourceColumnId: 'col1',
      });
      const s1 = setSlicerSelection(slicer, ['East', 'West']);
      const s2 = clearSlicerSelection(s1);
      expect(s2.selectedValues).toEqual([]);
    });
  });

  describe('selectAllSlicerValues', () => {
    it('selects all values from cache', () => {
      const slicer = createSlicer({
        id: 's1',
        name: 'Region',
        sourceType: 'table',
        sourceId: 'table1',
        sourceColumnId: 'col1',
      });
      const cache: SlicerCache = {
        items: [
          { value: 'East', displayText: 'East', count: 3, selected: false, hasData: true },
          { value: 'West', displayText: 'West', count: 2, selected: false, hasData: true },
          { value: 'North', displayText: 'North', count: 1, selected: false, hasData: true },
        ],
        totalCount: 3,
        selectedCount: 0,
      };
      const s = selectAllSlicerValues(slicer, cache);
      expect(s.selectedValues).toEqual(['East', 'West', 'North']);
    });

    it('sets all values even in single-select mode (known limitation)', () => {
      const slicer = createSlicer({
        id: 's1',
        name: 'Region',
        sourceType: 'table',
        sourceId: 'table1',
        sourceColumnId: 'col1',
        multiSelect: false,
      });
      const cache: SlicerCache = {
        items: [
          { value: 'East', displayText: 'East', count: 3, selected: false, hasData: true },
          { value: 'West', displayText: 'West', count: 2, selected: false, hasData: true },
          { value: 'North', displayText: 'North', count: 1, selected: false, hasData: true },
        ],
        totalCount: 3,
        selectedCount: 0,
      };
      const s = selectAllSlicerValues(slicer, cache);
      expect(s.selectedValues).toEqual(['East', 'West', 'North']);
      expect(s.selectedValues).toHaveLength(3);
      expect(s.multiSelect).toBe(false);
    });
  });

  describe('slicerToFilterCriteria', () => {
    it('converts empty selection to pass-all filter', () => {
      const slicer = createSlicer({
        id: 's1',
        name: 'Region',
        sourceType: 'table',
        sourceId: 'table1',
        sourceColumnId: 'col1',
      });
      const filter = slicerToFilterCriteria(slicer);
      // Empty selection -> ConditionFilter with no conditions -> matches everything
      expect(filter.type).toBe('condition');
      expect((filter as any).conditions).toEqual([]);
    });

    it('converts selection to value filter', () => {
      const slicer = setSlicerSelection(
        createSlicer({
          id: 's1',
          name: 'Region',
          sourceType: 'table',
          sourceId: 'table1',
          sourceColumnId: 'col1',
        }),
        ['East', 'West'],
      );
      const filter = slicerToFilterCriteria(slicer);
      expect(filter.type).toBe('values');
      expect((filter as ValueFilter).included).toEqual(['East', 'West']);
      expect((filter as ValueFilter).includeBlanks).toBe(false);
    });

    it('includes blanks when null is in selection', () => {
      const slicer = setSlicerSelection(
        createSlicer({
          id: 's1',
          name: 'Region',
          sourceType: 'table',
          sourceId: 'table1',
          sourceColumnId: 'col1',
        }),
        ['East', null],
      );
      const filter = slicerToFilterCriteria(slicer);
      expect((filter as ValueFilter).included).toEqual(['East']);
      expect((filter as ValueFilter).includeBlanks).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════
//  VISIBILITY TESTS
// ═══════════════════════════════════════════

describe('composeBitmaps', () => {
  it('returns empty Uint8Array for empty array', () => {
    const result = composeBitmaps([]);
    expect(result).toEqual(new Uint8Array(0));
    expect(result.length).toBe(0);
  });

  it('single bitmap passthrough (copy)', () => {
    const bitmap = new Uint8Array([1, 0, 1, 1, 0]);
    const result = composeBitmaps([bitmap]);
    expect(result).toEqual(bitmap);
    // Should be a copy, not the same reference
    expect(result).not.toBe(bitmap);
  });

  it('AND of two bitmaps', () => {
    const a = new Uint8Array([1, 1, 0, 1, 0]);
    const b = new Uint8Array([1, 0, 0, 1, 1]);
    const result = composeBitmaps([a, b]);
    expect(result).toEqual(new Uint8Array([1, 0, 0, 1, 0]));
  });

  it('AND of three bitmaps', () => {
    const a = new Uint8Array([1, 1, 1, 0]);
    const b = new Uint8Array([1, 1, 0, 0]);
    const c = new Uint8Array([1, 0, 1, 0]);
    const result = composeBitmaps([a, b, c]);
    expect(result).toEqual(new Uint8Array([1, 0, 0, 0]));
  });

  it('all ones AND preserves all', () => {
    const a = new Uint8Array([1, 1, 1]);
    const b = new Uint8Array([1, 1, 1]);
    expect(composeBitmaps([a, b])).toEqual(new Uint8Array([1, 1, 1]));
  });

  it('any zero hides the row', () => {
    const a = new Uint8Array([1, 1, 1]);
    const b = new Uint8Array([0, 0, 0]);
    expect(composeBitmaps([a, b])).toEqual(new Uint8Array([0, 0, 0]));
  });

  it('handles mismatched-length bitmaps by using minimum length', () => {
    const a = new Uint8Array([1, 1, 1, 1, 1]);
    const b = new Uint8Array([1, 0, 1]);
    const result = composeBitmaps([a, b]);
    // Should only produce 3 elements (min length)
    expect(result.length).toBe(3);
    expect(result).toEqual(new Uint8Array([1, 0, 1]));
  });

  it('composing all-zero bitmaps produces all-zero result', () => {
    const a = new Uint8Array([0, 0, 0, 0]);
    const b = new Uint8Array([0, 0, 0, 0]);
    const c = new Uint8Array([0, 0, 0, 0]);
    const result = composeBitmaps([a, b, c]);
    expect(result).toEqual(new Uint8Array([0, 0, 0, 0]));
  });
});

describe('createRowVisibility', () => {
  it('computes stats for all visible', () => {
    const bitmap = new Uint8Array([1, 1, 1, 1]);
    const rv = createRowVisibility(bitmap);
    expect(rv.visibleCount).toBe(4);
    expect(rv.totalCount).toBe(4);
    expect(rv.firstVisibleRow).toBe(0);
    expect(rv.lastVisibleRow).toBe(3);
  });

  it('computes stats for all hidden', () => {
    const bitmap = new Uint8Array([0, 0, 0, 0]);
    const rv = createRowVisibility(bitmap);
    expect(rv.visibleCount).toBe(0);
    expect(rv.totalCount).toBe(4);
    expect(rv.firstVisibleRow).toBe(-1);
    expect(rv.lastVisibleRow).toBe(-1);
  });

  it('computes stats for mixed visibility', () => {
    const bitmap = new Uint8Array([0, 1, 0, 1, 0, 1]);
    const rv = createRowVisibility(bitmap);
    expect(rv.visibleCount).toBe(3);
    expect(rv.totalCount).toBe(6);
    expect(rv.firstVisibleRow).toBe(1);
    expect(rv.lastVisibleRow).toBe(5);
  });

  it('handles empty bitmap', () => {
    const bitmap = new Uint8Array([]);
    const rv = createRowVisibility(bitmap);
    expect(rv.visibleCount).toBe(0);
    expect(rv.totalCount).toBe(0);
    expect(rv.firstVisibleRow).toBe(-1);
    expect(rv.lastVisibleRow).toBe(-1);
  });

  it('handles single visible row', () => {
    const bitmap = new Uint8Array([0, 0, 1, 0, 0]);
    const rv = createRowVisibility(bitmap);
    expect(rv.visibleCount).toBe(1);
    expect(rv.firstVisibleRow).toBe(2);
    expect(rv.lastVisibleRow).toBe(2);
  });

  it('returns a defensive copy of the bitmap', () => {
    const bitmap = new Uint8Array([1, 0, 1]);
    const rv = createRowVisibility(bitmap);
    // Mutate the original -- should not affect the returned visibility
    bitmap[0] = 0;
    expect(rv.bitmap[0]).toBe(1);
  });
});

// ═══════════════════════════════════════════
//  compareValues (stays in TS)
// ═══════════════════════════════════════════

describe('compareValues', () => {
  it('numbers < text', () => {
    expect(compareValues(1, 'a')).toBeLessThan(0);
  });

  it('text < booleans', () => {
    expect(compareValues('a', true)).toBeLessThan(0);
  });

  it('booleans < errors', () => {
    expect(compareValues(true, { type: 'error', value: 'Na' } as CellValue)).toBeLessThan(0);
  });

  it('errors < blanks', () => {
    expect(compareValues({ type: 'error', value: 'Na' } as CellValue, null)).toBeLessThan(0);
  });

  it('numbers compare numerically', () => {
    expect(compareValues(10, 20)).toBeLessThan(0);
    expect(compareValues(20, 10)).toBeGreaterThan(0);
    expect(compareValues(5, 5)).toBe(0);
  });

  it('strings compare case-insensitively', () => {
    expect(compareValues('apple', 'Banana')).toBeLessThan(0);
    expect(compareValues('Apple', 'apple')).toBe(0);
  });

  it('booleans: FALSE < TRUE', () => {
    expect(compareValues(false, true)).toBeLessThan(0);
    expect(compareValues(true, false)).toBeGreaterThan(0);
  });

  it('blanks are equal to blanks', () => {
    expect(compareValues(null, null)).toBe(0);
  });

  it('NaN equals NaN', () => {
    expect(compareValues(NaN, NaN)).toBe(0);
  });

  it('NaN sorts after normal numbers', () => {
    expect(compareValues(NaN, 100)).toBeGreaterThan(0);
    expect(compareValues(100, NaN)).toBeLessThan(0);
  });

  it('Infinity compared to Infinity returns 0', () => {
    expect(compareValues(Infinity, Infinity)).toBe(0);
  });

  it('-Infinity compared to -Infinity returns 0', () => {
    expect(compareValues(-Infinity, -Infinity)).toBe(0);
  });

  it('Infinity compared to -Infinity returns positive', () => {
    expect(compareValues(Infinity, -Infinity)).toBeGreaterThan(0);
  });

  it('-Infinity compared to Infinity returns negative', () => {
    expect(compareValues(-Infinity, Infinity)).toBeLessThan(0);
  });

  it('sort with NaN values produces consistent ordering', () => {
    const values: CellValue[] = [3, NaN, 1, NaN, 2];
    const sorted = [...values].sort(compareValues);
    // Normal numbers sorted, NaN values at the end of numbers group
    expect(sorted[0]).toBe(1);
    expect(sorted[1]).toBe(2);
    expect(sorted[2]).toBe(3);
    expect(Number.isNaN(sorted[3] as number)).toBe(true);
    expect(Number.isNaN(sorted[4] as number)).toBe(true);
  });
});

/**
 * Unit tests for `FloatingObjectsProjection`.
 *
 * The projection is the kernel-owned TS-side mirror of Rust floating-object
 * state. It must:
 *   - Implement sync getters that return stable references for equal state.
 *   - Apply atomic batches and fire one notification per batch.
 *   - Maintain the per-sheet index across cross-sheet moves and deletions.
 *   - Honor unsubscribe contracts.
 *
 * These cover the snapshot equality and subscription notification invariants.
 */

import { jest } from '@jest/globals';

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { FloatingObjectBoundsSnapshot } from '@mog-sdk/contracts/objects';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import {
  FloatingObjectsProjection,
  createFloatingObjectsProjection,
} from '../floating-objects-projection';

// =============================================================================
// Helpers
// =============================================================================

const SHEET_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHEET_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeShape(id: string, sheetIdString: string, zIndex = 0): FloatingObject {
  return {
    id,
    sheetId: toSheetId(sheetIdString),
    type: 'shape',
    shapeType: 'rect',
    zIndex,
    locked: false,
    printable: true,
    position: {
      anchorType: 'twoCell',
      from: { cellId: 'c0', xOffset: 0, yOffset: 0 },
      to: { cellId: 'c1', xOffset: 0, yOffset: 0 },
      width: 100,
      height: 100,
    },
  } as unknown as FloatingObject;
}

function makeBounds(x: number, y: number, w: number, h: number): FloatingObjectBoundsSnapshot {
  return { x, y, width: w, height: h, rotation: 0 };
}

// =============================================================================
// Tests
// =============================================================================

describe('FloatingObjectsProjection', () => {
  let projection: FloatingObjectsProjection;

  beforeEach(() => {
    projection = createFloatingObjectsProjection();
  });

  describe('empty state', () => {
    it('returns empty array for unknown sheet', () => {
      expect(projection.getInSheet('unknown')).toEqual([]);
    });

    it('returns empty bounds map for unknown sheet', () => {
      expect(projection.getBoundsInSheet('unknown').size).toBe(0);
    });

    it('returns undefined for unknown object id', () => {
      expect(projection.getObjectById('unknown')).toBeUndefined();
      expect(projection.getBoundsById('unknown')).toBeUndefined();
    });
  });

  describe('applyBatch — created', () => {
    it('inserts objects and indexes them by sheet', () => {
      const a = makeShape('o1', SHEET_A);
      const b = makeShape('o2', SHEET_A);
      const c = makeShape('o3', SHEET_B);

      projection.applyBatch([a, b, c], []);

      expect(
        projection
          .getInSheet(SHEET_A)
          .map((o) => o.id)
          .sort(),
      ).toEqual(['o1', 'o2']);
      expect(projection.getInSheet(SHEET_B).map((o) => o.id)).toEqual(['o3']);
      expect(projection.getObjectById('o2')).toBe(b);
    });

    it('sorts results by zIndex ascending', () => {
      const back = makeShape('o-back', SHEET_A, 0);
      const mid = makeShape('o-mid', SHEET_A, 5);
      const front = makeShape('o-front', SHEET_A, 10);

      projection.applyBatch([front, back, mid], []);
      expect(projection.getInSheet(SHEET_A).map((o) => o.id)).toEqual([
        'o-back',
        'o-mid',
        'o-front',
      ]);
    });

    it('attaches bounds when provided', () => {
      const o = makeShape('o1', SHEET_A);
      const bounds = makeBounds(10, 20, 100, 200);

      projection.applyBatch([o], [], new Map([['o1', bounds]]));

      expect(projection.getBoundsById('o1')).toEqual(bounds);
      expect(projection.getBoundsInSheet(SHEET_A).get('o1')).toEqual(bounds);
    });
  });

  describe('applyBatch — deleted', () => {
    it('removes objects and bounds', () => {
      const o = makeShape('o1', SHEET_A);
      projection.applyBatch([o], [], new Map([['o1', makeBounds(0, 0, 50, 50)]]));

      projection.applyBatch([], ['o1']);

      expect(projection.getInSheet(SHEET_A)).toEqual([]);
      expect(projection.getBoundsById('o1')).toBeUndefined();
    });
  });

  describe('applyBatch — cross-sheet move', () => {
    it('removes object from the previous sheet index', () => {
      const o = makeShape('o1', SHEET_A);
      projection.applyBatch([o], []);
      expect(projection.getInSheet(SHEET_A).map((o) => o.id)).toEqual(['o1']);

      // Move o1 from sheet A → sheet B (same id, new sheetId).
      const moved = makeShape('o1', SHEET_B);
      projection.applyBatch([moved], []);

      expect(projection.getInSheet(SHEET_A)).toEqual([]);
      expect(projection.getInSheet(SHEET_B).map((o) => o.id)).toEqual(['o1']);
    });
  });

  describe('subscribe', () => {
    it('fires after applyBatch with affected sheet ids', () => {
      const listener = jest.fn();
      projection.subscribe(listener);

      const a = makeShape('o1', SHEET_A);
      const b = makeShape('o2', SHEET_B);

      projection.applyBatch([a, b], []);

      // Both sheets affected → two notifications.
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(SHEET_A);
      expect(listener).toHaveBeenCalledWith(SHEET_B);
    });

    it('fires once per applyBatch even with many objects', () => {
      const listener = jest.fn();
      projection.subscribe(listener);

      const objects = Array.from({ length: 10 }, (_, i) => makeShape(`o${i}`, SHEET_A, i));
      projection.applyBatch(objects, []);

      // 10 objects, all on SHEET_A → exactly one notification for that sheet.
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(SHEET_A);
    });

    it('does not notify when applyBatch has no work', () => {
      const listener = jest.fn();
      projection.subscribe(listener);

      projection.applyBatch([], []);
      expect(listener).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function', () => {
      const listener = jest.fn();
      const unsub = projection.subscribe(listener);

      projection.applyBatch([makeShape('o1', SHEET_A)], []);
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      projection.applyBatch([makeShape('o2', SHEET_A)], []);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('isolates a throwing listener from its peers', () => {
      const a = jest.fn(() => {
        throw new Error('boom');
      });
      const b = jest.fn();
      projection.subscribe(a);
      projection.subscribe(b);

      // Suppress the expected console.error.
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      projection.applyBatch([makeShape('o1', SHEET_A)], []);

      expect(a).toHaveBeenCalled();
      expect(b).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe('setObjectsForSheet', () => {
    it('replaces all entries for the sheet atomically', () => {
      projection.applyBatch(
        [makeShape('o1', SHEET_A), makeShape('o2', SHEET_A)],
        [],
        new Map([['o1', makeBounds(0, 0, 10, 10)]]),
      );
      expect(projection.getInSheet(SHEET_A).length).toBe(2);

      projection.setObjectsForSheet(SHEET_A, [makeShape('o3', SHEET_A)]);

      expect(projection.getInSheet(SHEET_A).map((o) => o.id)).toEqual(['o3']);
      // Old bounds for replaced objects must also be dropped.
      expect(projection.getBoundsById('o1')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('drops all state and notifies workbook-scoped', () => {
      projection.applyBatch([makeShape('o1', SHEET_A)], []);

      const listener = jest.fn();
      projection.subscribe(listener);
      projection.clear();

      expect(projection.getInSheet(SHEET_A)).toEqual([]);
      expect(listener).toHaveBeenCalledWith(null);
    });

    it('is a no-op (no notification) when already empty', () => {
      const listener = jest.fn();
      projection.subscribe(listener);
      projection.clear();
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

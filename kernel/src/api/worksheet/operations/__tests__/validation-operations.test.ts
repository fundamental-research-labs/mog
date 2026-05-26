/**
 * Validation Operations Integration Tests
 *
 * Tests the validation operations module which provides business logic
 * on top of ComputeBridge range schema methods (viewport filtering,
 * dropdown resolution, etc.).
 *
 * Tests mock ComputeBridge to verify the TS wiring layer.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import type { RangeSchema } from '../../../../bridges/compute/compute-bridge';
import { createEventBus } from '../../../../context/event-bus';
import * as ValidationOps from '../validation-operations';

// =============================================================================
// Mock helpers
// =============================================================================

const SHEET_ID = sheetId('sheet-1');

/** In-memory store simulating Rust range schema storage. */
function createSchemaStore() {
  const schemas = new Map<string, RangeSchema>();
  return {
    schemas,
    get(schemaId: string) {
      return schemas.get(schemaId) ?? null;
    },
    getAll() {
      return Array.from(schemas.values());
    },
    set(schema: RangeSchema) {
      schemas.set(schema.id, schema);
    },
    delete(schemaId: string) {
      schemas.delete(schemaId);
    },
  };
}

function createMockCtx(store: ReturnType<typeof createSchemaStore>) {
  return {
    eventBus: createEventBus(),
    computeBridge: {
      getRangeSchemasForSheet: jest.fn(async (_sheetId: string) => {
        return store.getAll();
      }),
      queryRange: jest.fn(async () => ({
        cells: [],
        merges: [],
      })),
    },
  } as any;
}

function makeSchema(overrides: Partial<RangeSchema> = {}): RangeSchema {
  return {
    id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
    ranges: [{ startId: '0:0', endId: '9:0' }],
    schema: { constraints: { enum: ['Yes', 'No'] } },
    enforcement: 'strict',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('validation-operations', () => {
  let store: ReturnType<typeof createSchemaStore>;
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    store = createSchemaStore();
    ctx = createMockCtx(store);
  });

  // ===========================================================================
  // Viewport filtering
  // ===========================================================================

  describe('getRangeSchemasInViewport', () => {
    it('returns schemas that overlap the viewport bounds', async () => {
      // Schema covering A1:A10 (rows 0-9, col 0)
      const inside = makeSchema({ id: 'inside', ranges: [{ startId: '0:0', endId: '9:0' }] });
      // Schema covering Z1:Z10 (rows 0-9, col 25) — outside viewport
      const outside = makeSchema({ id: 'outside', ranges: [{ startId: '0:25', endId: '9:25' }] });
      store.set(inside);
      store.set(outside);

      const results = await ValidationOps.getRangeSchemasInViewport(ctx, SHEET_ID, {
        startRow: 0,
        startCol: 0,
        endRow: 20,
        endCol: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('inside');
    });

    it('returns schemas that partially overlap', async () => {
      // Schema covering rows 5-15 — viewport is rows 0-10
      const partial = makeSchema({
        id: 'partial',
        ranges: [{ startId: '5:0', endId: '15:0' }],
      });
      store.set(partial);

      const results = await ValidationOps.getRangeSchemasInViewport(ctx, SHEET_ID, {
        startRow: 0,
        startCol: 0,
        endRow: 10,
        endCol: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('partial');
    });

    it('returns empty when no schemas overlap', async () => {
      const far = makeSchema({ id: 'far', ranges: [{ startId: '100:100', endId: '200:200' }] });
      store.set(far);

      const results = await ValidationOps.getRangeSchemasInViewport(ctx, SHEET_ID, {
        startRow: 0,
        startCol: 0,
        endRow: 10,
        endCol: 10,
      });

      expect(results).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Dropdown items
  // ===========================================================================

  describe('getDropdownItems', () => {
    it('returns static enum values for a list schema covering the cell', async () => {
      const schema = makeSchema({
        id: 'list-1',
        ranges: [{ startId: '0:0', endId: '9:0' }],
        schema: { constraints: { enum: ['Red', 'Green', 'Blue'] } },
      });
      store.set(schema);

      const items = await ValidationOps.getDropdownItems(ctx, SHEET_ID, 5, 0);
      expect(items).toEqual(['Red', 'Green', 'Blue']);
    });

    it('returns empty for non-list schema', async () => {
      const schema = makeSchema({
        id: 'num-1',
        ranges: [{ startId: '0:0', endId: '9:0' }],
        schema: { type: 'integer', constraints: { min: 0, max: 100 } },
      });
      store.set(schema);

      const items = await ValidationOps.getDropdownItems(ctx, SHEET_ID, 5, 0);
      expect(items).toEqual([]);
    });

    it('returns empty for cell not covered by any schema', async () => {
      const items = await ValidationOps.getDropdownItems(ctx, SHEET_ID, 99, 99);
      expect(items).toEqual([]);
    });

    it('resolves range source via queryRange', async () => {
      const schema = makeSchema({
        id: 'list-range',
        ranges: [{ startId: '0:1', endId: '9:1' }],
        schema: {
          constraints: {
            enumSource: { startId: '0:0', endId: '2:0' },
          },
        },
      });
      store.set(schema);

      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [
          { row: 0, col: 0, value: { type: 'Text', value: 'Alpha' }, formatted: 'Alpha' },
          { row: 1, col: 0, value: { type: 'Text', value: 'Beta' }, formatted: 'Beta' },
          { row: 2, col: 0, value: { type: 'Null' }, formatted: '' },
        ],
        merges: [],
      });

      const items = await ValidationOps.getDropdownItems(ctx, SHEET_ID, 5, 1);
      expect(items).toEqual(['Alpha', 'Beta']);
      expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 2, 0);
    });
  });

  // ===========================================================================
  // generateSchemaId
  // ===========================================================================

  describe('generateSchemaId', () => {
    it('generates unique IDs with rs- prefix', () => {
      const id1 = ValidationOps.generateSchemaId();
      const id2 = ValidationOps.generateSchemaId();
      expect(id1).toMatch(/^rs-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^rs-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });
});

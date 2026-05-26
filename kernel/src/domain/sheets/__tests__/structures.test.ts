/**
 * Structures Domain Module Tests
 *
 * Verifies that insertRows/deleteRows/insertColumns/deleteColumns
 * properly await the computeBridge.structureChange() call instead of
 * fire-and-forgetting it.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../../context/types';
import * as Structures from '../structures';

function createMockContext(structureChangeFn: jest.Mock): DocumentContext {
  return {
    computeBridge: {
      structureChange: structureChangeFn,
    },
  } as unknown as DocumentContext;
}

describe('Structures domain module', () => {
  describe('insertRows', () => {
    it('should await computeBridge.structureChange and not resolve early', async () => {
      const order: string[] = [];
      let resolveBridge!: () => void;
      const bridgePromise = new Promise<void>((r) => {
        resolveBridge = r;
      });

      const structureChange = jest.fn(() => {
        return bridgePromise.then(() => {
          order.push('bridge-resolved');
        });
      });

      const ctx = createMockContext(structureChange);

      const resultPromise = Structures.insertRows(ctx, sheetId('sheet1'), null, 0, 1).then(() => {
        order.push('insertRows-resolved');
      });

      // Bridge hasn't resolved yet — insertRows should still be pending
      await Promise.resolve(); // flush microtasks
      expect(order).toEqual([]);

      resolveBridge();
      await resultPromise;

      // insertRows must resolve AFTER the bridge call
      expect(order).toEqual(['bridge-resolved', 'insertRows-resolved']);
      expect(structureChange).toHaveBeenCalledWith('sheet1', {
        InsertRows: { at: 0, count: 1, new_row_ids: [] },
      });
    });

    it('should return immediately when count <= 0', async () => {
      const structureChange = jest.fn();
      const ctx = createMockContext(structureChange);

      await Structures.insertRows(ctx, sheetId('sheet1'), null, 0, 0);
      expect(structureChange).not.toHaveBeenCalled();
    });

    it('should return the MutationResult from the bridge call', async () => {
      const mockResult = { structureChanges: [{ type: 'InsertRows' }] };
      const structureChange = jest.fn().mockResolvedValue(mockResult);
      const ctx = createMockContext(structureChange);

      const result = await Structures.insertRows(ctx, sheetId('sheet1'), null, 0, 1);
      expect(result).toBe(mockResult);
    });
  });

  describe('deleteRows', () => {
    it('should await computeBridge.structureChange', async () => {
      const structureChange = jest.fn().mockResolvedValue(undefined);
      const ctx = createMockContext(structureChange);

      await Structures.deleteRows(ctx, sheetId('sheet1'), null, 2, 3);

      expect(structureChange).toHaveBeenCalledWith('sheet1', {
        DeleteRows: { at: 2, count: 3, deleted_cell_ids: [] },
      });
    });

    it('should return immediately when count <= 0', async () => {
      const structureChange = jest.fn();
      const ctx = createMockContext(structureChange);

      await Structures.deleteRows(ctx, sheetId('sheet1'), null, 0, -1);
      expect(structureChange).not.toHaveBeenCalled();
    });
  });

  describe('insertColumns', () => {
    it('should await computeBridge.structureChange', async () => {
      const structureChange = jest.fn().mockResolvedValue(undefined);
      const ctx = createMockContext(structureChange);

      await Structures.insertColumns(ctx, sheetId('sheet1'), null, 5, 2);

      expect(structureChange).toHaveBeenCalledWith('sheet1', {
        InsertCols: { at: 5, count: 2, new_col_ids: [] },
      });
    });
  });

  describe('deleteColumns', () => {
    it('should await computeBridge.structureChange', async () => {
      const structureChange = jest.fn().mockResolvedValue(undefined);
      const ctx = createMockContext(structureChange);

      await Structures.deleteColumns(ctx, sheetId('sheet1'), null, 1, 4);

      expect(structureChange).toHaveBeenCalledWith('sheet1', {
        DeleteCols: { at: 1, count: 4, deleted_cell_ids: [] },
      });
    });
  });
});

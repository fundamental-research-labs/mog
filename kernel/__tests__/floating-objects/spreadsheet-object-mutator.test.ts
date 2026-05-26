/**
 * Tests for SpreadsheetObjectMutator
 *
 * Verifies that each mutator method correctly dispatches to the ComputeBridge
 * with the right arguments after resolving the containerId from the object store.
 */

import { jest } from '@jest/globals';

import type { ComputeBridge } from '../../src/bridges/compute/compute-bridge';
import type { ComputeBridgeObjectStore } from '../../src/floating-objects/object-store';
import { SpreadsheetObjectMutator } from '../../src/floating-objects/spreadsheet-object-mutator';

function createMockBridge() {
  return {
    moveFloatingObjectTyped: jest.fn(async () => ({ floatingObjectChanges: [] })),
    resizeFloatingObjectTyped: jest.fn(async () => ({ floatingObjectChanges: [] })),
    rotateFloatingObjectTyped: jest.fn(async () => ({ floatingObjectChanges: [] })),
    flipFloatingObjectTyped: jest.fn(async () => ({ floatingObjectChanges: [] })),
    duplicateFloatingObjectTyped: jest.fn(async () => ({
      floatingObjectChanges: [{ objectId: 'new-obj-1', kind: { type: 'created' } }],
    })),
    deleteFloatingObject: jest.fn(async () => ({ floatingObjectChanges: [] })),
    bringFloatingObjectToFront: jest.fn(async () => ({ floatingObjectChanges: [] })),
    sendFloatingObjectToBack: jest.fn(async () => ({ floatingObjectChanges: [] })),
    bringFloatingObjectForward: jest.fn(async () => ({ floatingObjectChanges: [] })),
    sendFloatingObjectBackward: jest.fn(async () => ({ floatingObjectChanges: [] })),
  } as unknown as ComputeBridge;
}

function createMockStore(objectSheetMap: Record<string, string>) {
  return {
    read: jest.fn(async (objectId: string) => {
      const containerId = objectSheetMap[objectId];
      if (!containerId) return { object: undefined, containerId: undefined };
      return { object: { id: objectId }, containerId };
    }),
  } as unknown as ComputeBridgeObjectStore;
}

describe('SpreadsheetObjectMutator', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let store: ReturnType<typeof createMockStore>;
  let mutator: SpreadsheetObjectMutator;

  beforeEach(() => {
    bridge = createMockBridge();
    store = createMockStore({ 'obj-1': 'sheet-1', 'obj-2': 'sheet-2' });
    mutator = new SpreadsheetObjectMutator(
      bridge as unknown as ComputeBridge,
      store as unknown as ComputeBridgeObjectStore,
    );
  });

  describe('move', () => {
    it('should call moveFloatingObjectTyped with delta', async () => {
      const result = await mutator.move('obj-1', 10, 20);
      expect(result).toBe(true);
      expect((bridge as any).moveFloatingObjectTyped).toHaveBeenCalledWith('sheet-1', 'obj-1', {
        type: 'delta',
        dx: 10,
        dy: 20,
      });
    });

    it('should return false for unknown object', async () => {
      const result = await mutator.move('unknown', 10, 20);
      expect(result).toBe(false);
      expect((bridge as any).moveFloatingObjectTyped).not.toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('should call resizeFloatingObjectTyped', async () => {
      const result = await mutator.resize('obj-1', 200, 150);
      expect(result).toBe(true);
      expect((bridge as any).resizeFloatingObjectTyped).toHaveBeenCalledWith('sheet-1', 'obj-1', {
        width: 200,
        height: 150,
      });
    });

    it('should return false for unknown object', async () => {
      const result = await mutator.resize('unknown', 200, 150);
      expect(result).toBe(false);
      expect((bridge as any).resizeFloatingObjectTyped).not.toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('should call rotateFloatingObjectTyped', async () => {
      const result = await mutator.rotate('obj-1', 45);
      expect(result).toBe(true);
      expect((bridge as any).rotateFloatingObjectTyped).toHaveBeenCalledWith(
        'sheet-1',
        'obj-1',
        45,
      );
    });

    it('should return false for unknown object', async () => {
      const result = await mutator.rotate('unknown', 45);
      expect(result).toBe(false);
      expect((bridge as any).rotateFloatingObjectTyped).not.toHaveBeenCalled();
    });
  });

  describe('flip', () => {
    it('should call flipFloatingObjectTyped with horizontal', async () => {
      const result = await mutator.flip('obj-2', 'horizontal');
      expect(result).toBe(true);
      expect((bridge as any).flipFloatingObjectTyped).toHaveBeenCalledWith(
        'sheet-2',
        'obj-2',
        'horizontal',
      );
    });

    it('should call flipFloatingObjectTyped with vertical', async () => {
      const result = await mutator.flip('obj-1', 'vertical');
      expect(result).toBe(true);
      expect((bridge as any).flipFloatingObjectTyped).toHaveBeenCalledWith(
        'sheet-1',
        'obj-1',
        'vertical',
      );
    });

    it('should return false for unknown object', async () => {
      const result = await mutator.flip('unknown', 'horizontal');
      expect(result).toBe(false);
      expect((bridge as any).flipFloatingObjectTyped).not.toHaveBeenCalled();
    });
  });

  describe('duplicate', () => {
    it('should return new object ID from mutation result', async () => {
      const newId = await mutator.duplicate('obj-1', 20, 20);
      expect(newId).toBe('new-obj-1');
      expect((bridge as any).duplicateFloatingObjectTyped).toHaveBeenCalledWith(
        'sheet-1',
        'obj-1',
        20,
        20,
      );
    });

    it('should return null for unknown object', async () => {
      const newId = await mutator.duplicate('unknown', 20, 20);
      expect(newId).toBeNull();
      expect((bridge as any).duplicateFloatingObjectTyped).not.toHaveBeenCalled();
    });

    it('should return null when no created change in result', async () => {
      (bridge as any).duplicateFloatingObjectTyped.mockResolvedValueOnce({
        floatingObjectChanges: [{ objectId: 'obj-1', kind: { type: 'modified' } }],
      });
      const newId = await mutator.duplicate('obj-1', 10, 10);
      expect(newId).toBeNull();
    });
  });

  describe('delete', () => {
    it('should call deleteFloatingObject', async () => {
      const result = await mutator.delete('obj-1');
      expect(result).toBe(true);
      expect((bridge as any).deleteFloatingObject).toHaveBeenCalledWith('sheet-1', 'obj-1');
    });

    it('should return false for unknown object', async () => {
      const result = await mutator.delete('unknown');
      expect(result).toBe(false);
      expect((bridge as any).deleteFloatingObject).not.toHaveBeenCalled();
    });
  });

  describe('deleteMany', () => {
    it('should delete multiple objects and return count', async () => {
      const count = await mutator.deleteMany(['obj-1', 'obj-2', 'unknown']);
      expect(count).toBe(2);
      expect((bridge as any).deleteFloatingObject).toHaveBeenCalledTimes(2);
    });

    it('should return 0 for empty array', async () => {
      const count = await mutator.deleteMany([]);
      expect(count).toBe(0);
    });

    it('should return 0 when all objects are unknown', async () => {
      const count = await mutator.deleteMany(['unknown-1', 'unknown-2']);
      expect(count).toBe(0);
      expect((bridge as any).deleteFloatingObject).not.toHaveBeenCalled();
    });
  });

  describe('z-order', () => {
    it('bringToFront should call bridge method', async () => {
      const result = await mutator.bringToFront('obj-1');
      expect(result).toBe(true);
      expect((bridge as any).bringFloatingObjectToFront).toHaveBeenCalledWith('sheet-1', 'obj-1');
    });

    it('bringToFront should return false for unknown object', async () => {
      const result = await mutator.bringToFront('unknown');
      expect(result).toBe(false);
      expect((bridge as any).bringFloatingObjectToFront).not.toHaveBeenCalled();
    });

    it('sendToBack should call bridge method', async () => {
      const result = await mutator.sendToBack('obj-1');
      expect(result).toBe(true);
      expect((bridge as any).sendFloatingObjectToBack).toHaveBeenCalledWith('sheet-1', 'obj-1');
    });

    it('sendToBack should return false for unknown object', async () => {
      const result = await mutator.sendToBack('unknown');
      expect(result).toBe(false);
      expect((bridge as any).sendFloatingObjectToBack).not.toHaveBeenCalled();
    });

    it('bringForward should call bridge method', async () => {
      const result = await mutator.bringForward('obj-1');
      expect(result).toBe(true);
      expect((bridge as any).bringFloatingObjectForward).toHaveBeenCalledWith('sheet-1', 'obj-1');
    });

    it('bringForward should return false for unknown object', async () => {
      const result = await mutator.bringForward('unknown');
      expect(result).toBe(false);
      expect((bridge as any).bringFloatingObjectForward).not.toHaveBeenCalled();
    });

    it('sendBackward should call bridge method', async () => {
      const result = await mutator.sendBackward('obj-1');
      expect(result).toBe(true);
      expect((bridge as any).sendFloatingObjectBackward).toHaveBeenCalledWith('sheet-1', 'obj-1');
    });

    it('sendBackward should return false for unknown object', async () => {
      const result = await mutator.sendBackward('unknown');
      expect(result).toBe(false);
      expect((bridge as any).sendFloatingObjectBackward).not.toHaveBeenCalled();
    });
  });
});

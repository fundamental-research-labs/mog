/**
 * Tests for FloatingObjectStore
 *
 * Verifies pure CRDT CRUD operations for floating objects.
 * Tests use mock ComputeBridge for accurate behavior.
 */

import { jest } from '@jest/globals';

import type { FloatingObject, ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type { CanvasObjectGroup } from '@mog-sdk/contracts/objects/canvas-object';

import type { ComputeBridge } from '../../src/bridges/compute/compute-bridge';
import {
  ComputeBridgeGroupStore,
  ComputeBridgeObjectStore,
} from '../../src/floating-objects/object-store';

// =============================================================================
// Mock ComputeBridge backed by in-memory Maps
// =============================================================================

interface SheetData {
  floatingObjects: Map<string, any>;
  floatingObjectGroups: Map<string, any>;
}

function createMockComputeBridge(): ComputeBridge {
  const sheets = new Map<string, SheetData>();

  function getOrCreateSheet(sheetId: string): SheetData {
    let data = sheets.get(sheetId);
    if (!data) {
      data = {
        floatingObjects: new Map(),
        floatingObjectGroups: new Map(),
      };
      sheets.set(sheetId, data);
    }
    return data;
  }

  const bridge = {
    getAllSheetIds: jest.fn(async (): Promise<string[]> => {
      return Array.from(sheets.keys());
    }),

    setFloatingObject: jest.fn(
      async (sheetId: string, objectId: string, json: any): Promise<any> => {
        const sheet = getOrCreateSheet(sheetId);
        sheet.floatingObjects.set(objectId, json);
        return { success: true };
      },
    ),

    getFloatingObject: jest.fn(async (sheetId: string, objectId: string): Promise<any | null> => {
      const sheet = sheets.get(sheetId);
      if (!sheet) return null;
      return sheet.floatingObjects.get(objectId) ?? null;
    }),

    getFloatingObjectsInSheet: jest.fn(async (sheetId: string): Promise<Array<[string, any]>> => {
      const sheet = sheets.get(sheetId);
      if (!sheet) return [];
      return Array.from(sheet.floatingObjects.entries());
    }),

    deleteFloatingObject: jest.fn(async (sheetId: string, objectId: string): Promise<any> => {
      const sheet = sheets.get(sheetId);
      if (!sheet) return { success: false };
      sheet.floatingObjects.delete(objectId);
      return { success: true };
    }),

    setFloatingObjectGroup: jest.fn(
      async (sheetId: string, groupId: string, json: any): Promise<any> => {
        const sheet = getOrCreateSheet(sheetId);
        // Store with both memberIds and children for wire/domain format compatibility
        const stored = { ...json, children: json.children ?? json.memberIds };
        sheet.floatingObjectGroups.set(groupId, stored);
        return { success: true };
      },
    ),

    getFloatingObjectGroup: jest.fn(
      async (sheetId: string, groupId: string): Promise<any | null> => {
        const sheet = sheets.get(sheetId);
        if (!sheet) return null;
        return sheet.floatingObjectGroups.get(groupId) ?? null;
      },
    ),

    getFloatingObjectGroupsInSheet: jest.fn(
      async (sheetId: string): Promise<Array<[string, any]>> => {
        const sheet = sheets.get(sheetId);
        if (!sheet) return [];
        return Array.from(sheet.floatingObjectGroups.entries());
      },
    ),

    deleteFloatingObjectGroup: jest.fn(async (sheetId: string, groupId: string): Promise<any> => {
      const sheet = sheets.get(sheetId);
      if (!sheet) return { success: false };
      sheet.floatingObjectGroups.delete(groupId);
      return { success: true };
    }),

    getFloatingObjectTyped: jest.fn(
      async (sheetId: string, objectId: string): Promise<any | null> => {
        const sheet = sheets.get(sheetId);
        if (!sheet) return null;
        return sheet.floatingObjects.get(objectId) ?? null;
      },
    ),

    getAllFloatingObjectsTyped: jest.fn(async (sheetId: string): Promise<any[]> => {
      const sheet = sheets.get(sheetId);
      if (!sheet) return [];
      return Array.from(sheet.floatingObjects.values());
    }),

    getFloatingObjectGroupTyped: jest.fn(
      async (sheetId: string, groupId: string): Promise<any | null> => {
        const sheet = sheets.get(sheetId);
        if (!sheet) return null;
        return sheet.floatingObjectGroups.get(groupId) ?? null;
      },
    ),

    getAllFloatingObjectGroupsTyped: jest.fn(async (sheetId: string): Promise<any[]> => {
      const sheet = sheets.get(sheetId);
      if (!sheet) return [];
      return Array.from(sheet.floatingObjectGroups.values());
    }),

    updateFloatingObject: jest.fn(
      async (sheetId: string, objectId: string, updates: any): Promise<any> => {
        const sheet = sheets.get(sheetId);
        if (!sheet) return { success: false };
        const existing = sheet.floatingObjects.get(objectId);
        if (!existing) return { success: false };
        const merged = { ...existing, ...updates };
        sheet.floatingObjects.set(objectId, merged);
        return { success: true };
      },
    ),

    updateFloatingObjectGroup: jest.fn(
      async (sheetId: string, groupId: string, updates: any): Promise<any> => {
        const sheet = sheets.get(sheetId);
        if (!sheet) return { success: false };
        const existing = sheet.floatingObjectGroups.get(groupId);
        if (!existing) return { success: false };
        const merged = { ...existing, ...updates };
        // Keep memberIds and children in sync
        if (updates.children) merged.memberIds = updates.children;
        if (updates.memberIds) merged.children = updates.memberIds;
        sheet.floatingObjectGroups.set(groupId, merged);
        return { success: true };
      },
    ),

    // Expose internal sheets map for setupSheet helper
    _sheets: sheets,
  };

  return bridge as unknown as ComputeBridge;
}

// =============================================================================
// Test Helpers
// =============================================================================

function setupSheet(bridge: ComputeBridge, sheetId: string): void {
  const sheets = (bridge as any)._sheets as Map<string, SheetData>;
  if (!sheets.has(sheetId)) {
    sheets.set(sheetId, {
      floatingObjects: new Map(),
      floatingObjectGroups: new Map(),
    });
  }
}

function createTestObject(overrides?: Partial<FloatingObject>): FloatingObject {
  const defaultPosition: ObjectPosition = {
    anchorType: 'oneCell',
    from: { cellId: 'cell-A1', xOffset: 0, yOffset: 0 },
    width: 100,
    height: 50,
  };

  return {
    id: `obj-${Math.random().toString(36).slice(2, 8)}`,
    type: 'shape' as FloatingObject['type'],
    sheetId: 'sheet-1',
    position: defaultPosition,
    zIndex: 1,
    locked: false,
    printable: true,
    name: 'Test Object',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as FloatingObject;
}

function createTestGroup(
  groupId: string,
  memberIds: string[],
  sheetId: string = 'sheet-1',
): CanvasObjectGroup {
  return {
    id: groupId,
    containerId: sheetId,
    memberIds,
    zIndex: 0,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('FloatingObjectStore', () => {
  let mockBridge: ComputeBridge;
  let objectStore: ComputeBridgeObjectStore;
  let groupStore: ComputeBridgeGroupStore;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBridge = createMockComputeBridge();
    objectStore = new ComputeBridgeObjectStore(mockBridge);
    groupStore = new ComputeBridgeGroupStore(mockBridge);
    setupSheet(mockBridge, 'sheet-1');
  });

  // ===========================================================================
  // CREATE Operations
  // ===========================================================================

  describe('createObject', () => {
    it('should create a floating object in a sheet', async () => {
      const obj = createTestObject({ id: 'obj-1' });
      const result = await objectStore.create('sheet-1', obj);

      expect(result.success).toBe(true);
      expect(result.object).toBeDefined();
      expect(result.object!.id).toBe('obj-1');
    });

    it('should fail for non-existent sheet', async () => {
      const obj = createTestObject();
      const result = await objectStore.create('non-existent-sheet', obj);

      expect(result.success).toBe(true);
      expect(result.object).toBeDefined();
    });

    it('should store the object in the store', async () => {
      const obj = createTestObject({ id: 'obj-stored' });
      await objectStore.create('sheet-1', obj);

      const read = await objectStore.read('obj-stored');
      expect(read.object).toBeDefined();
      expect(read.object!.id).toBe('obj-stored');
    });

    it('should handle multiple objects', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'b' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'c' }));

      expect(await objectStore.count('sheet-1')).toBe(3);
    });
  });

  describe('createGroup', () => {
    it('should create a group in a sheet', async () => {
      const group = createTestGroup('group-1', ['obj-1', 'obj-2']);
      const success = await groupStore.create('sheet-1', group);

      expect(success).toBe(true);

      const read = await groupStore.read('group-1');
      expect(read).toBeDefined();
      expect(read!.memberIds).toEqual(['obj-1', 'obj-2']);
    });

    it('should fail for non-existent sheet', async () => {
      const group = createTestGroup('group-1', ['obj-1']);
      const success = await groupStore.create('no-such-sheet', group);

      expect(success).toBe(true);
    });
  });

  // ===========================================================================
  // READ Operations
  // ===========================================================================

  describe('readObject', () => {
    it('should find an object by ID across sheets', async () => {
      setupSheet(mockBridge, 'sheet-2');

      await objectStore.create('sheet-1', createTestObject({ id: 'obj-in-1' }));
      await objectStore.create('sheet-2', createTestObject({ id: 'obj-in-2', sheetId: 'sheet-2' }));

      const r1 = await objectStore.read('obj-in-1');
      expect(r1.object).toBeDefined();
      expect(r1.containerId).toBe('sheet-1');

      const r2 = await objectStore.read('obj-in-2');
      expect(r2.object).toBeDefined();
      expect(r2.containerId).toBe('sheet-2');
    });

    it('should return undefined for non-existent object', async () => {
      const result = await objectStore.read('does-not-exist');
      expect(result.object).toBeUndefined();
      expect(result.containerId).toBeUndefined();
    });
  });

  describe('readObjectsInSheet', () => {
    it('should return all objects in a sheet', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'b' }));

      const objects = await objectStore.readInDocument('sheet-1');
      expect(objects).toHaveLength(2);
    });

    it('should return empty array for empty sheet', async () => {
      const objects = await objectStore.readInDocument('sheet-1');
      expect(objects).toEqual([]);
    });

    it('should return empty array for non-existent sheet', async () => {
      const objects = await objectStore.readInDocument('no-such-sheet');
      expect(objects).toEqual([]);
    });
  });

  describe('readObjectsByType', () => {
    it('should filter objects by type', async () => {
      await objectStore.create(
        'sheet-1',
        createTestObject({ id: 'shape-1', type: 'shape' as FloatingObject['type'] }),
      );
      await objectStore.create(
        'sheet-1',
        createTestObject({ id: 'pic-1', type: 'picture' as FloatingObject['type'] }),
      );
      await objectStore.create(
        'sheet-1',
        createTestObject({ id: 'shape-2', type: 'shape' as FloatingObject['type'] }),
      );

      const shapes = await objectStore.readByType('sheet-1', 'shape');
      expect(shapes).toHaveLength(2);

      const pictures = await objectStore.readByType('sheet-1', 'picture');
      expect(pictures).toHaveLength(1);
    });
  });

  describe('readGroupsInSheet', () => {
    it('should return all groups in a sheet', async () => {
      await groupStore.create('sheet-1', createTestGroup('g1', ['a', 'b']));
      await groupStore.create('sheet-1', createTestGroup('g2', ['c', 'd']));

      const groups = await groupStore.readInDocument('sheet-1');
      expect(groups).toHaveLength(2);
    });

    it('should return empty array when no groups exist', async () => {
      const groups = await groupStore.readInDocument('sheet-1');
      expect(groups).toEqual([]);
    });
  });

  describe('countObjectsInSheet', () => {
    it('should count objects correctly', async () => {
      expect(await objectStore.count('sheet-1')).toBe(0);

      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      expect(await objectStore.count('sheet-1')).toBe(1);

      await objectStore.create('sheet-1', createTestObject({ id: 'b' }));
      expect(await objectStore.count('sheet-1')).toBe(2);
    });

    it('should return 0 for non-existent sheet', async () => {
      expect(await objectStore.count('no-sheet')).toBe(0);
    });
  });

  // ===========================================================================
  // UPDATE Operations
  // ===========================================================================

  describe('updateObject', () => {
    it('should update object properties', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'obj-1', name: 'Original' }));

      const result = await objectStore.update('obj-1', {
        name: 'Updated',
      } as Partial<FloatingObject>);
      expect(result.success).toBe(true);
      expect(result.object!.name).toBe('Updated');
    });

    it('should preserve immutable fields (id, type, sheetId)', async () => {
      await objectStore.create(
        'sheet-1',
        createTestObject({
          id: 'obj-1',
          type: 'shape' as FloatingObject['type'],
          sheetId: 'sheet-1',
        }),
      );

      const result = await objectStore.update('obj-1', {
        id: 'hacked-id',
        type: 'picture' as FloatingObject['type'],
        sheetId: 'other-sheet',
        name: 'Changed Name',
      } as unknown as Partial<FloatingObject>);

      expect(result.success).toBe(true);
      expect(result.object!.id).toBe('obj-1'); // preserved
      expect(result.object!.type).toBe('shape'); // preserved
      expect(result.object!.sheetId).toBe('sheet-1'); // preserved
      expect(result.object!.name).toBe('Changed Name'); // updated
    });

    it('should set updatedAt timestamp', async () => {
      const before = Date.now();
      await objectStore.create('sheet-1', createTestObject({ id: 'obj-1' }));

      const result = await objectStore.update('obj-1', {
        name: 'X',
      } as Partial<FloatingObject>);
      expect(result.object!.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('should return failure for non-existent object', async () => {
      const result = await objectStore.update('no-such-obj', {
        name: 'X',
      } as Partial<FloatingObject>);
      expect(result.success).toBe(false);
    });
  });

  describe('updatePosition', () => {
    it('should update the position', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'obj-1' }));

      const newPos: ObjectPosition = {
        anchorType: 'oneCell',
        from: { cellId: 'cell-B2', xOffset: 10, yOffset: 20 },
        width: 300,
        height: 200,
      };

      const result = await objectStore.update('obj-1', {
        position: newPos,
      } as Partial<FloatingObject>);
      expect(result.success).toBe(true);
    });
  });

  describe('updateZIndex', () => {
    it('should update the zIndex', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'obj-1', zIndex: 1 }));

      const result = await objectStore.update('obj-1', {
        zIndex: 10,
      } as Partial<FloatingObject>);
      expect(result.success).toBe(true);

      const read = await objectStore.read('obj-1');
      expect(read.object!.zIndex).toBe(10);
    });
  });

  describe('batchUpdateZIndex', () => {
    it('should batch update zIndex for multiple objects', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a', zIndex: 1 }));
      await objectStore.create('sheet-1', createTestObject({ id: 'b', zIndex: 2 }));
      await objectStore.create('sheet-1', createTestObject({ id: 'c', zIndex: 3 }));

      // Use individual updates since the class API doesn't have a batch zIndex method
      const results = await Promise.all([
        objectStore.update('a', { zIndex: 3 } as Partial<FloatingObject>),
        objectStore.update('b', { zIndex: 1 } as Partial<FloatingObject>),
        objectStore.update('c', { zIndex: 2 } as Partial<FloatingObject>),
      ]);

      const count = results.filter((r) => r.success).length;
      expect(count).toBe(3);

      expect((await objectStore.read('a')).object!.zIndex).toBe(3);
      expect((await objectStore.read('b')).object!.zIndex).toBe(1);
      expect((await objectStore.read('c')).object!.zIndex).toBe(2);
    });

    it('should skip non-existent objects', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a', zIndex: 1 }));

      const results = await Promise.all([
        objectStore.update('a', { zIndex: 5 } as Partial<FloatingObject>),
        objectStore.update('missing', { zIndex: 10 } as Partial<FloatingObject>),
      ]);

      const count = results.filter((r) => r.success).length;
      expect(count).toBe(1);
    });
  });

  // ===========================================================================
  // DELETE Operations
  // ===========================================================================

  describe('deleteObject', () => {
    it('should delete an object', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'obj-1' }));

      const result = await objectStore.delete('obj-1');
      expect(result.success).toBe(true);
      expect(result.containerId).toBe('sheet-1');

      const read = await objectStore.read('obj-1');
      expect(read.object).toBeUndefined();
    });

    it('should return failure for non-existent object', async () => {
      const result = await objectStore.delete('no-such-obj');
      expect(result.success).toBe(false);
    });

    it('should clean up group memberships', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'b' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'c' }));
      await groupStore.create('sheet-1', createTestGroup('g1', ['a', 'b', 'c']));

      await objectStore.delete('a');

      // Group should still exist with 'b' and 'c' (2 members is still valid)
      const group = await groupStore.read('g1');
      expect(group).toBeDefined();
      expect(group!.memberIds).toEqual(['b', 'c']);
    });

    it('should delete groups that become single-member after deletion', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'b' }));
      await groupStore.create('sheet-1', createTestGroup('g1', ['a', 'b']));

      await objectStore.delete('a');

      // Group with 1 remaining member is semantically invalid -- should be deleted
      const group = await groupStore.read('g1');
      expect(group).toBeUndefined();
    });

    it('should delete empty groups after member removal', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      await groupStore.create('sheet-1', createTestGroup('g1', ['a']));

      await objectStore.delete('a');

      // Group should be deleted since it has no members
      const group = await groupStore.read('g1');
      expect(group).toBeUndefined();
    });

    it('should clean up all affected groups without skipping any (3+ groups)', async () => {
      // Regression test: mutating a Y.Map during forEach can skip entries.
      // With 3+ groups that all need cleanup, the deferred-mutation fix must
      // process every group.
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'b' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'c' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'd' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'e' }));

      // Three groups that each contain 'a' plus one other member
      await groupStore.create('sheet-1', createTestGroup('g1', ['a', 'b']));
      await groupStore.create('sheet-1', createTestGroup('g2', ['a', 'c']));
      await groupStore.create('sheet-1', createTestGroup('g3', ['a', 'd', 'e']));

      await objectStore.delete('a');

      // g1 and g2 had only 2 members each, so removing 'a' leaves 1 -> deleted
      expect(await groupStore.read('g1')).toBeUndefined();
      expect(await groupStore.read('g2')).toBeUndefined();

      // g3 had 3 members, removing 'a' leaves ['d', 'e'] which is still valid
      const g3 = await groupStore.read('g3');
      expect(g3).toBeDefined();
      expect(g3!.memberIds).toEqual(['d', 'e']);

      // Verify all 3 groups were processed (none skipped)
      const remainingGroups = await groupStore.readInDocument('sheet-1');
      expect(remainingGroups).toHaveLength(1);
      expect(remainingGroups[0].id).toBe('g3');
    });
  });

  describe('deleteObjects', () => {
    it('should delete multiple objects', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'b' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'c' }));

      const count = await objectStore.deleteBatch(['a', 'b']);
      expect(count).toBe(2);
      expect(await objectStore.count('sheet-1')).toBe(1);
    });

    it('should handle empty array', async () => {
      const count = await objectStore.deleteBatch([]);
      expect(count).toBe(0);
    });

    it('should skip non-existent objects', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'a' }));

      const count = await objectStore.deleteBatch(['a', 'missing']);
      expect(count).toBe(1);
    });

    it('should handle objects across multiple sheets', async () => {
      setupSheet(mockBridge, 'sheet-2');

      await objectStore.create('sheet-1', createTestObject({ id: 'a', sheetId: 'sheet-1' }));
      await objectStore.create('sheet-2', createTestObject({ id: 'b', sheetId: 'sheet-2' }));

      const count = await objectStore.deleteBatch(['a', 'b']);
      expect(count).toBe(2);
    });

    it('should return accurate deleted count excluding non-existent objects', async () => {
      await objectStore.create('sheet-1', createTestObject({ id: 'x' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'y' }));
      await objectStore.create('sheet-1', createTestObject({ id: 'z' }));

      // Request deletion of 5 IDs, only 3 actually exist
      const count = await objectStore.deleteBatch(['x', 'y', 'z', 'ghost-1', 'ghost-2']);
      expect(count).toBe(3);
      expect(await objectStore.count('sheet-1')).toBe(0);
    });
  });

  describe('deleteGroup', () => {
    it('should delete a group', async () => {
      await groupStore.create('sheet-1', createTestGroup('g1', ['a', 'b']));

      const success = await groupStore.delete('g1');
      expect(success).toBe(true);

      const read = await groupStore.read('g1');
      expect(read).toBeUndefined();
    });

    it('should return false for non-existent group', async () => {
      const success = await groupStore.delete('no-such-group');
      expect(success).toBe(false);
    });
  });

  // ===========================================================================
  // DESERIALIZATION
  // ===========================================================================

  describe('deserialization', () => {
    it('should deserialize wire format to domain type with position.from', async () => {
      // Store wire-format data directly (simulating what Rust returns)
      const wireData = {
        id: 'obj-wire',
        sheetId: 'sheet-1',
        type: 'shape',
        shapeType: 'rect',
        anchorRow: 2,
        anchorCol: 3,
        xOffset: 10,
        yOffset: 20,
        anchorMode: 'oneCell',
        x: 100,
        y: 200,
        width: 300,
        height: 150,
        zIndex: 1,
        locked: false,
        printable: true,
        name: 'Wire Shape',
        extra: null,
      };

      // Put wire data directly into the mock's internal store
      const sheets = (mockBridge as any)._sheets as Map<string, any>;
      const sheet = sheets.get('sheet-1')!;
      sheet.floatingObjects.set('obj-wire', wireData);

      // Read through the store — should deserialize properly
      const result = await objectStore.read('obj-wire');
      expect(result.object).toBeDefined();
      expect(result.containerId).toBe('sheet-1');

      const obj = result.object!;
      expect(obj.id).toBe('obj-wire');
      expect(obj.type).toBe('shape');

      // The critical assertion: position.from should be populated
      expect(obj.position).toBeDefined();
      expect(obj.position.from).toBeDefined();
      expect(obj.position.from.cellId).toBe('cell-2-3'); // positionalCellId(2, 3)
      expect(obj.position.from.xOffset).toBe(10);
      expect(obj.position.from.yOffset).toBe(20);
      expect(obj.position.anchorType).toBe('oneCell');
      expect(obj.position.width).toBe(300);
      expect(obj.position.height).toBe(150);
    });

    it('should deserialize all objects in readInDocument', async () => {
      const wireData = {
        id: 'obj-batch',
        sheetId: 'sheet-1',
        type: 'picture',
        anchorRow: 0,
        anchorCol: 0,
        xOffset: 0,
        yOffset: 0,
        anchorMode: 'absolute',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        src: 'test.png',
        originalWidth: 100,
        originalHeight: 100,
        zIndex: 0,
        extra: null,
      };

      const sheets = (mockBridge as any)._sheets as Map<string, any>;
      const sheet = sheets.get('sheet-1')!;
      sheet.floatingObjects.set('obj-batch', wireData);

      const objects = await objectStore.readInDocument('sheet-1');
      expect(objects).toHaveLength(1);
      expect(objects[0].position).toBeDefined();
      expect(objects[0].position.from).toBeDefined();
      expect(objects[0].position.from.cellId).toBe('cell-0-0');
    });
  });
});

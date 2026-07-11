import { jest } from '@jest/globals';

import { WorksheetObjectCollectionImpl } from '../object-collection-impl';
import { WorksheetShapeCollectionImpl } from '../shape-collection-impl';
import { ShapeHandleImpl } from '../../handles/shape-handle-impl';
import type { WorksheetObjectsImpl } from '../../objects';

function mutationReceipt(id = 'shape-1') {
  return {
    kind: 'floatingObject.create' as const,
    status: 'applied' as const,
    effects: [
      {
        type: 'createdObject' as const,
        sheetId: 'sheet-1',
        objectId: id,
        details: { objectType: 'shape' },
      },
      {
        type: 'invalidatedCache' as const,
        sheetId: 'sheet-1',
        objectId: id,
        details: { cache: 'floatingObjects' },
      },
    ],
    diagnostics: [],
    sheetId: 'sheet-1',
    domain: 'floatingObject' as const,
    action: 'create' as const,
    id,
    object: { id, type: 'shape' },
    bounds: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
  };
}

function removeReceipt(id = 'shape-1') {
  return {
    kind: 'floatingObject.remove' as const,
    status: 'applied' as const,
    effects: [
      {
        type: 'removedObject' as const,
        sheetId: 'sheet-1',
        objectId: id,
        details: { objectType: 'floatingObject' },
      },
    ],
    diagnostics: [],
    sheetId: 'sheet-1',
    domain: 'floatingObject' as const,
    action: 'remove' as const,
    id,
  };
}

function createMockObjectsImpl(): jest.Mocked<WorksheetObjectsImpl> {
  return {
    sheetIdForReceipts: jest.fn().mockReturnValue('sheet-1'),
    addShape: jest.fn().mockResolvedValue(mutationReceipt()),
    get: jest.fn().mockResolvedValue({ id: 'shape-1', type: 'shape' }),
    remove: jest.fn().mockResolvedValue(removeReceipt()),
  } as unknown as jest.Mocked<WorksheetObjectsImpl>;
}

describe('floating object collection receipts', () => {
  it('shape add returns a receipt that preserves the created handle', async () => {
    const objects = createMockObjectsImpl();
    const shapes = new WorksheetShapeCollectionImpl(objects, null);

    const receipt = await shapes.add({ type: 'rect' });

    expect(receipt.kind).toBe('floatingObject.create');
    expect(receipt.status).toBe('applied');
    expect(receipt.id).toBe('shape-1');
    expect(receipt.handle).toBeInstanceOf(ShapeHandleImpl);
    expect(receipt).toBeInstanceOf(ShapeHandleImpl);
  });

  it('object remove propagates the strict missing-target error', async () => {
    const objects = createMockObjectsImpl();
    objects.remove.mockRejectedValue(new Error('missing object'));
    const collection = new WorksheetObjectCollectionImpl(objects, null);

    await expect(collection.remove('missing-1')).rejects.toThrow('missing object');
  });

  it('object remove returns true when the object is deleted', async () => {
    const objects = createMockObjectsImpl();
    const collection = new WorksheetObjectCollectionImpl(objects, null);

    await expect(collection.remove('shape-1')).resolves.toBe(true);
    expect(objects.remove).toHaveBeenCalledWith('shape-1');
  });
});

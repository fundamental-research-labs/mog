/**
 * Shape Operations — Receipt Construction Tests
 *
 * Validates that shape operations return correctly typed MutationReceipts
 * with the expected domain, action, objectId, and bounds.
 *
 * @see shape-operations.ts - Implementation
 * @see contracts/src/api/mutation-receipt.ts - Receipt type definitions
 */

import { jest } from '@jest/globals';

import type {
  FloatingObjectRemoveReceipt,
  FloatingObjectMutationReceipt,
} from '@mog-sdk/contracts/api';
import { sheetId } from '@mog-sdk/contracts/core';

import { createShape, deleteShape, duplicateShape, updateShape } from '../shape-operations';

// =============================================================================
// Mock Helpers
// =============================================================================

const SHEET_ID = sheetId('sheet-1');

/**
 * Create a mock DocumentContext with a computeBridge that returns the given
 * floatingObjectChanges from createShape / deleteFloatingObject.
 */
function createMockCtx(overrides?: {
  floatingObjectChanges?: Array<{
    objectId: string;
    objectType?: string;
    kind: { type: string };
    data?: Record<string, unknown>;
    bounds?: { x: number; y: number; width: number; height: number; rotation: number };
  }>;
  currentWire?: Record<string, unknown> | null;
}) {
  const changes = overrides?.floatingObjectChanges ?? [];
  const mutationResult = { floatingObjectChanges: changes };
  return {
    clock: {
      now: jest.fn(() => 1_700_000_000_000),
    },
    computeBridge: {
      createShape: jest.fn().mockResolvedValue(mutationResult),
      deleteFloatingObject: jest.fn().mockResolvedValue({}),
      getFloatingObjectTyped: jest.fn().mockResolvedValue(
        overrides?.currentWire ?? {
          id: 'shape-1',
          type: 'shape',
          sheetId: SHEET_ID,
          anchor: {
            anchorRow: 1,
            anchorCol: 2,
            anchorRowOffsetEmu: 19_050,
            anchorColOffsetEmu: 9_525,
            anchorMode: 'oneCell',
          },
          width: 100,
          height: 50,
        },
      ),
      updateFloatingObject: jest.fn().mockResolvedValue(mutationResult),
      updateShapeStyle: jest.fn().mockResolvedValue(mutationResult),
      resizeFloatingObjectTyped: jest.fn().mockResolvedValue(mutationResult),
      moveFloatingObjectTyped: jest.fn().mockResolvedValue(mutationResult),
      rotateFloatingObjectTyped: jest.fn().mockResolvedValue(mutationResult),
      duplicateFloatingObjectTyped: jest.fn().mockResolvedValue(mutationResult),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'user-1',
      requestingDocumentId: 'workbook-1',
      requestingSessionId: 'session-1',
    })),
  } as any;
}

function expectShapeAdmissionOptions(operationIdPrefix: string, groupId?: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      sheetIds: [SHEET_ID],
      domainIds: ['floating-objects.anchors'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      ...(groupId ? { groupId } : {}),
    }),
  });
}

function lastCallArg(mock: jest.Mock, indexFromEnd = 0): unknown {
  const call = mock.mock.calls.at(-1);
  if (!call) return undefined;
  return call[call.length - 1 - indexFromEnd];
}

// =============================================================================
// 6b: createShape() receipt construction
// =============================================================================

describe('createShape — receipt construction', () => {
  it('returns a FloatingObjectMutationReceipt with domain=floatingObject, action=create', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-new-1',
          objectType: 'shape',
          kind: { type: 'created' },
          data: { id: 'shape-new-1', type: 'shape', shapeType: 'rect' },
          bounds: { x: 10, y: 20, width: 200, height: 150, rotation: 0 },
        },
      ],
    });

    const receipt: FloatingObjectMutationReceipt = await createShape(ctx, SHEET_ID, {
      type: 'rect',
      anchorRow: 0,
      anchorCol: 0,
      width: 200,
      height: 150,
    });

    expect(ctx.computeBridge.createShape).toHaveBeenCalledWith(
      SHEET_ID,
      expect.objectContaining({ shapeType: 'rect' }),
      expectShapeAdmissionOptions('shapes.create'),
    );
    expect(receipt.domain).toBe('floatingObject');
    expect(receipt.action).toBe('create');
  });

  it('contains the correct objectId from the MutationResult', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-abc-123',
          kind: { type: 'created' },
          data: { id: 'shape-abc-123', type: 'shape', shapeType: 'ellipse' },
          bounds: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        },
      ],
    });

    const receipt = await createShape(ctx, SHEET_ID, {
      type: 'ellipse',
      anchorRow: 0,
      anchorCol: 0,
      width: 100,
      height: 100,
    });

    expect(receipt.id).toBe('shape-abc-123');
  });

  it('contains bounds from the MutationResult', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-1',
          kind: { type: 'created' },
          data: { id: 'shape-1', type: 'shape', shapeType: 'rect' },
          bounds: { x: 50, y: 75, width: 300, height: 200, rotation: 45 },
        },
      ],
    });

    const receipt = await createShape(ctx, SHEET_ID, {
      type: 'rect',
      anchorRow: 0,
      anchorCol: 0,
      width: 300,
      height: 200,
    });

    expect(receipt.bounds).toEqual({
      x: 50,
      y: 75,
      width: 300,
      height: 200,
      rotation: 45,
    });
  });

  it('builds a receipt when the bridge omits optional object data', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-minimal-1',
          kind: { type: 'created' },
          bounds: { x: 15, y: 25, width: 120, height: 80, rotation: 5 },
        },
      ],
    });

    const receipt = await createShape(ctx, SHEET_ID, {
      type: 'rect',
      anchorRow: 0,
      anchorCol: 0,
      width: 120,
      height: 80,
    });

    expect(receipt.id).toBe('shape-minimal-1');
    expect(receipt.object.id).toBe('shape-minimal-1');
    expect(receipt.bounds).toEqual({
      x: 15,
      y: 25,
      width: 120,
      height: 80,
      rotation: 5,
    });
  });

  it('throws when no created object ID is returned', async () => {
    const ctx = createMockCtx({ floatingObjectChanges: [] });

    await expect(
      createShape(ctx, SHEET_ID, {
        type: 'rect',
        anchorRow: 0,
        anchorCol: 0,
        width: 200,
        height: 200,
      }),
    ).rejects.toThrow('mutation returned no object ID');
  });

  it('throws when a bridge change has no object ID', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: '',
          kind: { type: 'created' },
          data: { id: '', type: 'shape', shapeType: 'rect' },
          bounds: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        },
      ],
    });

    await expect(
      createShape(ctx, SHEET_ID, {
        type: 'rect',
        anchorRow: 0,
        anchorCol: 0,
        width: 100,
        height: 100,
      }),
    ).rejects.toThrow('mutation returned no object ID');
  });
});

// =============================================================================
// 6b: updateShape() receipt construction
// =============================================================================

describe('updateShape — receipt construction', () => {
  it('returns no-op receipt for an empty update without invoking bridge mutations', async () => {
    const ctx = createMockCtx();

    const receipt = await updateShape(ctx, SHEET_ID, 'shape-1', {});

    expect(receipt).toEqual(
      expect.objectContaining({
        domain: 'floatingObject',
        action: 'update',
        id: 'shape-1',
        kind: 'floatingObject.update',
        status: 'noOp',
      }),
    );
    expect(ctx.computeBridge.updateFloatingObject).not.toHaveBeenCalled();
    expect(ctx.computeBridge.resizeFloatingObjectTyped).not.toHaveBeenCalled();
    expect(ctx.computeBridge.moveFloatingObjectTyped).not.toHaveBeenCalled();
    expect(ctx.computeBridge.rotateFloatingObjectTyped).not.toHaveBeenCalled();
  });

  it('preserves the current height when only width is updated', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-1',
          kind: { type: 'updated' },
          data: { id: 'shape-1', type: 'shape', shapeType: 'rect' },
          bounds: { x: 0, y: 0, width: 240, height: 80, rotation: 0 },
        },
      ],
      currentWire: {
        id: 'shape-1',
        type: 'shape',
        sheetId: SHEET_ID,
        anchor: {
          anchorRow: 1,
          anchorCol: 2,
          anchorRowOffsetEmu: 0,
          anchorColOffsetEmu: 0,
          anchorMode: 'oneCell',
        },
        width: 120,
        height: 80,
      },
    });

    const receipt = await updateShape(ctx, SHEET_ID, 'shape-1', { width: 240 });

    expect(ctx.computeBridge.resizeFloatingObjectTyped).toHaveBeenCalledWith(
      SHEET_ID,
      'shape-1',
      {
        width: 240,
        height: 80,
      },
      expectShapeAdmissionOptions('shapes.update'),
    );
    expect(receipt.status).toBe('applied');
  });

  it('preserves mutation bounds when update change omits optional object data', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-1',
          kind: { type: 'updated' },
          bounds: { x: 5, y: 10, width: 240, height: 80, rotation: 15 },
        },
      ],
      currentWire: {
        id: 'shape-1',
        type: 'shape',
        sheetId: SHEET_ID,
        anchor: {
          anchorRow: 1,
          anchorCol: 2,
          anchorRowOffsetEmu: 0,
          anchorColOffsetEmu: 0,
          anchorMode: 'oneCell',
        },
        width: 120,
        height: 80,
      },
    });

    const receipt = await updateShape(ctx, SHEET_ID, 'shape-1', { width: 240 });

    expect(receipt.id).toBe('shape-1');
    expect(receipt.bounds).toEqual({
      x: 5,
      y: 10,
      width: 240,
      height: 80,
      rotation: 15,
    });
  });

  it('uses current anchor values for omitted absolute move fields', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-1',
          kind: { type: 'updated' },
          data: { id: 'shape-1', type: 'shape', shapeType: 'rect' },
          bounds: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
        },
      ],
      currentWire: {
        id: 'shape-1',
        type: 'shape',
        sheetId: SHEET_ID,
        anchor: {
          anchorRow: 3,
          anchorCol: 4,
          anchorRowOffsetEmu: 19_050,
          anchorColOffsetEmu: 9_525,
          anchorMode: 'oneCell',
        },
        width: 100,
        height: 50,
      },
    });

    await updateShape(ctx, SHEET_ID, 'shape-1', { anchorRow: 8, yOffset: 12 });

    expect(ctx.computeBridge.moveFloatingObjectTyped).toHaveBeenCalledWith(
      SHEET_ID,
      'shape-1',
      {
        type: 'absolute',
        anchorRow: 8,
        anchorCol: 4,
        xOffset: 1,
        yOffset: 12,
      },
      expectShapeAdmissionOptions('shapes.update'),
    );
  });

  it('uses one grouped operation context for multi-step shape updates', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-1',
          kind: { type: 'updated' },
          data: { id: 'shape-1', type: 'shape', shapeType: 'rect' },
          bounds: { x: 0, y: 0, width: 240, height: 80, rotation: 30 },
        },
      ],
      currentWire: {
        id: 'shape-1',
        type: 'shape',
        sheetId: SHEET_ID,
        anchor: {
          anchorRow: 3,
          anchorCol: 4,
          anchorRowOffsetEmu: 0,
          anchorColOffsetEmu: 0,
          anchorMode: 'oneCell',
        },
        width: 120,
        height: 80,
      },
    });

    await updateShape(ctx, SHEET_ID, 'shape-1', {
      fill: { type: 'solid', color: '#ff0000' } as any,
      name: 'Updated',
      width: 240,
      anchorRow: 8,
      rotation: 30,
    });

    const options = [
      lastCallArg(ctx.computeBridge.updateShapeStyle),
      lastCallArg(ctx.computeBridge.updateFloatingObject),
      lastCallArg(ctx.computeBridge.resizeFloatingObjectTyped),
      lastCallArg(ctx.computeBridge.moveFloatingObjectTyped),
      lastCallArg(ctx.computeBridge.rotateFloatingObjectTyped),
    ] as Array<{ operationContext: { groupId?: string } }>;
    const groupId = options[0].operationContext.groupId;

    for (const option of options) {
      expect(option).toEqual(expectShapeAdmissionOptions('shapes.update', groupId));
    }
  });
});

describe('duplicateShape — receipt construction', () => {
  it('builds a receipt when the bridge omits optional object data', async () => {
    const ctx = createMockCtx({
      floatingObjectChanges: [
        {
          objectId: 'shape-copy-1',
          kind: { type: 'created' },
          bounds: { x: 25, y: 35, width: 160, height: 90, rotation: 0 },
        },
      ],
    });

    const receipt = await duplicateShape(ctx, SHEET_ID, 'shape-1');

    expect(receipt.id).toBe('shape-copy-1');
    expect(receipt.object.id).toBe('shape-copy-1');
    expect(receipt.bounds).toEqual({
      x: 25,
      y: 35,
      width: 160,
      height: 90,
      rotation: 0,
    });
  });
});

// =============================================================================
// 6b: deleteShape() receipt construction
// =============================================================================

describe('deleteShape — receipt construction', () => {
  it('returns a FloatingObjectRemoveReceipt with domain=floatingObject, action=remove', async () => {
    const ctx = createMockCtx();

    const receipt: FloatingObjectRemoveReceipt = await deleteShape(
      ctx,
      SHEET_ID,
      'shape-to-delete',
    );

    expect(receipt.domain).toBe('floatingObject');
    expect(receipt.action).toBe('remove');
  });

  it('contains the correct objectId', async () => {
    const ctx = createMockCtx();

    const receipt = await deleteShape(ctx, SHEET_ID, 'shape-xyz-789');

    expect(receipt.id).toBe('shape-xyz-789');
  });
});

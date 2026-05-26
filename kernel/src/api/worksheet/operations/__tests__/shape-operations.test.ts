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

import { createShape, deleteShape } from '../shape-operations';

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
}) {
  const changes = overrides?.floatingObjectChanges ?? [];
  return {
    computeBridge: {
      createShape: jest.fn().mockResolvedValue({
        floatingObjectChanges: changes,
      }),
      deleteFloatingObject: jest.fn().mockResolvedValue({}),
    },
  } as any;
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

  it('returns fallback receipt when no floatingObjectChanges returned', async () => {
    const ctx = createMockCtx({ floatingObjectChanges: [] });

    const receipt = await createShape(ctx, SHEET_ID, {
      type: 'rect',
      anchorRow: 0,
      anchorCol: 0,
      width: 200,
      height: 200,
    });

    // Should still return a valid receipt structure
    expect(receipt.domain).toBe('floatingObject');
    expect(receipt.action).toBe('create');
    expect(receipt.bounds).toBeDefined();
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

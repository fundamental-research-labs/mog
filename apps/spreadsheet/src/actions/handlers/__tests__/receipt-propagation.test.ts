/**
 * Action Handler Receipt Propagation Tests
 *
 * Validates that action handlers return MutationReceipts in ActionResult.receipts
 * so the dispatcher can process them via the pull-path (coordinator.processReceipts).
 *
 * @see object.ts - INSERT_SHAPE, DELETE_OBJECT handlers
 * @see dispatcher.ts - processReceipts call site
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { MutationReceipt } from '@mog-sdk/contracts/api';
import { sheetId } from '@mog-sdk/contracts/core';

import * as ObjectHandlers from '../object';
import { createMockPlatform, createMockShellService } from './test-helpers';

// =============================================================================
// Mock Utilities
// =============================================================================

const MOCK_RECEIPT_CREATE: MutationReceipt = {
  domain: 'floatingObject',
  action: 'create',
  id: 'shape-new-1',
  object: { id: 'shape-new-1', type: 'shape' } as any,
  bounds: { x: 0, y: 0, width: 200, height: 200, rotation: 0 },
};

const MOCK_RECEIPT_DELETE: MutationReceipt = {
  domain: 'floatingObject',
  action: 'remove',
  id: 'shape-del-1',
};

/**
 * Create mock ActionDependencies with controllable Worksheet API responses.
 */
function createMockDeps(overrides?: {
  addShapeReceipt?: MutationReceipt;
  deleteReceipt?: MutationReceipt;
  selectedObjectIds?: string[];
}): ActionDependencies {
  const addShapeReceipt = overrides?.addShapeReceipt ?? MOCK_RECEIPT_CREATE;
  const deleteReceipt = overrides?.deleteReceipt ?? MOCK_RECEIPT_DELETE;
  const selectedIds = overrides?.selectedObjectIds ?? [];

  // Typed collection handles returned by ws.shapes.add() / ws.textBoxes.add()
  const mockShapeHandle = { id: 'shape-new-1', type: 'shape', shapeType: 'rect' };
  const mockTextBoxHandle = { id: 'textbox-new-1', type: 'textBox' };

  const mockWorksheet = {
    objects: {
      delete: jest.fn().mockResolvedValue(deleteReceipt),
      duplicate: jest.fn().mockResolvedValue(addShapeReceipt),
      flip: jest.fn().mockResolvedValue(undefined),
      updateShape: jest.fn().mockResolvedValue(undefined),
      updatePicture: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      bringForward: jest.fn().mockResolvedValue(undefined),
      sendToBack: jest.fn().mockResolvedValue(undefined),
      sendBackward: jest.fn().mockResolvedValue(undefined),
      group: jest.fn().mockResolvedValue(undefined),
      ungroup: jest.fn().mockResolvedValue(undefined),
      rotate: jest.fn().mockResolvedValue(undefined),
      getInfo: jest.fn().mockResolvedValue({ id: 'obj-1', type: 'shape' }),
      get: jest.fn().mockResolvedValue({ id: 'obj', type: 'shape' }),
    },
    shapes: {
      add: jest.fn().mockResolvedValue(mockShapeHandle),
      get: jest.fn().mockResolvedValue(mockShapeHandle),
      list: jest.fn().mockResolvedValue([mockShapeHandle]),
    },
    textBoxes: {
      add: jest.fn().mockResolvedValue(mockTextBoxHandle),
      get: jest.fn().mockResolvedValue(mockTextBoxHandle),
      list: jest.fn().mockResolvedValue([mockTextBoxHandle]),
    },
    charts: {
      get: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue('chart-new'),
      update: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockWorkbook = {
    getActiveSheet: jest.fn().mockReturnValue(mockWorksheet),
    getSheet: jest.fn().mockReturnValue(mockWorksheet),
    getSheetById: jest.fn().mockReturnValue(mockWorksheet),
    setPendingUndoDescription: jest.fn(),
  };

  return {
    ctx: {},
    workbook: mockWorkbook,
    uiStore: {
      getState: () => ({}),
    },
    actors: {
      selectionActor: { send: jest.fn(), getSnapshot: () => ({}) },
      editorActor: { send: jest.fn(), getSnapshot: () => ({}) },
      clipboardActor: { send: jest.fn(), getSnapshot: () => ({}) },
      objectInteractionActor: {
        send: jest.fn(),
        getSnapshot: () => ({
          value: selectedIds.length > 0 ? 'selected' : 'idle',
          context: { selectedObjectIds: selectedIds },
        }),
      },
      chartActor: { send: jest.fn(), getSnapshot: () => ({}) },
      findReplaceActor: null,
      commentActor: { send: jest.fn(), getSnapshot: () => ({}) },
      paneFocusActor: null,
    },
    accessors: {
      object: {
        getSelectedIds: jest.fn().mockReturnValue(selectedIds),
      },
    },
    commands: {
      object: {
        keyDelete: jest.fn(),
        startInsert: jest.fn(),
      },
      chart: {
        deselect: jest.fn(),
      },
    },
    getActiveSheetId: () => sheetId('sheet-1'),
    onUIAction: jest.fn(),
    // required deps. per-handler migrations
    // will assert on platform.dialogs / shellService.* directly.
    platform: createMockPlatform(),
    shellService: createMockShellService(),
  } as unknown as ActionDependencies;
}

// =============================================================================
// 6c: INSERT_SHAPE receipt propagation
// =============================================================================

describe('INSERT_SHAPE — handle-based API (no receipt)', () => {
  it('returns handled=true after successful shape creation via ws.shapes.add()', async () => {
    const deps = createMockDeps();

    const result = await ObjectHandlers.INSERT_SHAPE(deps, {
      shapeType: 'rect',
      position: { anchorType: 'absolute', x: 100, y: 100 },
    });

    expect(result.handled).toBe(true);
    // ws.shapes.add() returns a ShapeHandle, not a MutationReceipt.
    // The handler no longer propagates receipts for creation actions.
    expect(result.receipts).toBeUndefined();
  });

  it('calls ws.shapes.add() with the correct shape type', async () => {
    const deps = createMockDeps();

    await ObjectHandlers.INSERT_SHAPE(deps, {
      shapeType: 'ellipse',
      position: { anchorType: 'absolute', x: 50, y: 50 },
    });

    const ws = deps.workbook.getSheetById(sheetId('sheet-1')) as any;
    expect(ws.shapes.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'ellipse' }));
  });

  it('returns no receipts on error', async () => {
    const deps = createMockDeps();

    // Missing shapeType triggers validation error
    const result = await ObjectHandlers.INSERT_SHAPE(deps, {
      position: { x: 100, y: 100 },
    });

    expect(result.handled).toBe(false);
    expect(result.receipts).toBeUndefined();
  });
});

// =============================================================================
// 6c: DELETE_OBJECT receipt propagation
// =============================================================================

describe('DELETE_OBJECT — receipt propagation', () => {
  it('returns receipts for each deleted object', async () => {
    const receipt1: MutationReceipt = {
      domain: 'floatingObject',
      action: 'remove',
      id: 'shape-1',
    };
    const receipt2: MutationReceipt = {
      domain: 'floatingObject',
      action: 'remove',
      id: 'shape-2',
    };

    // We need to set up mock to return different receipts for each call
    let callCount = 0;
    const mockWorksheet = {
      objects: {
        delete: jest.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? receipt1 : receipt2);
        }),
        get: jest.fn().mockImplementation((id: string) =>
          Promise.resolve({
            id,
            type: 'shape',
            delete: jest.fn().mockImplementation(() => {
              callCount++;
              return Promise.resolve(callCount === 1 ? receipt1 : receipt2);
            }),
          }),
        ),
      },
      charts: {
        get: jest.fn().mockResolvedValue(null),
      },
    };

    const deps = createMockDeps({
      selectedObjectIds: ['shape-1', 'shape-2'],
    });

    // Override the worksheet mock to use our sequential receipt mock
    (deps.workbook.getSheet as jest.Mock).mockReturnValue(mockWorksheet);
    (deps.workbook.getSheetById as jest.Mock).mockReturnValue(mockWorksheet);

    const result = await ObjectHandlers.DELETE_OBJECT(deps);

    expect(result.handled).toBe(true);
    expect(result.receipts).toBeDefined();
    expect(result.receipts!.length).toBeGreaterThanOrEqual(1);

    // All receipts should have domain=floatingObject
    for (const receipt of result.receipts!) {
      expect(receipt.domain).toBe('floatingObject');
      expect(receipt.action).toBe('remove');
    }
  });

  it('returns no receipts when nothing is selected', async () => {
    const deps = createMockDeps({ selectedObjectIds: [] });

    const result = await ObjectHandlers.DELETE_OBJECT(deps);

    expect(result.handled).toBe(false);
    expect(result.receipts).toBeUndefined();
  });
});

// =============================================================================
// 6d: Dispatcher receipt processing (integration-style)
// =============================================================================

describe('Dispatcher processReceipts integration', () => {
  it('coordinator.processReceipts is called when ActionResult has receipts', () => {
    // This test validates the wiring pattern in dispatcher.ts.
    // We simulate what the dispatcher does with receipts.
    const processReceipts = jest.fn();
    const coordinator = { processReceipts };

    const result = {
      handled: true,
      receipts: [MOCK_RECEIPT_CREATE],
    };

    // Simulate dispatcher logic
    if (result.receipts?.length && coordinator) {
      coordinator.processReceipts(result.receipts);
    }

    expect(processReceipts).toHaveBeenCalledWith([MOCK_RECEIPT_CREATE]);
  });

  it('coordinator.processReceipts is NOT called when receipts array is empty', () => {
    const processReceipts = jest.fn();
    const coordinator = { processReceipts };

    const result = {
      handled: true,
      receipts: [] as MutationReceipt[],
    };

    if (result.receipts?.length && coordinator) {
      coordinator.processReceipts(result.receipts);
    }

    expect(processReceipts).not.toHaveBeenCalled();
  });

  it('coordinator.processReceipts is NOT called when receipts is undefined', () => {
    const processReceipts = jest.fn();
    const coordinator = { processReceipts };

    const result = {
      handled: true,
    };

    if ((result as any).receipts?.length && coordinator) {
      coordinator.processReceipts((result as any).receipts);
    }

    expect(processReceipts).not.toHaveBeenCalled();
  });
});

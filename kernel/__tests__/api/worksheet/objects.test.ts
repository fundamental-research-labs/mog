/**
 * Tests for WorksheetObjects floating-object operations:
 * - get(objectId)
 * - update(objectId, updates)
 * - deleteMany(objectIds)
 *
 * These test the operation functions directly (not through WorksheetObjectsImpl)
 * using a mock ComputeBridge via a stubbed DocumentContext.
 */

import { jest } from '@jest/globals';

import type { FloatingObjectBase, ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import {
  addPicture,
  addTextBox,
  deleteManyFloatingObjects,
  getFloatingObject,
  updatePicture,
  updateFloatingObject,
} from '../../../src/api/worksheet/operations/floating-object-operations';
import { createEquation } from '../../../src/api/worksheet/operations/equation-operations';
import { KernelError } from '../../../src/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal position stub. */
const stubPosition: ObjectPosition = {
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  anchorType: 'oneCell',
  from: { cellId: 'c1', xOffset: 10, yOffset: 20 },
};

/** Build a minimal FloatingObjectBase for test fixtures. */
function makeObject(id: string, overrides?: Partial<FloatingObjectBase>): FloatingObjectBase {
  return {
    id,
    type: 'shape',
    name: `Object ${id}`,
    position: stubPosition,
    zIndex: 0,
    ...overrides,
  } as FloatingObjectBase;
}

const SHEET_ID = 'sheet-1';

function expectFloatingObjectMutationOptions(
  operationIdPrefix: string,
  options: { grouped?: boolean } = {},
) {
  const operationContext: Record<string, unknown> = {
    operationId: expect.stringMatching(new RegExp(`^${escapeRegExp(operationIdPrefix)}:`)),
    kind: 'mutation',
    author: expect.objectContaining({ actorKind: 'user' }),
    domainIds: ['floating-objects.anchors'],
    sheetIds: [SHEET_ID],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  };
  if (options.grouped) {
    operationContext.groupId = expect.stringMatching(
      new RegExp(`^${escapeRegExp(operationIdPrefix)}:`),
    );
  }
  return expect.objectContaining({
    operationContext: expect.objectContaining(operationContext),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Mock bridge + context factory
// ---------------------------------------------------------------------------

/**
 * Build a wire-format object that getFloatingObjectTyped returns.
 * The wire format uses `anchor` and flat position fields rather than nested ObjectPosition.
 */
function toWireFormat(obj: FloatingObjectBase) {
  return {
    id: obj.id,
    type: obj.type,
    name: obj.name,
    sheetId: SHEET_ID,
    anchor: {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffset: obj.position?.from?.yOffset ?? 0,
      anchorColOffset: obj.position?.from?.xOffset ?? 0,
    },
    width: obj.position?.width ?? 0,
    height: obj.position?.height ?? 0,
    zIndex: obj.zIndex,
    rotation: obj.position?.rotation ?? 0,
    flipH: obj.position?.flipH ?? false,
    flipV: obj.position?.flipV ?? false,
    locked: obj.locked ?? false,
    printable: obj.printable ?? true,
    visible: obj.visible ?? true,
  };
}

function createMockCtx(objects: FloatingObjectBase[]) {
  const objectMap = new Map(objects.map((o) => [o.id, o]));

  const computeBridge = {
    getFloatingObjectTyped: jest.fn(async (_sheetId: string, id: string) => {
      const obj = objectMap.get(id);
      return obj ? toWireFormat(obj) : null;
    }),
    getAllFloatingObjectsTyped: jest.fn(async (_sheetId: string) =>
      [...objectMap.values()].map(toWireFormat),
    ),
    updateFloatingObject: jest.fn(async () => ({ success: true })),
    moveFloatingObjectTyped: jest.fn(async () => ({ success: true })),
    resizeFloatingObjectTyped: jest.fn(async () => ({ success: true })),
    deleteFloatingObject: jest.fn(async (_sheetId: string, id: string) => {
      if (objectMap.has(id)) {
        objectMap.delete(id);
        return { success: true };
      }
      throw new Error('not found');
    }),
    computeAllObjectBounds: jest.fn(async () => []),
  };

  return { computeBridge } as unknown as Parameters<typeof getFloatingObject>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Floating object operations', () => {
  // =========================================================================
  // get (getFloatingObject)
  // =========================================================================

  describe('getFloatingObject', () => {
    it('returns FloatingObjectInfo when the object exists on the sheet', async () => {
      const obj = makeObject('obj-1');
      const ctx = createMockCtx([obj]);

      const result = await getFloatingObject(ctx, SHEET_ID, 'obj-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('obj-1');
      expect(result!.type).toBe('shape');
    });

    it('returns null when the object does not exist', async () => {
      const ctx = createMockCtx([]);

      const result = await getFloatingObject(ctx, SHEET_ID, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // update (updateFloatingObject)
  // =========================================================================

  describe('updateFloatingObject', () => {
    it('delegates to computeBridge.updateFloatingObject with the provided updates', async () => {
      const obj = makeObject('obj-1');
      const ctx = createMockCtx([obj]);
      const updates = { name: 'Renamed' };

      await updateFloatingObject(ctx, SHEET_ID, 'obj-1', updates);

      expect(ctx.computeBridge.updateFloatingObject).toHaveBeenCalledWith(
        SHEET_ID,
        'obj-1',
        updates,
        expectFloatingObjectMutationOptions('floatingObjects.update'),
      );
    });

    it('throws KernelError when the object does not exist', async () => {
      const ctx = createMockCtx([]);

      await expect(
        updateFloatingObject(ctx, SHEET_ID, 'nonexistent', { name: 'X' }),
      ).rejects.toThrow(KernelError);
    });
  });

  // =========================================================================
  // deleteMany (deleteManyFloatingObjects)
  // =========================================================================

  describe('deleteManyFloatingObjects', () => {
    it('returns the count of deleted objects', async () => {
      const objects = [makeObject('a'), makeObject('b'), makeObject('c')];
      const ctx = createMockCtx(objects);

      const count = await deleteManyFloatingObjects(ctx, SHEET_ID, ['a', 'b']);

      expect(count).toBe(2);
    });

    it('returns 0 when given an empty array', async () => {
      const ctx = createMockCtx([makeObject('a')]);

      const count = await deleteManyFloatingObjects(ctx, SHEET_ID, []);

      expect(count).toBe(0);
    });

    it('returns partial count when some IDs do not exist', async () => {
      const objects = [makeObject('a')];
      const ctx = createMockCtx(objects);

      const count = await deleteManyFloatingObjects(ctx, SHEET_ID, ['a', 'missing']);

      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // addPicture — anchorCell routing
  // =========================================================================

  describe('addPicture', () => {
    function makeMockCtxWithCreate() {
      let lastConfig: any = null;
      const computeBridge = {
        getFloatingObjectTyped: jest.fn(async () => ({
          id: 'pic-1',
          type: 'picture',
          name: 'Picture 1',
          sheetId: SHEET_ID,
          anchor: {
            anchorRow: 0,
            anchorCol: 0,
            anchorRowOffset: 0,
            anchorColOffset: 0,
          },
          width: 100,
          height: 100,
          zIndex: 1,
          rotation: 0,
          flipH: false,
          flipV: false,
          locked: false,
        })),
        getAllFloatingObjectsTyped: jest.fn(async () => []),
        createFloatingObject: jest.fn(async (_sid: string, config: any) => {
          lastConfig = config;
          return { floatingObjectChanges: [{ objectId: 'pic-1' }] };
        }),
        computeAllObjectBounds: jest.fn(async () => []),
      };
      return {
        ctx: { computeBridge } as unknown as Parameters<typeof addPicture>[0],
        getLastConfig: () => lastConfig,
      };
    }

    it('builds flat anchor.anchorRow/anchorCol from anchorCell when provided', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await addPicture(ctx, SHEET_ID, {
        src: 'data:image/png;base64,xxx',
        anchorCell: { row: 5, col: 3 },
        width: 100,
        height: 50,
      });

      const config = getLastConfig();
      expect(config.anchor.anchorRow).toBe(5);
      expect(config.anchor.anchorCol).toBe(3);
      expect(config.anchor.anchorMode).toBe('oneCell');
      // 100px / 50px → EMU (9525 per pixel)
      expect(config.anchor.extentCxEmu).toBe(100 * 9525);
      expect(config.anchor.extentCyEmu).toBe(50 * 9525);
      expect(config.width).toBe(100);
      expect(config.height).toBe(50);
    });

    it('defaults to anchorRow=0, anchorCol=0 when anchorCell is omitted', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await addPicture(ctx, SHEET_ID, {
        src: 'data:image/png;base64,xxx',
      });

      const config = getLastConfig();
      expect(config.anchor.anchorRow).toBe(0);
      expect(config.anchor.anchorCol).toBe(0);
    });

    it('encodes x/y pixel offsets as EMU in anchorColOffsetEmu/anchorRowOffsetEmu', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await addPicture(ctx, SHEET_ID, {
        src: 'data:image/png;base64,xxx',
        x: 10,
        y: 20,
      });

      const config = getLastConfig();
      expect(config.anchor.anchorColOffsetEmu).toBe(10 * 9525);
      expect(config.anchor.anchorRowOffsetEmu).toBe(20 * 9525);
    });

    it('persists picture formatting fields at creation', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await addPicture(ctx, SHEET_ID, {
        src: 'data:image/png;base64,xxx',
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
        adjustments: { brightness: 10, contrast: -5, transparency: 25 },
        border: { style: 'dashed', color: '#336699', width: 2 },
        locked: true,
        printable: false,
      });

      const config = getLastConfig();
      expect(config.crop).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
      expect(config.adjustments).toEqual({ brightness: 10, contrast: -5, transparency: 25 });
      expect(config.border).toEqual({ style: 'dashed', color: '#336699', width: 2 });
      expect(config.locked).toBe(true);
      expect(config.printable).toBe(false);
    });
  });

  // =========================================================================
  // updatePicture — Format Picture payload
  // =========================================================================

  describe('updatePicture', () => {
    it('forwards picture formatting fields and resizes from nested position', async () => {
      const obj = makeObject('pic-1', {
        type: 'picture',
        position: { ...stubPosition, width: 100, height: 50 },
      } as Partial<FloatingObjectBase>);
      const ctx = createMockCtx([obj]);

      await updatePicture(ctx, SHEET_ID, 'pic-1', {
        position: { width: 320 },
        locked: true,
        printable: false,
        crop: { top: 5, right: 6, bottom: 7, left: 8 },
        adjustments: { brightness: 15, contrast: -10, transparency: 40 },
        border: { style: 'solid', color: '#ff0000', width: 3 },
      });

      expect(ctx.computeBridge.updateFloatingObject).toHaveBeenCalledWith(
        SHEET_ID,
        'pic-1',
        {
          locked: true,
          printable: false,
          crop: { top: 5, right: 6, bottom: 7, left: 8 },
          adjustments: { brightness: 15, contrast: -10, transparency: 40 },
          border: { style: 'solid', color: '#ff0000', width: 3 },
        },
        expectFloatingObjectMutationOptions('floatingObjects.update', { grouped: true }),
      );
      expect(ctx.computeBridge.resizeFloatingObjectTyped).toHaveBeenCalledWith(
        SHEET_ID,
        'pic-1',
        {
          width: 320,
          height: 50,
        },
        expectFloatingObjectMutationOptions('floatingObjects.update', { grouped: true }),
      );
    });

    it('moves picture using top-level offsets while preserving the current anchor', async () => {
      const obj = makeObject('pic-1', {
        type: 'picture',
        position: { ...stubPosition, width: 100, height: 50 },
      } as Partial<FloatingObjectBase>);
      const ctx = createMockCtx([obj]);

      await updatePicture(ctx, SHEET_ID, 'pic-1', { x: 30, y: 40 });

      expect(ctx.computeBridge.moveFloatingObjectTyped).toHaveBeenCalledWith(
        SHEET_ID,
        'pic-1',
        {
          type: 'absolute',
          anchorRow: 0,
          anchorCol: 0,
          xOffset: 30,
          yOffset: 40,
        },
        expectFloatingObjectMutationOptions('floatingObjects.update', { grouped: true }),
      );
    });
  });

  // =========================================================================
  // addTextBox — Rust floating-object wire geometry
  // =========================================================================

  describe('addTextBox', () => {
    function makeMockCtxWithCreate() {
      let lastConfig: any = null;
      const computeBridge = {
        getFloatingObjectTyped: jest.fn(async () => ({
          id: 'textbox-1',
          type: 'textbox',
          name: 'TextBox 1',
          sheetId: SHEET_ID,
          anchor: {
            anchorRow: 0,
            anchorCol: 0,
            anchorRowOffset: 0,
            anchorColOffset: 0,
            anchorMode: 'oneCell',
          },
          width: 320,
          height: 140,
          zIndex: 1,
          rotation: 0,
          flipH: false,
          flipV: false,
          locked: false,
        })),
        createFloatingObject: jest.fn(async (_sid: string, config: any) => {
          lastConfig = config;
          return { floatingObjectChanges: [{ objectId: 'textbox-1' }] };
        }),
        computeAllObjectBounds: jest.fn(async () => [
          ['textbox-1', { x: 10, y: 20, width: 320, height: 140, rotation: 0 }],
        ]),
      };
      return {
        ctx: { computeBridge } as unknown as Parameters<typeof addTextBox>[0],
        getLastConfig: () => lastConfig,
      };
    }

    it('persists canonical anchor plus top-level width/height', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      const receipt = await addTextBox(ctx, SHEET_ID, {
        text: { content: 'Hello' },
        anchorCell: { row: 4, col: 2 },
        x: 10,
        y: 20,
        width: 320,
        height: 140,
        name: 'Note',
      });

      const config = getLastConfig();
      expect(config.position).toBeUndefined();
      expect(config.anchor.anchorRow).toBe(4);
      expect(config.anchor.anchorCol).toBe(2);
      expect(config.anchor.anchorMode).toBe('oneCell');
      expect(config.anchor.anchorColOffsetEmu).toBe(10 * 9525);
      expect(config.anchor.anchorRowOffsetEmu).toBe(20 * 9525);
      expect(config.anchor.extentCxEmu).toBe(320 * 9525);
      expect(config.anchor.extentCyEmu).toBe(140 * 9525);
      expect(config.width).toBe(320);
      expect(config.height).toBe(140);
      expect(receipt.bounds.width).toBe(320);
      expect(receipt.bounds.height).toBe(140);
    });

    it('defaults top-level size to nonzero textbox dimensions', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await addTextBox(ctx, SHEET_ID, {});

      const config = getLastConfig();
      expect(config.width).toBe(200);
      expect(config.height).toBe(100);
      expect(config.anchor.extentCxEmu).toBe(200 * 9525);
      expect(config.anchor.extentCyEmu).toBe(100 * 9525);
    });

    it('defaults to anchorRow=0, anchorCol=0 when anchorCell is omitted', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await addTextBox(ctx, SHEET_ID, {});

      const config = getLastConfig();
      expect(config.anchor.anchorRow).toBe(0);
      expect(config.anchor.anchorCol).toBe(0);
    });
  });

  // =========================================================================
  // addEquation — Rust floating-object wire geometry
  // =========================================================================

  describe('createEquation', () => {
    function makeMockCtxWithCreate() {
      let lastConfig: any = null;
      const computeBridge = {
        createFloatingObject: jest.fn(async (_sid: string, config: any) => {
          lastConfig = config;
          return { floatingObjectChanges: [{ objectId: 'equation-1' }] };
        }),
      };
      return {
        ctx: { computeBridge } as unknown as Parameters<typeof createEquation>[1],
        getLastConfig: () => lastConfig,
      };
    }

    it('persists canonical anchor plus top-level width/height', async () => {
      const manager = { createEquation: jest.fn() };
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      const id = await createEquation(manager as any, ctx, SHEET_ID, {
        latex: 'x^2',
        anchorCell: { row: 6, col: 3 },
        x: 8,
        y: 12,
        width: 240,
        height: 80,
      });

      const config = getLastConfig();
      expect(id).toBe('equation-1');
      expect(manager.createEquation).not.toHaveBeenCalled();
      expect(config.type).toBe('equation');
      expect(config.equation).toBe('x^2');
      expect(config.anchor.anchorRow).toBe(6);
      expect(config.anchor.anchorCol).toBe(3);
      expect(config.anchor.anchorMode).toBe('oneCell');
      expect(config.anchor.anchorColOffsetEmu).toBe(8 * 9525);
      expect(config.anchor.anchorRowOffsetEmu).toBe(12 * 9525);
      expect(config.anchor.extentCxEmu).toBe(240 * 9525);
      expect(config.anchor.extentCyEmu).toBe(80 * 9525);
      expect(config.width).toBe(240);
      expect(config.height).toBe(80);
    });

    it('defaults top-level size to nonzero equation dimensions', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await createEquation({} as any, ctx, SHEET_ID, { latex: 'x' });

      const config = getLastConfig();
      expect(config.width).toBe(150);
      expect(config.height).toBe(50);
      expect(config.anchor.extentCxEmu).toBe(150 * 9525);
      expect(config.anchor.extentCyEmu).toBe(50 * 9525);
    });

    it('defaults to anchorRow=0, anchorCol=0 when anchorCell is omitted', async () => {
      const { ctx, getLastConfig } = makeMockCtxWithCreate();

      await createEquation({} as any, ctx, SHEET_ID, { latex: 'x' });

      const config = getLastConfig();
      expect(config.anchor.anchorRow).toBe(0);
      expect(config.anchor.anchorCol).toBe(0);
    });
  });
});

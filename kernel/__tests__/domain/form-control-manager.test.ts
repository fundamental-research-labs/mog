/**
 * Form Control Manager Tests
 *
 * Tests CRUD operations for form controls (Checkbox, Button, ComboBox).
 * Uses a mock DocumentContext with a stub ComputeBridge.
 */

import { jest } from '@jest/globals';

import type { DocumentContext } from '../../src/context/types';
import { FormControlManager } from '../../src/domain/form-controls/form-control-manager';

// =============================================================================
// Mock DocumentContext
// =============================================================================

const EMU_PER_PX = 9525;

type EventHandler = (event: Record<string, unknown>) => void;
type MockContext = DocumentContext & {
  __emit: (event: Record<string, unknown>) => void;
  __floatingObjects: Map<string, Record<string, unknown>>;
};

async function flushAsyncProjection(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createMockContext(): MockContext {
  let nextObjectId = 1;
  const handlers = new Map<string, Set<EventHandler>>();
  const floatingObjects = new Map<string, Record<string, unknown>>();

  const nextZIndex = (sheetId: string): number => {
    let max = -1;
    for (const object of floatingObjects.values()) {
      if (object.sheetId === sheetId && typeof object.zIndex === 'number') {
        max = Math.max(max, object.zIndex);
      }
    }
    return max + 1;
  };

  const buildObject = (
    sheetId: string,
    objectId: string,
    config: Record<string, unknown>,
  ): Record<string, unknown> => ({
    id: objectId,
    sheetId,
    anchor: config.anchor ?? {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffsetEmu: 0,
      anchorColOffsetEmu: 0,
      anchorMode: 'oneCell',
    },
    width: config.width ?? 100,
    height: config.height ?? 100,
    zIndex: config.zIndex ?? nextZIndex(sheetId),
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: config.name ?? '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...config,
  });

  const emitToHandlers = (event: Record<string, unknown>) => {
    for (const handler of handlers.get(String(event.type)) ?? []) {
      handler(event);
    }
  };

  return {
    computeBridge: {
      setCells: jest.fn().mockResolvedValue(undefined),
      getCellIdAt: jest.fn().mockResolvedValue(null),
      getCellIdAtPosition: jest.fn().mockResolvedValue(null),
      getOrCreateCellId: jest
        .fn()
        .mockImplementation(async (sheetId: string, row: number, col: number) => ({
          success: true,
          data: `cell-${sheetId}-${row}-${col}`,
        })),
      getCellPosition: jest.fn().mockResolvedValue(null),
      beginUndoGroup: jest.fn(async () => ({ recalc: { changedCells: [] } })),
      endUndoGroup: jest.fn(async () => ({ recalc: { changedCells: [] } })),
      createFloatingObject: jest.fn(async (sheetId: string, rawConfig: unknown) => {
        const config = rawConfig as Record<string, unknown>;
        const objectId = `fobj-${nextObjectId++}`;
        const object = buildObject(sheetId, objectId, config);
        floatingObjects.set(objectId, object);
        return {
          success: true,
          data: objectId,
          floatingObjectChanges: [
            {
              sheetId,
              objectId,
              kind: { type: 'created' },
              objectType: object.type,
              data: object,
            },
          ],
          recalc: { changedCells: [] },
        };
      }),
      updateFloatingObject: jest.fn(
        async (sheetId: string, objectId: string, rawUpdates: unknown) => {
          const updates = rawUpdates as Record<string, unknown>;
          const previous = floatingObjects.get(objectId);
          const object = previous
            ? { ...previous, ...updates, updatedAt: Date.now() }
            : buildObject(sheetId, objectId, updates);
          if (updates.anchor && previous?.anchor) {
            object.anchor = {
              ...(previous.anchor as Record<string, unknown>),
              ...(updates.anchor as Record<string, unknown>),
            };
          }
          floatingObjects.set(objectId, object);
          return {
            success: true,
            data: objectId,
            floatingObjectChanges: [
              {
                sheetId,
                objectId,
                kind: { type: 'updated', changedFields: Object.keys(updates) },
                objectType: object.type,
                data: object,
              },
            ],
            recalc: { changedCells: [] },
          };
        },
      ),
      deleteFloatingObject: jest.fn(async (sheetId: string, objectId: string) => {
        const object = floatingObjects.get(objectId);
        floatingObjects.delete(objectId);
        return {
          success: true,
          data: objectId,
          floatingObjectChanges: [
            {
              sheetId,
              objectId,
              kind: { type: 'removed' },
              objectType: object?.type,
              data: object,
            },
          ],
          recalc: { changedCells: [] },
        };
      }),
      getFloatingObjectsInSheet: jest.fn(async (sheetId: string) =>
        Array.from(floatingObjects.entries()).filter(([, object]) => object.sheetId === sheetId),
      ),
      getFloatingObjectTyped: jest.fn(async (_sheetId: string, objectId: string) => {
        return floatingObjects.get(objectId) ?? null;
      }),
    },
    eventBus: {
      emit: jest.fn((event: Record<string, unknown>) => emitToHandlers(event)),
      on: jest.fn((type: string, handler: EventHandler) => {
        let eventHandlers = handlers.get(type);
        if (!eventHandlers) {
          eventHandlers = new Set();
          handlers.set(type, eventHandlers);
        }
        eventHandlers.add(handler);
        return () => eventHandlers?.delete(handler);
      }),
      off: jest.fn((type: string, handler: EventHandler) => {
        handlers.get(type)?.delete(handler);
      }),
    },
    __emit: emitToHandlers,
    __floatingObjects: floatingObjects,
  } as unknown as MockContext;
}

// =============================================================================
// Tests
// =============================================================================

describe('FormControlManager', () => {
  let manager: FormControlManager;
  let ctx: MockContext;

  beforeEach(() => {
    ctx = createMockContext();
    manager = new FormControlManager(ctx);
  });

  // ---------------------------------------------------------------------------
  // Checkbox CRUD
  // ---------------------------------------------------------------------------

  describe('createCheckbox', () => {
    it('should create a checkbox control with correct defaults', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      expect(checkbox.type).toBe('checkbox');
      expect(checkbox.sheetId).toBe('sheet-1');
      expect(checkbox.id).toMatch(/^fobj-/);
      expect(checkbox.width).toBe(16);
      expect(checkbox.height).toBe(16);
      expect(checkbox.enabled).toBe(true);
      expect(checkbox.zIndex).toBe(0);
      expect(checkbox.anchor.xOffset).toBe(0);
      expect(checkbox.anchor.yOffset).toBe(0);
      expect(checkbox.linkedCellId).toBeDefined();
      expect(checkbox.createdAt).toBeDefined();
      expect(ctx.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'formControl:created',
          sheetId: 'sheet-1',
          controlId: checkbox.id,
          controlType: 'checkbox',
          control: checkbox,
        }),
      );
      expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.createFloatingObject).toHaveBeenCalledWith(
        'sheet-1',
        expect.objectContaining({
          type: 'formControl',
          controlType: 'checkbox',
          cellLink: checkbox.linkedCellId,
          anchorCellId: checkbox.anchor.cellId,
          anchor: expect.objectContaining({
            anchorRow: 0,
            anchorCol: 0,
            anchorRowOffsetEmu: 0,
            anchorColOffsetEmu: 0,
            anchorMode: 'oneCell',
            extentCxEmu: 16 * EMU_PER_PX,
            extentCyEmu: 16 * EMU_PER_PX,
          }),
        }),
      );
    });

    it('should create a checkbox with custom dimensions and label', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 2, col: 3, xOffset: 5, yOffset: 10 },
        linkedCell: { row: 2, col: 4 },
        label: 'Enable feature',
        width: 20,
        height: 20,
      });

      expect(checkbox.width).toBe(20);
      expect(checkbox.height).toBe(20);
      expect(checkbox.label).toBe('Enable feature');
      expect(checkbox.anchor.xOffset).toBe(5);
      expect(checkbox.anchor.yOffset).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // Button CRUD
  // ---------------------------------------------------------------------------

  describe('createButton', () => {
    it('should create a button control with correct defaults', async () => {
      const button = await manager.createButton({
        sheetId: 'sheet-1',
        anchor: { row: 1, col: 1 },
        label: 'Click Me',
      });

      expect(button.type).toBe('button');
      expect(button.label).toBe('Click Me');
      expect(button.width).toBe(80);
      expect(button.height).toBe(28);
      expect(button.linkedCellId).toBeUndefined();
    });

    it('should create a button with linked cell and click action', async () => {
      const button = await manager.createButton({
        sheetId: 'sheet-1',
        anchor: { row: 1, col: 1 },
        label: 'Increment',
        linkedCell: { row: 1, col: 2 },
        clickAction: 'increment',
      });

      expect(button.linkedCellId).toBeDefined();
      expect(button.clickAction).toBe('increment');
    });
  });

  // ---------------------------------------------------------------------------
  // ComboBox CRUD
  // ---------------------------------------------------------------------------

  describe('createComboBox', () => {
    it('should create a comboBox control with static items', async () => {
      const comboBox = await manager.createComboBox({
        sheetId: 'sheet-1',
        anchor: { row: 3, col: 0 },
        linkedCell: { row: 3, col: 1 },
        items: ['Option A', 'Option B', 'Option C'],
        placeholder: 'Select an option',
      });

      expect(comboBox.type).toBe('comboBox');
      expect(comboBox.items).toEqual(['Option A', 'Option B', 'Option C']);
      expect(comboBox.placeholder).toBe('Select an option');
      expect(comboBox.width).toBe(140);
      expect(comboBox.height).toBe(28);
      expect(ctx.computeBridge.createFloatingObject).toHaveBeenCalledWith(
        'sheet-1',
        expect.objectContaining({
          type: 'formControl',
          controlType: 'comboBox',
          ooxml: expect.objectContaining({
            items: ['Option A', 'Option B', 'Option C'],
            moveWithCells: true,
            sizeWithCells: true,
          }),
        }),
      );
    });

    it('should create a comboBox with dynamic items source', async () => {
      const comboBox = await manager.createComboBox({
        sheetId: 'sheet-1',
        anchor: { row: 3, col: 0 },
        linkedCell: { row: 3, col: 1 },
        itemsSource: { startRow: 0, startCol: 5, endRow: 10, endCol: 5 },
      });

      expect(comboBox.itemsSourceRef).toBeDefined();
      expect(comboBox.itemsSourceRef!.type).toBe('range');
      expect(comboBox.itemsSourceRef!.startId).toBeDefined();
      expect(comboBox.itemsSourceRef!.endId).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  describe('getControl', () => {
    it('should return a control by ID', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      const retrieved = manager.getControl(checkbox.id);
      expect(retrieved).toEqual(checkbox);
    });

    it('should return undefined for non-existent control', () => {
      expect(manager.getControl('non-existent')).toBeUndefined();
    });
  });

  describe('getControlsForSheet', () => {
    it('should return only controls for the specified sheet', async () => {
      await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });
      await manager.createButton({
        sheetId: 'sheet-2',
        anchor: { row: 0, col: 0 },
        label: 'Button',
      });
      await manager.createComboBox({
        sheetId: 'sheet-1',
        anchor: { row: 1, col: 0 },
        linkedCell: { row: 1, col: 1 },
        items: ['A', 'B'],
      });

      const sheet1Controls = manager.getControlsForSheet('sheet-1');
      expect(sheet1Controls).toHaveLength(2);
      expect(sheet1Controls.every((c) => c.sheetId === 'sheet-1')).toBe(true);
    });

    it('should return empty array for sheet with no controls', () => {
      expect(manager.getControlsForSheet('empty-sheet')).toEqual([]);
    });
  });

  describe('getAllControls', () => {
    it('should return all controls across sheets', async () => {
      await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });
      await manager.createButton({
        sheetId: 'sheet-2',
        anchor: { row: 0, col: 0 },
        label: 'Button',
      });

      expect(manager.getAllControls()).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Update Operations
  // ---------------------------------------------------------------------------

  describe('updateControl', () => {
    it('should update control properties', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      manager.updateControl(checkbox.id, { enabled: false, name: 'my-checkbox' });

      const updated = manager.getControl(checkbox.id)!;
      expect(updated.enabled).toBe(false);
      expect(updated.name).toBe('my-checkbox');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(checkbox.createdAt!);
      expect(ctx.computeBridge.updateFloatingObject).toHaveBeenCalledWith(
        'sheet-1',
        checkbox.id,
        expect.objectContaining({
          name: 'my-checkbox',
          cellLink: checkbox.linkedCellId,
          width: checkbox.width,
          height: checkbox.height,
        }),
      );
      expect(ctx.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'formControl:updated',
          sheetId: 'sheet-1',
          controlId: checkbox.id,
          controlType: 'checkbox',
          control: updated,
          previousControl: checkbox,
        }),
      );
    });

    it('should not fail for non-existent control', () => {
      expect(() => manager.updateControl('non-existent', { enabled: false })).not.toThrow();
    });
  });

  describe('moveControl', () => {
    it('should update the anchor', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      const originalAnchorCellId = checkbox.anchor.cellId;
      await manager.moveControl(checkbox.id, { row: 5, col: 5, xOffset: 10, yOffset: 20 });

      const moved = manager.getControl(checkbox.id)!;
      expect(moved.anchor.cellId).not.toBe(originalAnchorCellId);
      expect(moved.anchor.xOffset).toBe(10);
      expect(moved.anchor.yOffset).toBe(20);
    });
  });

  describe('resizeControl', () => {
    it('should update width and height', async () => {
      const button = await manager.createButton({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        label: 'Button',
      });

      manager.resizeControl(button.id, 200, 50);

      const resized = manager.getControl(button.id)!;
      expect(resized.width).toBe(200);
      expect(resized.height).toBe(50);
      expect(ctx.computeBridge.updateFloatingObject).toHaveBeenCalledWith(
        'sheet-1',
        button.id,
        expect.objectContaining({
          width: 200,
          height: 50,
          extentCxEmu: 200 * EMU_PER_PX,
          extentCyEmu: 50 * EMU_PER_PX,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Delete Operations
  // ---------------------------------------------------------------------------

  describe('deleteControl', () => {
    it('should remove a control', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      manager.deleteControl(checkbox.id);
      expect(manager.getControl(checkbox.id)).toBeUndefined();
      expect(ctx.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'formControl:deleted',
          sheetId: 'sheet-1',
          controlId: checkbox.id,
          controlType: 'checkbox',
          previousControl: checkbox,
        }),
      );
    });

    it('should not fail for non-existent control', () => {
      expect(() => manager.deleteControl('non-existent')).not.toThrow();
    });
  });

  describe('deleteControlsForSheet', () => {
    it('should remove all controls for a sheet', async () => {
      await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });
      await manager.createButton({
        sheetId: 'sheet-1',
        anchor: { row: 1, col: 0 },
        label: 'Button',
      });
      await manager.createComboBox({
        sheetId: 'sheet-2',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
        items: ['A'],
      });

      manager.deleteControlsForSheet('sheet-1');

      expect(manager.getControlsForSheet('sheet-1')).toHaveLength(0);
      expect(manager.getControlsForSheet('sheet-2')).toHaveLength(1);
    });
  });

  describe('floating object undo/redo projection', () => {
    it('removes and restores the overlay from floating-object events even when objectType falls back', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      ctx.__emit({
        type: 'floatingObject:deleted',
        sheetId: 'sheet-1',
        objectId: checkbox.id,
        objectType: 'shape',
        source: 'user',
      });

      expect(manager.getControl(checkbox.id)).toBeUndefined();

      ctx.__emit({
        type: 'floatingObject:updated',
        sheetId: 'sheet-1',
        objectId: checkbox.id,
        changes: {},
        source: 'user',
      });

      expect(manager.getControl(checkbox.id)).toEqual(
        expect.objectContaining({
          id: checkbox.id,
          type: 'checkbox',
          sheetId: 'sheet-1',
          linkedCellId: checkbox.linkedCellId,
        }),
      );
    });
  });

  describe('imported numeric controls', () => {
    it('hydrates imported scroll bars from floating objects', async () => {
      ctx.__floatingObjects.set('scroll-1', {
        id: 'scroll-1',
        sheetId: 'sheet-1',
        type: 'formControl',
        controlType: 'ScrollBar',
        cellLink: '$H$4',
        anchor: {
          anchorRow: 2,
          anchorCol: 1,
          anchorRowOffsetEmu: 0,
          anchorColOffsetEmu: 0,
          anchorMode: 'oneCell',
        },
        width: 120,
        height: 20,
        zIndex: 7,
        rotation: 0,
        flipH: false,
        flipV: false,
        locked: false,
        visible: true,
        printable: true,
        opacity: 1,
        name: 'Scroll Bar 46',
        createdAt: 1000,
        updatedAt: 1000,
        ooxml: {
          min: 1,
          max: 100,
          inc: 2,
          page: 10,
          horiz: true,
          controlPr: { disabled: false },
        },
      });

      ctx.__emit({
        type: 'floatingObject:created',
        sheetId: 'sheet-1',
        objectId: 'scroll-1',
        objectType: 'formControl',
      });
      await flushAsyncProjection();

      expect(manager.getControl('scroll-1')).toEqual(
        expect.objectContaining({
          id: 'scroll-1',
          type: 'scrollBar',
          sheetId: 'sheet-1',
          linkedCellId: 'cell-sheet-1-3-7',
          min: 1,
          max: 100,
          step: 2,
          page: 10,
          orientation: 'horizontal',
          width: 120,
          height: 20,
          enabled: true,
        }),
      );
    });

    it('hydrates imported spinners from alternate OOXML control names', async () => {
      ctx.__floatingObjects.set('spin-1', {
        id: 'spin-1',
        sheetId: 'sheet-1',
        type: 'formControl',
        controlType: 'Spin',
        cellLink: '$B$2',
        anchor: {
          anchorRow: 1,
          anchorCol: 1,
          anchorRowOffsetEmu: 0,
          anchorColOffsetEmu: 0,
          anchorMode: 'oneCell',
        },
        width: 18,
        height: 36,
        zIndex: 3,
        rotation: 0,
        flipH: false,
        flipV: false,
        locked: false,
        visible: true,
        printable: true,
        opacity: 1,
        name: 'Spin Button 1',
        createdAt: 1000,
        updatedAt: 1000,
        ooxml: {
          min: 0,
          max: 10,
          inc: 1,
          horiz: false,
          controlPr: { disabled: true },
        },
      });

      ctx.__emit({
        type: 'floatingObject:created',
        sheetId: 'sheet-1',
        objectId: 'spin-1',
        objectType: 'formControl',
      });
      await flushAsyncProjection();

      expect(manager.getControl('spin-1')).toEqual(
        expect.objectContaining({
          id: 'spin-1',
          type: 'spinner',
          sheetId: 'sheet-1',
          linkedCellId: 'cell-sheet-1-1-1',
          min: 0,
          max: 10,
          step: 1,
          enabled: false,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Utility Operations
  // ---------------------------------------------------------------------------

  describe('isLinkedCellValid', () => {
    it('should return true for checkbox with linkedCellId', async () => {
      const checkbox = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      expect(manager.isLinkedCellValid(checkbox.id)).toBe(true);
    });

    it('should return true for button (optional linkedCellId)', async () => {
      const button = await manager.createButton({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        label: 'Button',
      });

      expect(manager.isLinkedCellValid(button.id)).toBe(true);
    });

    it('should return false for non-existent control', () => {
      expect(manager.isLinkedCellValid('non-existent')).toBe(false);
    });
  });

  describe('getControlsAtPosition', () => {
    it('should return controls for the sheet', async () => {
      await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      const controls = manager.getControlsAtPosition('sheet-1', 0, 0);
      expect(controls).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Z-Index Ordering
  // ---------------------------------------------------------------------------

  describe('z-index ordering', () => {
    it('should assign incrementing z-index values', async () => {
      const c1 = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });
      const c2 = await manager.createButton({
        sheetId: 'sheet-1',
        anchor: { row: 1, col: 0 },
        label: 'Button',
      });
      const c3 = await manager.createComboBox({
        sheetId: 'sheet-1',
        anchor: { row: 2, col: 0 },
        linkedCell: { row: 2, col: 1 },
        items: ['A'],
      });

      expect(c1.zIndex).toBe(0);
      expect(c2.zIndex).toBe(1);
      expect(c3.zIndex).toBe(2);
    });

    it('should track z-index per sheet', async () => {
      const c1 = await manager.createCheckbox({
        sheetId: 'sheet-1',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });
      const c2 = await manager.createCheckbox({
        sheetId: 'sheet-2',
        anchor: { row: 0, col: 0 },
        linkedCell: { row: 0, col: 1 },
      });

      expect(c1.zIndex).toBe(0);
      expect(c2.zIndex).toBe(0); // Independent per sheet
    });
  });
});

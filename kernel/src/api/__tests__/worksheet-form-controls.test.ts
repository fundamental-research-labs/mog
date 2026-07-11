import { jest } from '@jest/globals';

import { KernelError } from '../../errors';
import { WorksheetFormControlsImpl } from '../worksheet/form-controls';

function createManager() {
  const checkbox = {
    id: 'fc-checkbox',
    type: 'checkbox' as const,
    sheetId: 'sheet-1',
    anchor: { cellId: 'anchor-cell' },
    linkedCellId: 'linked-cell',
    width: 16,
    height: 16,
    enabled: true,
    zIndex: 0,
  };
  const comboBox = {
    id: 'fc-combobox',
    type: 'comboBox' as const,
    sheetId: 'sheet-1',
    anchor: { cellId: 'anchor-cell' },
    linkedCellId: 'linked-cell',
    width: 140,
    height: 28,
    enabled: true,
    zIndex: 1,
    items: ['A', 'B'],
  };

  return {
    checkbox,
    comboBox,
    manager: {
      createCheckbox: jest.fn(async () => checkbox),
      createButton: jest.fn(),
      createComboBox: jest.fn(async () => comboBox),
      getControl: jest.fn((id: string) => {
        if (id === checkbox.id) return checkbox;
        if (id === comboBox.id) return comboBox;
        if (id === 'other-sheet') return { ...checkbox, id, sheetId: 'sheet-2' };
        return undefined;
      }),
      getControlsForSheet: jest.fn(() => [checkbox, comboBox]),
      getAllControls: jest.fn(() => [checkbox, comboBox]),
      hydrateControlsForSheet: jest.fn(async () => undefined),
      updateControl: jest.fn(async () => undefined),
      moveControl: jest.fn(async () => undefined),
      resizeControl: jest.fn(async () => undefined),
      deleteControl: jest.fn(async () => undefined),
      deleteControlsForSheet: jest.fn(),
      isLinkedCellValid: jest.fn(() => true),
      getControlsAtPosition: jest.fn(() => [checkbox]),
    },
  };
}

function createCtx({
  canEditObjects = true,
  isProtected = false,
  editObjects,
}: {
  canEditObjects?: boolean;
  isProtected?: boolean;
  editObjects?: boolean;
} = {}) {
  return {
    computeBridge: {
      canDoStructureOp: jest.fn(async () => canEditObjects),
    },
    mirror: {
      getSheetSettings: jest.fn(() => ({
        isProtected,
        protectionOptions: editObjects === undefined ? undefined : { editObjects },
      })),
    },
  };
}

function expectProtectedSheetError(error: unknown) {
  expect(error).toBeInstanceOf(KernelError);
  const err = error as KernelError;
  expect(err.code).toBe('API_PROTECTED_SHEET');
  expect(err.context).toMatchObject({
    internalCode: 'API_PROTECTED_SHEET',
    operation: 'editObject',
  });
}

describe('WorksheetFormControlsImpl', () => {
  it('adds checkbox and comboBox controls through the workbook manager with the worksheet sheetId', async () => {
    const { manager, checkbox, comboBox } = createManager();
    const api = new WorksheetFormControlsImpl(createCtx() as any, manager as any, 'sheet-1');

    await expect(
      api.add({ type: 'checkbox', anchor: { row: 1, col: 2 }, linkedCell: { row: 1, col: 3 } }),
    ).resolves.toBe(checkbox);
    expect(manager.createCheckbox).toHaveBeenCalledWith({
      sheetId: 'sheet-1',
      anchor: { row: 1, col: 2 },
      linkedCell: { row: 1, col: 3 },
    });

    await expect(
      api.add({
        type: 'comboBox',
        anchor: { row: 4, col: 5 },
        linkedCell: { row: 4, col: 6 },
        items: ['A', 'B'],
      }),
    ).resolves.toBe(comboBox);
    expect(manager.createComboBox).toHaveBeenCalledWith({
      sheetId: 'sheet-1',
      anchor: { row: 4, col: 5 },
      linkedCell: { row: 4, col: 6 },
      items: ['A', 'B'],
    });
  });

  it('rejects async add mutations on protected sheets before creating controls', async () => {
    const { manager } = createManager();
    const ctx = createCtx({ canEditObjects: false });
    const api = new WorksheetFormControlsImpl(ctx as any, manager as any, 'sheet-1');

    await expect(
      api.addCheckbox({ anchor: { row: 1, col: 2 }, linkedCell: { row: 1, col: 3 } }),
    ).rejects.toThrow(KernelError);
    await expect(
      api.addComboBox({
        anchor: { row: 4, col: 5 },
        linkedCell: { row: 4, col: 6 },
        items: ['A', 'B'],
      }),
    ).rejects.toThrow(KernelError);
    await expect(
      api.add({ type: 'checkbox', anchor: { row: 1, col: 2 }, linkedCell: { row: 1, col: 3 } }),
    ).rejects.toThrow(KernelError);
    await expect(
      api.add({
        type: 'comboBox',
        anchor: { row: 4, col: 5 },
        linkedCell: { row: 4, col: 6 },
        items: ['A', 'B'],
      }),
    ).rejects.toThrow(KernelError);

    expect(manager.createCheckbox).not.toHaveBeenCalled();
    expect(manager.createComboBox).not.toHaveBeenCalled();
    expect(ctx.computeBridge.canDoStructureOp).toHaveBeenCalledWith('sheet-1', 'editObject');

    try {
      await api.addCheckbox({ anchor: { row: 1, col: 2 }, linkedCell: { row: 1, col: 3 } });
    } catch (error) {
      expectProtectedSheetError(error);
    }
  });

  it('allows form-control mutations on protected sheets when object editing is enabled', async () => {
    const { manager, checkbox } = createManager();
    const ctx = createCtx({ canEditObjects: true, isProtected: true, editObjects: true });
    const api = new WorksheetFormControlsImpl(ctx as any, manager as any, 'sheet-1');

    await expect(
      api.addCheckbox({ anchor: { row: 1, col: 2 }, linkedCell: { row: 1, col: 3 } }),
    ).resolves.toBe(checkbox);
    await expect(api.update(checkbox.id, { enabled: false })).resolves.toBe(checkbox);
    await expect(api.move(checkbox.id, { row: 3, col: 4 })).resolves.toBe(checkbox);
    await expect(api.resize(checkbox.id, 32, 20)).resolves.toBe(checkbox);
    await expect(api.remove(checkbox.id)).resolves.toBe(true);

    expect(manager.createCheckbox).toHaveBeenCalledTimes(1);
    expect(manager.updateControl).toHaveBeenCalledWith(checkbox.id, { enabled: false });
    expect(manager.moveControl).toHaveBeenCalledWith(checkbox.id, { row: 3, col: 4 });
    expect(manager.resizeControl).toHaveBeenCalledWith(checkbox.id, 32, 20);
    expect(manager.deleteControl).toHaveBeenCalledWith(checkbox.id);
  });

  it('updates only controls on the worksheet', async () => {
    const { manager, checkbox } = createManager();
    const api = new WorksheetFormControlsImpl(createCtx() as any, manager as any, 'sheet-1');

    await expect(api.update(checkbox.id, { enabled: false })).resolves.toBe(checkbox);
    expect(manager.updateControl).toHaveBeenCalledWith(checkbox.id, { enabled: false });

    await expect(api.update('other-sheet', { enabled: false })).rejects.toMatchObject({
      code: 'FORM_CONTROL_NOT_FOUND',
    });
    expect(manager.updateControl).toHaveBeenCalledTimes(1);
  });

  it('awaits sheet hydration before deciding that a mutation target is missing', async () => {
    const { manager, checkbox } = createManager();
    let hydrated = false;
    manager.getControl.mockImplementation((id: string) =>
      hydrated && id === checkbox.id ? checkbox : undefined,
    );
    manager.hydrateControlsForSheet.mockImplementation(async () => {
      hydrated = true;
    });
    const api = new WorksheetFormControlsImpl(createCtx() as any, manager as any, 'sheet-1');

    await expect(api.update(checkbox.id, { enabled: false })).resolves.toBe(checkbox);
    expect(manager.hydrateControlsForSheet).toHaveBeenCalledWith('sheet-1');
    expect(manager.updateControl).toHaveBeenCalledWith(checkbox.id, { enabled: false });
  });

  it('rejects update and resize on protected sheets before manager mutation', async () => {
    const { manager, checkbox } = createManager();
    const api = new WorksheetFormControlsImpl(
      createCtx({ isProtected: true, editObjects: false }) as any,
      manager as any,
      'sheet-1',
    );

    await expect(api.update(checkbox.id, { enabled: false })).rejects.toThrow(KernelError);
    await expect(api.resize(checkbox.id, 32, 20)).rejects.toThrow(KernelError);
    expect(manager.updateControl).not.toHaveBeenCalled();
    expect(manager.resizeControl).not.toHaveBeenCalled();

    try {
      await api.update(checkbox.id, { enabled: false });
    } catch (error) {
      expectProtectedSheetError(error);
    }
  });

  it('rejects move on protected sheets before manager mutation', async () => {
    const { manager, checkbox } = createManager();
    const api = new WorksheetFormControlsImpl(
      createCtx({ canEditObjects: false }) as any,
      manager as any,
      'sheet-1',
    );

    await expect(api.move(checkbox.id, { row: 3, col: 4 })).rejects.toThrow(KernelError);
    expect(manager.moveControl).not.toHaveBeenCalled();

    try {
      await api.move(checkbox.id, { row: 3, col: 4 });
    } catch (error) {
      expectProtectedSheetError(error);
    }
  });

  it('removes only controls on the worksheet', async () => {
    const { manager, checkbox } = createManager();
    const api = new WorksheetFormControlsImpl(createCtx() as any, manager as any, 'sheet-1');

    await expect(api.remove(checkbox.id)).resolves.toBe(true);
    expect(manager.deleteControl).toHaveBeenCalledWith(checkbox.id);

    await expect(api.remove('other-sheet')).rejects.toMatchObject({
      code: 'FORM_CONTROL_NOT_FOUND',
    });
    expect(manager.deleteControl).toHaveBeenCalledTimes(1);
  });

  it('rejects remove on protected sheets before manager mutation', async () => {
    const { manager, checkbox } = createManager();
    const api = new WorksheetFormControlsImpl(
      createCtx({ isProtected: true, editObjects: false }) as any,
      manager as any,
      'sheet-1',
    );

    await expect(api.remove(checkbox.id)).rejects.toThrow(KernelError);
    expect(manager.deleteControl).not.toHaveBeenCalled();

    try {
      await api.remove(checkbox.id);
    } catch (error) {
      expectProtectedSheetError(error);
    }
  });

  it('rejects controls from other sheets before protection checks or mutation', async () => {
    const { manager } = createManager();
    const ctx = createCtx({ canEditObjects: false, isProtected: true, editObjects: false });
    const api = new WorksheetFormControlsImpl(ctx as any, manager as any, 'sheet-1');

    await expect(api.update('other-sheet', { enabled: false })).rejects.toMatchObject({
      code: 'FORM_CONTROL_NOT_FOUND',
    });
    await expect(api.move('other-sheet', { row: 3, col: 4 })).rejects.toMatchObject({
      code: 'FORM_CONTROL_NOT_FOUND',
    });
    await expect(api.resize('other-sheet', 32, 20)).rejects.toMatchObject({
      code: 'FORM_CONTROL_NOT_FOUND',
    });
    await expect(api.remove('other-sheet')).rejects.toMatchObject({
      code: 'FORM_CONTROL_NOT_FOUND',
    });

    expect(ctx.computeBridge.canDoStructureOp).not.toHaveBeenCalled();
    expect(ctx.mirror.getSheetSettings).not.toHaveBeenCalled();
    expect(manager.updateControl).not.toHaveBeenCalled();
    expect(manager.moveControl).not.toHaveBeenCalled();
    expect(manager.resizeControl).not.toHaveBeenCalled();
    expect(manager.deleteControl).not.toHaveBeenCalled();
  });
});

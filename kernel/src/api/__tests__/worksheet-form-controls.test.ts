import { jest } from '@jest/globals';

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
      updateControl: jest.fn(),
      moveControl: jest.fn(async () => undefined),
      resizeControl: jest.fn(),
      deleteControl: jest.fn(),
      deleteControlsForSheet: jest.fn(),
      isLinkedCellValid: jest.fn(() => true),
      getControlsAtPosition: jest.fn(() => [checkbox]),
    },
  };
}

describe('WorksheetFormControlsImpl', () => {
  it('adds checkbox and comboBox controls through the workbook manager with the worksheet sheetId', async () => {
    const { manager, checkbox, comboBox } = createManager();
    const api = new WorksheetFormControlsImpl(manager as any, 'sheet-1');

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

  it('updates only controls on the worksheet', () => {
    const { manager, checkbox } = createManager();
    const api = new WorksheetFormControlsImpl(manager as any, 'sheet-1');

    expect(api.update(checkbox.id, { enabled: false })).toBe(checkbox);
    expect(manager.updateControl).toHaveBeenCalledWith(checkbox.id, { enabled: false });

    expect(api.update('other-sheet', { enabled: false })).toBeUndefined();
    expect(manager.updateControl).toHaveBeenCalledTimes(1);
  });

  it('removes only controls on the worksheet', () => {
    const { manager, checkbox } = createManager();
    const api = new WorksheetFormControlsImpl(manager as any, 'sheet-1');

    expect(api.remove(checkbox.id)).toBe(true);
    expect(manager.deleteControl).toHaveBeenCalledWith(checkbox.id);

    expect(api.remove('other-sheet')).toBe(false);
    expect(manager.deleteControl).toHaveBeenCalledTimes(1);
  });
});

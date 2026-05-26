import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { ADD_CUSTOM_LIST, DELETE_CUSTOM_LIST, EDIT_CUSTOM_LIST } from '../custom-lists';

function createDeps() {
  const cancelEditingCustomList = jest.fn();
  const selectCustomList = jest.fn();
  const workbook = {
    addCustomList: jest.fn(async (input: { name: string; values: string[] }) => ({
      id: 'custom-created',
      name: input.name,
      values: input.values,
      isBuiltIn: false,
    })),
    updateCustomList: jest.fn(async () => true),
    deleteCustomList: jest.fn(async () => true),
  };
  const uiStore = {
    getState: () => ({
      cancelEditingCustomList,
      selectCustomList,
    }),
  };

  return {
    deps: { workbook, uiStore } as unknown as ActionDependencies,
    workbook,
    cancelEditingCustomList,
    selectCustomList,
  };
}

describe('custom-list action handlers', () => {
  it('ADD_CUSTOM_LIST delegates to workbook.addCustomList and selects the returned id', async () => {
    const { deps, workbook, cancelEditingCustomList, selectCustomList } = createDeps();

    await expect(
      ADD_CUSTOM_LIST(deps, { name: 'Greek Letters', values: ['Alpha', 'Beta'] }),
    ).resolves.toEqual({ handled: true });

    expect(workbook.addCustomList).toHaveBeenCalledWith({
      name: 'Greek Letters',
      values: ['Alpha', 'Beta'],
    });
    expect(cancelEditingCustomList).toHaveBeenCalled();
    expect(selectCustomList).toHaveBeenCalledWith('custom-created');
  });

  it('EDIT_CUSTOM_LIST delegates to workbook.updateCustomList by stable id', async () => {
    const { deps, workbook, cancelEditingCustomList } = createDeps();

    await expect(
      EDIT_CUSTOM_LIST(deps, { id: 'custom-greek', values: ['Alpha', 'Beta', 'Gamma'] }),
    ).resolves.toEqual({ handled: true });

    expect(workbook.updateCustomList).toHaveBeenCalledWith('custom-greek', {
      values: ['Alpha', 'Beta', 'Gamma'],
    });
    expect(cancelEditingCustomList).toHaveBeenCalled();
  });

  it('EDIT_CUSTOM_LIST reports a handled error when workbook refuses the id', async () => {
    const { deps, workbook, cancelEditingCustomList } = createDeps();
    workbook.updateCustomList.mockResolvedValueOnce(false);

    await expect(
      EDIT_CUSTOM_LIST(deps, { id: 'builtin-priority', values: ['Critical'] }),
    ).resolves.toEqual({
      handled: true,
      error: 'Failed to update custom list (may be a built-in list)',
    });

    expect(cancelEditingCustomList).not.toHaveBeenCalled();
  });

  it('DELETE_CUSTOM_LIST delegates to workbook.deleteCustomList by stable id', async () => {
    const { deps, workbook, selectCustomList } = createDeps();

    await expect(DELETE_CUSTOM_LIST(deps, { id: 'custom-greek' })).resolves.toEqual({
      handled: true,
    });

    expect(workbook.deleteCustomList).toHaveBeenCalledWith('custom-greek');
    expect(selectCustomList).toHaveBeenCalledWith(null);
  });
});

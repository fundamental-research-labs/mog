import { jest } from '@jest/globals';

import type { DocumentContext } from '../../../context';

import {
  addCustomList,
  deleteCustomList,
  getCustomLists,
  replaceCustomLists,
  updateCustomList,
} from '../workbook';

function createCtx(initialEntries: unknown[] = []) {
  let entries: unknown[] = initialEntries;
  const computeBridge = {
    getWorkbookSetting: jest.fn(async (key: string) => (key === 'customLists' ? entries : null)),
    setWorkbookSetting: jest.fn(async (key: string, value: unknown) => {
      if (key === 'customLists' && Array.isArray(value)) {
        entries = value;
      }
    }),
  };

  return {
    ctx: { computeBridge } as unknown as DocumentContext,
    computeBridge,
    getEntries: () => entries,
  };
}

describe('workbook custom lists domain', () => {
  it('getCustomLists returns built-ins plus persisted user lists with metadata', async () => {
    const { ctx } = createCtx([
      { id: 'custom-greek', name: 'Greek Letters', values: ['Alpha', 'Beta'] },
    ]);

    await expect(getCustomLists(ctx)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'builtin-priority',
          name: 'Priority',
          values: ['High', 'Medium', 'Low'],
          isBuiltIn: true,
        }),
        {
          id: 'custom-greek',
          name: 'Greek Letters',
          values: ['Alpha', 'Beta'],
          isBuiltIn: false,
        },
      ]),
    );
  });

  it('addCustomList appends a user-defined list without persisting built-ins', async () => {
    const { ctx, computeBridge } = createCtx([]);

    const list = await addCustomList(ctx, 'Greek Letters', ['Alpha', 'Beta']);

    expect(list).toEqual({
      id: expect.stringMatching(/^custom-/),
      name: 'Greek Letters',
      values: ['Alpha', 'Beta'],
      isBuiltIn: false,
    });
    expect(computeBridge.setWorkbookSetting).toHaveBeenCalledWith('customLists', [
      {
        id: list.id,
        name: 'Greek Letters',
        values: ['Alpha', 'Beta'],
      },
    ]);
  });

  it('updateCustomList updates user-defined entries and refuses built-ins', async () => {
    const { ctx, computeBridge, getEntries } = createCtx([
      { id: 'custom-greek', name: 'Greek Letters', values: ['Alpha', 'Beta'] },
    ]);

    await expect(
      updateCustomList(ctx, 'custom-greek', {
        name: 'Greek Alphabet',
        values: ['Alpha', 'Beta', 'Gamma'],
      }),
    ).resolves.toBe(true);
    expect(getEntries()).toEqual([
      {
        id: 'custom-greek',
        name: 'Greek Alphabet',
        values: ['Alpha', 'Beta', 'Gamma'],
      },
    ]);

    computeBridge.setWorkbookSetting.mockClear();
    await expect(updateCustomList(ctx, 'builtin-priority', { values: ['Critical'] })).resolves.toBe(
      false,
    );
    expect(computeBridge.setWorkbookSetting).not.toHaveBeenCalled();
  });

  it('deleteCustomList deletes user-defined entries and refuses built-ins', async () => {
    const { ctx, computeBridge, getEntries } = createCtx([
      { id: 'custom-greek', name: 'Greek Letters', values: ['Alpha', 'Beta'] },
      { id: 'custom-roman', name: 'Roman Numerals', values: ['I', 'II'] },
    ]);

    await expect(deleteCustomList(ctx, 'custom-greek')).resolves.toBe(true);
    expect(getEntries()).toEqual([
      { id: 'custom-roman', name: 'Roman Numerals', values: ['I', 'II'] },
    ]);

    computeBridge.setWorkbookSetting.mockClear();
    await expect(deleteCustomList(ctx, 'builtin-priority')).resolves.toBe(false);
    expect(computeBridge.setWorkbookSetting).not.toHaveBeenCalled();
  });

  it('replaceCustomLists replaces only user-defined persisted entries', async () => {
    const { ctx, getEntries } = createCtx([{ id: 'custom-old', name: 'Old', values: ['Old'] }]);

    await replaceCustomLists(ctx, [
      { name: 'Quarters', values: ['Q1', 'Q2', 'Q3', 'Q4'] },
      { name: 'Phonetic', values: ['Alpha', 'Bravo'] },
    ]);

    expect(getEntries()).toEqual([
      {
        id: expect.stringMatching(/^custom-/),
        name: 'Quarters',
        values: ['Q1', 'Q2', 'Q3', 'Q4'],
      },
      {
        id: expect.stringMatching(/^custom-/),
        name: 'Phonetic',
        values: ['Alpha', 'Bravo'],
      },
    ]);
  });
});

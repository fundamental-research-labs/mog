import { jest } from '@jest/globals';

import type { CellStyle } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../src/context';
import { getBuiltInStyleById, getBuiltInStyles } from '../../src/domain/cells/built-in-styles';

let customStylesForMock: CellStyle[] = [];
let getCustomStylesCalls = 0;
let getStyleByIdResult: CellStyle | undefined;

jest.unstable_mockModule('../../src/domain/cells/cell-properties', () => ({
  createCustomStyle: async () => {
    throw new Error('createCustomStyle was not expected in this test');
  },
  deleteCustomStyle: async () => {
    throw new Error('deleteCustomStyle was not expected in this test');
  },
  getAllStyles: async () => [...getBuiltInStyles(), ...customStylesForMock],
  getCustomStyles: async () => {
    getCustomStylesCalls += 1;
    return customStylesForMock;
  },
  getStyleById: async () => getStyleByIdResult,
  getStylesByCategory: async (_ctx: DocumentContext, category: CellStyle['category']) =>
    customStylesForMock.filter((style) => style.category === category),
  updateCustomStyle: async () => {
    throw new Error('updateCustomStyle was not expected in this test');
  },
}));

const { WorkbookCellStylesImpl } = await import('../../src/api/workbook/cell-styles');

function createWorkbookCellStyles(customStyles: CellStyle[] = []) {
  customStylesForMock = customStyles;
  getCustomStylesCalls = 0;
  getStyleByIdResult = undefined;
  const ctx = {
    computeBridge: {},
  } as unknown as DocumentContext;

  return {
    api: new WorkbookCellStylesImpl(ctx),
  };
}

describe('WorkbookCellStylesImpl', () => {
  it('lists built-in styles through the public workbook API without querying custom storage', async () => {
    const { api } = createWorkbookCellStyles();

    const styles = await api.list({ source: 'builtIn' });

    expect(styles.some((style) => style.id === 'normal')).toBe(true);
    expect(styles.some((style) => style.id === 'good')).toBe(true);
    expect(styles.every((style) => style.builtIn)).toBe(true);
    expect(getCustomStylesCalls).toBe(0);
  });

  it('lists the complete workbook style set by default', async () => {
    const customStyle: CellStyle = {
      id: 'custom-currency',
      name: 'Currency Warning',
      category: 'custom',
      builtIn: false,
      format: {
        numberFormat: '$#,##0.00',
      },
    };
    const { api } = createWorkbookCellStyles([customStyle]);

    const styles = await api.list();

    expect(styles.some((style) => style.id === 'normal')).toBe(true);
    expect(styles).toContain(customStyle);
  });

  it('returns ordered catalog metadata for matching built-in style categories', async () => {
    const { api } = createWorkbookCellStyles();

    const catalog = await api.getCatalog({ source: 'builtIn' });

    expect(catalog.categories.map((category) => category.id)).toEqual([
      'good-bad-neutral',
      'data-model',
      'titles-headings',
      'themed',
      'number-format',
    ]);
    expect(catalog.categories[0]).toEqual({
      id: 'good-bad-neutral',
      label: 'Good, Bad and Neutral',
      order: 0,
    });
    expect(catalog.styles.some((style) => style.category === 'custom')).toBe(false);
  });

  it('can list custom styles by source and category', async () => {
    const customStyle: CellStyle = {
      id: 'custom-warning',
      name: 'Warning',
      category: 'custom',
      builtIn: false,
      format: {
        backgroundColor: '#fff2cc',
      },
    };
    const { api } = createWorkbookCellStyles([customStyle]);

    await expect(api.list({ source: 'custom', category: 'custom' })).resolves.toEqual([
      customStyle,
    ]);
    await expect(api.list({ source: 'custom', category: 'themed' })).resolves.toEqual([]);
  });

  it('returns full style metadata separately from the legacy format lookup', async () => {
    const { api } = createWorkbookCellStyles();
    getStyleByIdResult = getBuiltInStyleById('good');

    const style = await api.getStyle('good');
    const format = await api.get('good');

    expect(style?.id).toBe('good');
    expect(style?.builtIn).toBe(true);
    expect(format).toEqual(style?.format);
  });
});

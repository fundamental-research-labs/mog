import {
  normalizeRangeSortColumns,
  normalizeRangeSortOptions,
  normalizeTableSortFields,
} from '../sort-helpers';

describe('sort descriptor normalization', () => {
  it('accepts OfficeJS key/ascending range sort fields', () => {
    const result = normalizeRangeSortColumns(
      [
        { key: 2, ascending: false, sortOn: 'Value' },
        { key: 0, ascending: true },
      ],
      { context: 'sortRange', maxColumnIndex: 2 },
    );

    expect(result).toEqual([
      {
        column: 2,
        direction: 'desc',
        caseSensitive: undefined,
        sortBy: 'value',
        customList: undefined,
      },
      {
        column: 0,
        direction: 'asc',
        caseSensitive: undefined,
        sortBy: 'value',
        customList: undefined,
      },
    ]);
  });

  it('accepts SDK guidance columnIndex/ascending range sort fields', () => {
    const result = normalizeRangeSortColumns([{ columnIndex: 1, ascending: true }], {
      context: 'sortRange',
      maxColumnIndex: 2,
    });

    expect(result[0]).toMatchObject({
      column: 1,
      direction: 'asc',
      sortBy: 'value',
    });
  });

  it('applies OfficeJS matchCase as default caseSensitive for range fields', () => {
    const result = normalizeRangeSortOptions(
      {
        columns: [{ key: 0 }, { key: 1, caseSensitive: false }],
        matchCase: true,
        orientation: 'Rows',
      },
      { context: 'sortRange', maxColumnIndex: 2 },
    );

    expect(result.columns[0].caseSensitive).toBe(true);
    expect(result.columns[1].caseSensitive).toBe(false);
  });

  it('maps OfficeJS cell and font color range sort fields', () => {
    const result = normalizeRangeSortColumns(
      [
        { key: 0, sortOn: 'CellColor', color: '#ff0000', ascending: true },
        { key: 1, sortOn: 'FontColor', color: '#00ff00', ascending: false },
      ],
      { context: 'sortRange', maxColumnIndex: 2 },
    );

    expect(result).toEqual([
      {
        column: 0,
        direction: 'asc',
        caseSensitive: undefined,
        sortBy: 'cellColor',
        targetColor: '#ff0000',
        colorPosition: 'top',
      },
      {
        column: 1,
        direction: 'desc',
        caseSensitive: undefined,
        sortBy: 'fontColor',
        targetColor: '#00ff00',
        colorPosition: 'bottom',
      },
    ]);
  });

  it('rejects ambiguous sort key properties', () => {
    expect(() =>
      normalizeRangeSortColumns([{ column: 0, key: 0 }], {
        context: 'sortRange',
        maxColumnIndex: 2,
      }),
    ).toThrow('must include exactly one of column, columnIndex, or key');
  });

  it('rejects out-of-range sort keys', () => {
    expect(() =>
      normalizeRangeSortColumns([{ key: 3 }], { context: 'sortRange', maxColumnIndex: 2 }),
    ).toThrow('outside the sortable column range 0-2');
  });

  it('rejects unsupported OfficeJS color/icon sort variants explicitly', () => {
    expect(() =>
      normalizeRangeSortColumns([{ key: 0, sortOn: 'Icon', icon: {} }], {
        context: 'sortRange',
        maxColumnIndex: 2,
      }),
    ).toThrow('icon sorting is not supported');
  });

  it('rejects behavior-changing OfficeJS data options until supported', () => {
    expect(() =>
      normalizeRangeSortColumns([{ key: 0, dataOption: 'TextAsNumber' }], {
        context: 'sortRange',
        maxColumnIndex: 2,
      }),
    ).toThrow('dataOption "TextAsNumber" is not supported');
  });

  it('rejects OfficeJS horizontal sort orientation and explicit collation method', () => {
    expect(() =>
      normalizeRangeSortOptions(
        { columns: [{ key: 0 }], orientation: 'Columns' },
        { context: 'sortRange', maxColumnIndex: 2 },
      ),
    ).toThrow('orientation "Columns" is not supported');

    expect(() =>
      normalizeRangeSortOptions(
        { columns: [{ key: 0 }], method: 'PinYin' },
        { context: 'sortRange', maxColumnIndex: 2 },
      ),
    ).toThrow('method "PinYin" is not supported');
  });

  it('normalizes OfficeJS table sort fields to table columnIndex fields', () => {
    const result = normalizeTableSortFields(
      [
        { key: 1, ascending: false, sortOn: 'value' },
        { columnIndex: 0, ascending: true },
      ],
      { context: 'tables.sort.apply', maxColumnIndex: 2 },
    );

    expect(result).toEqual([
      { columnIndex: 1, ascending: false },
      { columnIndex: 0, ascending: true },
    ]);
  });
});

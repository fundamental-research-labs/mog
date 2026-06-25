import type { Worksheet } from '@mog-sdk/contracts/api';
import { jest } from '@jest/globals';

import {
  detectColumnType,
  getUniqueColors,
  groupDatesByHierarchy,
  isDateColumn,
} from '../filter-utils';

describe('filter-utils column type detection', () => {
  it('treats plain Excel-serial-like numbers as numeric values', () => {
    const values = [1, 2, 3, 4, 5];

    expect(detectColumnType(values)).toBe('number');
    expect(isDateColumn(values)).toBe(false);
  });

  it('does not infer dates from mostly serial-like numeric columns', () => {
    expect(detectColumnType([1, 2, 3, 'label'])).toBe('number');
  });

  it('still groups explicit date serial inputs into the Excel date hierarchy', () => {
    const hierarchy = groupDatesByHierarchy([1, 2, 3, 4, 5]);

    expect(Array.from(hierarchy.years.keys())).toEqual([1900]);
    expect(Array.from(hierarchy.years.get(1900)?.months.keys() ?? [])).toEqual([1]);
    expect(Array.from(hierarchy.years.get(1900)?.months.get(1)?.days.keys() ?? [])).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('reads unique colors through one range query when available', async () => {
    const formatsGet = jest.fn();
    const getDisplayedRangeProperties = jest
      .fn()
      .mockResolvedValue([
        [{ backgroundColor: '#ff0000', fontColor: '#111111' }],
        [{ backgroundColor: '#00ff00', fontColor: '#222222' }],
        [{ backgroundColor: '#ff0000', fontColor: '#333333' }],
      ]);
    const getRange = jest
      .fn()
      .mockResolvedValue([
        [{ value: 'A', format: { backgroundColor: '#ff0000', fontColor: '#111111' } }],
        [{ value: 'B', format: { backgroundColor: '#00ff00', fontColor: '#222222' } }],
        [{ value: 'C', format: { backgroundColor: '#ff0000', fontColor: '#333333' } }],
      ]);
    const ws = {
      getRange,
      formats: { get: formatsGet, getDisplayedRangeProperties },
    } as unknown as Worksheet;

    await expect(getUniqueColors(ws, [5, 7], 2, 'fill')).resolves.toEqual(['#ff0000']);

    expect(getDisplayedRangeProperties).toHaveBeenCalledWith({
      startRow: 5,
      startCol: 2,
      endRow: 7,
      endCol: 2,
    });
    expect(getRange).not.toHaveBeenCalled();
    expect(formatsGet).not.toHaveBeenCalled();
  });
});

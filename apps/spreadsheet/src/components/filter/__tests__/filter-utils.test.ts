import { detectColumnType, groupDatesByHierarchy, isDateColumn } from '../filter-utils';

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
});

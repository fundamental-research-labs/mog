import { PRODUCT_VOCABULARY } from '../product-vocabulary';

const BANNED_VISIBLE_LABELS = new Set([
  'TextEffect',
  'Office Themes',
  'Office 2007 theme',
  'Ribbon',
  'Backstage',
  'Slicer',
  'Timeline',
  'Get & Transform Data',
  'Queries & Connections',
  'What-If Analysis',
  'PivotTable',
]);

function collectLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectLabels);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) =>
      key === 'label' && typeof nested === 'string' ? [nested] : collectLabels(nested),
    );
  }
  return [];
}

describe('PRODUCT_VOCABULARY', () => {
  it('keeps product-facing labels on Mog-owned vocabulary', () => {
    const labels = collectLabels(PRODUCT_VOCABULARY);

    expect(labels).toEqual(
      expect.arrayContaining([
        'Diagram',
        'Text effects',
        'Command bar',
        'File menu',
        'Workbook themes',
        'Classic',
        'Filter control',
        'Date filter',
        'Scenarios',
      ]),
    );
    expect(labels.filter((label) => BANNED_VISIBLE_LABELS.has(label))).toEqual([]);
  });
});

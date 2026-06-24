import { extractChartDataFromRange, ObjectCellAccessor, parseRange } from '../data-extractor';

describe('chart data range series orientation', () => {
  const vendorMonthAccessor = () =>
    ObjectCellAccessor.fromArray([
      ['Vendor', 'Jan', 'Feb', 'Mar'],
      ['Northwind', 12, 18, 15],
      ['Contoso', 20, 16, 22],
      ['Fabrikam', 8, 12, 18],
    ]);

  it('treats columns orientation as one series per data column', () => {
    const data = extractChartDataFromRange(vendorMonthAccessor(), parseRange('A1:D4'), {
      seriesOrientation: 'columns',
    });

    expect(data.categories).toEqual(['Northwind', 'Contoso', 'Fabrikam']);
    expect(data.series.map((series) => series.name)).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series.map((series) => series.data.map((point) => point.y))).toEqual([
      [12, 20, 8],
      [18, 16, 12],
      [15, 22, 18],
    ]);
  });

  it('treats rows orientation as one series per data row', () => {
    const data = extractChartDataFromRange(vendorMonthAccessor(), parseRange('A1:D4'), {
      seriesOrientation: 'rows',
    });

    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series.map((series) => series.name)).toEqual(['Northwind', 'Contoso', 'Fabrikam']);
    expect(data.series.map((series) => series.data.map((point) => point.y))).toEqual([
      [12, 18, 15],
      [20, 16, 22],
      [8, 12, 18],
    ]);
  });
});

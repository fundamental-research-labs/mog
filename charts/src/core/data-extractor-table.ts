/**
 * Excel-like table shape detection and extraction for chart data ranges.
 */
import type { ChartData, ChartDataPoint, ChartDataSeries } from '../types';
import type { CellRange } from './data-extractor-primitives';
import {
  type CellDataAccessor,
  createDataPoint,
  getRangeValue,
  hasCellValue,
  isNumericLike,
  labelValue,
} from './data-extractor-primitives';

export function hasExcelTableShape(accessor: CellDataAccessor, range: CellRange): boolean {
  const rowCount = range.endRow - range.startRow + 1;
  const colCount = range.endCol - range.startCol + 1;

  if (rowCount < 3 || colCount < 2) return false;

  let headerLabelCount = 0;
  for (let col = range.startCol + 1; col <= range.endCol; col++) {
    const value = getRangeValue(accessor, range, range.startRow, col);
    if (hasCellValue(value) && !isNumericLike(value)) {
      headerLabelCount++;
    }
  }

  let categoryLabelCount = 0;
  let numericBodyCount = 0;
  for (let row = range.startRow + 1; row <= range.endRow; row++) {
    const category = getRangeValue(accessor, range, row, range.startCol);
    if (hasCellValue(category)) {
      categoryLabelCount++;
    }

    for (let col = range.startCol + 1; col <= range.endCol; col++) {
      if (isNumericLike(getRangeValue(accessor, range, row, col))) {
        numericBodyCount++;
      }
    }
  }

  return headerLabelCount > 0 && categoryLabelCount > 0 && numericBodyCount > 0;
}

export function extractExcelTableData(accessor: CellDataAccessor, range: CellRange): ChartData {
  const categories: (string | number)[] = [];
  for (let row = range.startRow + 1; row <= range.endRow; row++) {
    categories.push(
      labelValue(getRangeValue(accessor, range, row, range.startCol), `Row ${row + 1}`),
    );
  }

  const series: ChartDataSeries[] = [];
  for (let col = range.startCol + 1; col <= range.endCol; col++) {
    const seriesIndex = col - range.startCol - 1;
    const header = getRangeValue(accessor, range, range.startRow, col);
    const name = String(labelValue(header, `Series ${seriesIndex + 1}`));
    const data: ChartDataPoint[] = [];

    for (let row = range.startRow + 1; row <= range.endRow; row++) {
      const catIndex = row - range.startRow - 1;
      const rawValue = getRangeValue(accessor, range, row, col);
      const category = categories[catIndex] ?? catIndex;
      data.push(createDataPoint(category, rawValue, String(category)));
    }

    series.push({ name, data });
  }

  return { categories, series };
}

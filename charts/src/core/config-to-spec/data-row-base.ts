import type { DataRow } from '../../grammar/spec';
import {
  CATEGORY_FIELD,
  CATEGORY_FORMAT_CODE_FIELD,
  POINT_INDEX_FIELD,
  RAW_CATEGORY_FIELD,
  RAW_VALUE_FIELD,
  SERIES_FIELD,
  SERIES_INDEX_FIELD,
  SERIES_ORDER_FIELD,
  SOURCE_SERIES_INDEX_FIELD,
  SOURCE_SERIES_KEY_FIELD,
  VALUE_FIELD,
} from './fields';

export type BaseDataRowInput = {
  rawCategory: string | number;
  rowCategory: string | number;
  seriesName: string;
  pointIndex: number;
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  seriesOrder: number;
  value?: number;
};

export function buildBaseRow(input: BaseDataRowInput): DataRow {
  const row: DataRow = {
    [CATEGORY_FIELD]: input.rowCategory,
    [SERIES_FIELD]: input.seriesName,
    [POINT_INDEX_FIELD]: input.pointIndex,
    [SERIES_INDEX_FIELD]: input.seriesIndex,
    [SOURCE_SERIES_INDEX_FIELD]: input.sourceSeriesIndex,
    [SOURCE_SERIES_KEY_FIELD]: input.sourceSeriesKey,
    [SERIES_ORDER_FIELD]: input.seriesOrder,
    [RAW_CATEGORY_FIELD]: input.rawCategory,
  };
  if (input.value !== undefined) {
    row[VALUE_FIELD] = input.value;
    row[RAW_VALUE_FIELD] = input.value;
  }
  return row;
}

export function applyCategoryFormat(
  row: DataRow,
  categoryFormatCode: string | null | undefined,
): void {
  if (categoryFormatCode) row[CATEGORY_FORMAT_CODE_FIELD] = categoryFormatCode;
}

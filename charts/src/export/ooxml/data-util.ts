/**
 * Shared Data Extraction Utilities for OOXML Chart Export
 *
 * Extracts series data from data rows and encoding specifications.
 * Used by bar, line, and area chart XML generators which all share
 * the same category/value/color grouping pattern.
 *
 * Pure functions - no side effects.
 */

import { groupBy } from '../../algebra/group-by';
import type { DataRow, EncodingSpec } from '../../grammar/spec';
import type { SeriesData } from '../ooxml-types';
import { getDefaultColor } from './style-xml';

/**
 * Options for series data extraction.
 */
export interface ExtractSeriesOptions {
  /** If true, swap x/y for horizontal charts (e.g., horizontal bars) */
  swapAxes?: boolean;
  /** Error message prefix for missing fields */
  chartType?: string;
}

/**
 * Extract series data from data rows and encoding.
 *
 * This is the shared implementation used by bar, line, and area chart generators.
 * Groups data by the color field (if present) into separate series,
 * each with categories, values, and a default color.
 *
 * @param data - Array of data rows
 * @param encoding - Chart encoding specification
 * @param options - Extraction options
 * @returns Array of SeriesData objects
 */
export function extractSeriesData(
  data: DataRow[],
  encoding: EncodingSpec,
  options?: ExtractSeriesOptions,
): SeriesData[] {
  const swapAxes = options?.swapAxes ?? false;
  const chartType = options?.chartType ?? 'Chart';

  // For horizontal charts (e.g., horizontal bars), x and y meanings are swapped
  const categoryField = swapAxes ? encoding.y?.field : encoding.x?.field;
  const valueField = swapAxes ? encoding.x?.field : encoding.y?.field;
  const colorField = encoding.color?.field;

  if (!categoryField || !valueField) {
    throw new Error(`${chartType} requires both category and value fields`);
  }

  // If no color encoding, single series
  if (!colorField) {
    const categories = data.map((row) => row[categoryField]);
    const values = data.map((row) => Number(row[valueField]) || 0);

    return [
      {
        name: valueField,
        categories: categories as (string | number | Date)[],
        values,
        color: getDefaultColor(0),
      },
    ];
  }

  // Group by color field using shared algebra module
  const groups = groupBy(data, colorField);

  // Convert to series array
  const series: SeriesData[] = [];
  let colorIndex = 0;

  for (const [name, rows] of groups) {
    series.push({
      name,
      categories: rows.map((row) => row[categoryField]) as (string | number | Date)[],
      values: rows.map((row) => Number(row[valueField]) || 0),
      color: getDefaultColor(colorIndex),
    });
    colorIndex++;
  }

  return series;
}

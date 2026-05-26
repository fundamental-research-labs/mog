/**
 * Filter utility functions for column type detection and date grouping
 *
 * B4: Filter Dropdown Panel - Excel-parity enhancements
 *
 * Provides utilities for:
 * - Detecting column data types (number, text, date, mixed)
 * - Date column detection and hierarchical grouping
 * - Color extraction for color filtering
 */

import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellValue } from '@mog-sdk/contracts/core';
import {
  getDatePart,
  getDay,
  getMonth,
  getYear,
  isValidDateSerial,
} from '@mog/spreadsheet-utils/datetime';

/**
 * Column data type detection result
 */
export type ColumnType = 'number' | 'text' | 'date' | 'mixed';

/**
 * Date hierarchy structure for tree rendering
 * Maps year -> month -> days
 */
export interface DateHierarchy {
  years: Map<number, YearNode>;
}

export interface YearNode {
  year: number;
  months: Map<number, MonthNode>;
}

export interface MonthNode {
  month: number; // 1-12
  days: Map<number, number[]>; // day -> array of serial numbers
  serials: number[]; // all original serial numbers for this month
}

/**
 * Detect the predominant data type in a column of values.
 *
 * @param values - Array of cell values from the column
 * @returns The detected column type
 */
export function detectColumnType(values: CellValue[]): ColumnType {
  if (values.length === 0) return 'mixed';

  let numberCount = 0;
  let textCount = 0;
  let dateCount = 0;

  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue; // Skip blanks
    }

    if (typeof value === 'boolean') {
      textCount++;
      continue;
    }

    if (typeof value === 'number') {
      // Check if it's a valid date serial
      if (isValidDateSerial(value)) {
        dateCount++;
      } else {
        numberCount++;
      }
      continue;
    }

    if (typeof value === 'string') {
      textCount++;
      continue;
    }

    // Errors count as text
    if (typeof value === 'object' && value !== null && 'type' in value) {
      textCount++;
    }
  }

  // Determine predominant type (>50% threshold)
  const total = numberCount + textCount + dateCount;
  if (total === 0) return 'mixed';

  if (dateCount / total > 0.5) return 'date';
  if (numberCount / total > 0.5) return 'number';
  if (textCount / total > 0.5) return 'text';

  return 'mixed';
}

/**
 * Check if a column contains date values.
 *
 * Uses a 50% threshold - if more than half of non-blank numeric values
 * are valid date serials, the column is considered a date column.
 *
 * @param values - Array of cell values from the column
 * @returns true if column contains predominantly date values
 */
export function isDateColumn(values: CellValue[]): boolean {
  return detectColumnType(values) === 'date';
}

/**
 * Group date serial numbers into a hierarchical structure (Year > Month > Day).
 *
 * Only processes numeric values that are valid date serials.
 *
 * @param dateValues - Array of cell values (should be date serials)
 * @returns Hierarchical date structure
 */
export function groupDatesByHierarchy(dateValues: CellValue[]): DateHierarchy {
  const hierarchy: DateHierarchy = {
    years: new Map(),
  };

  for (const value of dateValues) {
    // Only process numeric values
    if (typeof value !== 'number') continue;

    // Only process valid date serials
    if (!isValidDateSerial(value)) continue;

    const serial = value;
    const datePart = getDatePart(serial);

    try {
      const year = getYear(datePart);
      const month = getMonth(datePart); // 1-12
      const day = getDay(datePart); // 1-31

      // Get or create year node
      let yearNode = hierarchy.years.get(year);
      if (!yearNode) {
        yearNode = {
          year,
          months: new Map(),
        };
        hierarchy.years.set(year, yearNode);
      }

      // Get or create month node
      let monthNode = yearNode.months.get(month);
      if (!monthNode) {
        monthNode = {
          month,
          days: new Map(),
          serials: [],
        };
        yearNode.months.set(month, monthNode);
      }

      // Add day and serial
      let daySerials = monthNode.days.get(day);
      if (!daySerials) {
        daySerials = [];
        monthNode.days.set(day, daySerials);
      }
      daySerials.push(serial);
      monthNode.serials.push(serial);
    } catch (error) {
      // Skip invalid dates
      console.warn('[filter-utils] Invalid date serial:', serial, error);
    }
  }

  return hierarchy;
}

/**
 * Get unique fill (background) or font colors from a column.
 *
 * @param ws - Worksheet instance
 * @param rows - Array of row indices to check
 * @param col - Column index
 * @param type - Color axis to extract ('fill' or 'font'). Vocabulary matches
 * Excel/ECMA-376 and the filter/sort `colorFilter.type` discriminator.
 * @returns Array of unique hex color strings
 */
export async function getUniqueColors(
  ws: Worksheet,
  rows: number[],
  col: number,
  type: 'fill' | 'font',
): Promise<string[]> {
  // Batch-fetch all formats in parallel (1 round-trip vs N sequential IPC calls)
  const formats = await Promise.all(rows.map((row) => ws.formats.get(row, col)));

  const colors = new Set<string>();
  for (const format of formats) {
    if (!format) continue;

    // The CellFormat field is named `backgroundColor` (CSS-style); only the
    // filter/sort *discriminator* changes from 'background' to 'fill'.
    const color = type === 'fill' ? format.backgroundColor : format.fontColor;

    if (color && typeof color === 'string') {
      colors.add(color);
    }
  }

  return Array.from(colors);
}

/**
 * Get month name from month number (1-12)
 */
export function getMonthName(month: number): string {
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return names[month - 1] || 'Unknown';
}

/**
 * Get abbreviated month name from month number (1-12)
 */
export function getMonthAbbr(month: number): string {
  const abbrs = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return abbrs[month - 1] || 'Unk';
}

/**
 * Universal grouping utilities for the charts package.
 *
 * Replaces 8 duplicate grouping implementations across compiler.ts,
 * aggregate.ts, data-util.ts, boxplot.ts, histogram.ts, violin.ts,
 * and scatter-chart-xml.ts with a single, well-tested module.
 *
 * All functions are pure, preserve insertion (first-seen) order,
 * and use String() for key coercion.
 */

import type { DataRow } from '../grammar/spec';

/**
 * Group data rows by a single field value.
 *
 * @param data - Array of data rows
 * @param field - Field name to group by
 * @returns Map where keys are string representations of field values,
 *          values are row arrays. Insertion order is preserved (first-seen order).
 */
export function groupBy(data: DataRow[], field: string): Map<string, DataRow[]> {
  const groups = new Map<string, DataRow[]>();

  for (const row of data) {
    const key = String(row[field]);
    let group = groups.get(key);

    if (group === undefined) {
      group = [];
      groups.set(key, group);
    }

    group.push(row);
  }

  return groups;
}

/**
 * Group data rows by multiple fields (composite key).
 * Uses JSON.stringify for composite keys.
 *
 * @param data - Array of data rows
 * @param fields - Array of field names for composite grouping key
 * @returns Map with JSON-stringified composite keys
 */
export function groupByFields(data: DataRow[], fields: string[]): Map<string, DataRow[]> {
  const groups = new Map<string, DataRow[]>();

  for (const row of data) {
    const key = JSON.stringify(fields.map((f) => row[f]));
    let group = groups.get(key);

    if (group === undefined) {
      group = [];
      groups.set(key, group);
    }

    group.push(row);
  }

  return groups;
}

/**
 * Group data rows using a custom accessor function.
 * Most general form -- supports the ResolvedEncoding.accessor pattern.
 *
 * @param data - Array of data rows
 * @param accessor - Function that extracts the grouping key from each row
 * @returns Map where keys are string representations of accessor results
 */
export function groupByAccessor(
  data: DataRow[],
  accessor: (datum: DataRow) => unknown,
): Map<string, DataRow[]> {
  const groups = new Map<string, DataRow[]>();

  for (const row of data) {
    const key = String(accessor(row));
    let group = groups.get(key);

    if (group === undefined) {
      group = [];
      groups.set(key, group);
    }

    group.push(row);
  }

  return groups;
}

/**
 * Get unique values of a field in first-seen order.
 * Replaces the inline `const seen = new Set<string>()` pattern.
 *
 * @param data - Array of data rows
 * @param field - Field name to extract unique values from
 * @returns Array of unique string values in first-seen order
 */
export function uniqueValues(data: DataRow[], field: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of data) {
    const value = String(row[field]);

    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

/**
 * Count occurrences per category. Used by stacking for normalization.
 *
 * @param data - Array of data rows
 * @param field - Field name to count by
 * @returns Map of field value (stringified) to count
 */
export function countByField(data: DataRow[], field: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const row of data) {
    const key = String(row[field]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

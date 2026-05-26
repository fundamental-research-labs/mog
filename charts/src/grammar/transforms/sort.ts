/**
 * Sort Transform
 *
 * Sorts data rows by one or more fields.
 *
 * Pure functions - no side effects.
 */

import type { DataRow, SortSpec } from '../spec';

// =============================================================================
// Sort Transform
// =============================================================================

/**
 * Apply a sort transform to data.
 *
 * @param data - Input data rows
 * @param sort - Sort specification(s)
 * @returns Sorted data rows (new array)
 */
export function applySort(data: DataRow[], sort: SortSpec | SortSpec[]): DataRow[] {
  // Create a copy to avoid mutating input
  const sorted = [...data];

  // Normalize to array
  const specs = Array.isArray(sort) ? sort : [sort];

  // Sort with multi-field comparison
  sorted.sort((a, b) => {
    for (const spec of specs) {
      const cmp = compareValues(a[spec.field], b[spec.field], spec.order);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  return sorted;
}

/**
 * Compare two values for sorting.
 */
function compareValues(
  a: unknown,
  b: unknown,
  order: 'ascending' | 'descending' = 'ascending',
): number {
  // Handle null/undefined - put at end
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;

  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  let cmp = 0;

  // Compare by type
  if (typeof a === 'number' && typeof b === 'number') {
    // Handle NaN - put at end
    if (isNaN(a) && isNaN(b)) return 0;
    if (isNaN(a)) return 1;
    if (isNaN(b)) return -1;
    cmp = a - b;
  } else if (typeof a === 'string' && typeof b === 'string') {
    cmp = a.localeCompare(b);
  } else if (a instanceof Date && b instanceof Date) {
    cmp = a.getTime() - b.getTime();
  } else {
    // Convert to string for comparison
    cmp = String(a).localeCompare(String(b));
  }

  return order === 'descending' ? -cmp : cmp;
}

// =============================================================================
// Sort Utilities
// =============================================================================

/**
 * Sort data by a single field ascending.
 */
export function sortAscending(data: DataRow[], field: string): DataRow[] {
  return applySort(data, { field, order: 'ascending' });
}

/**
 * Sort data by a single field descending.
 */
export function sortDescending(data: DataRow[], field: string): DataRow[] {
  return applySort(data, { field, order: 'descending' });
}

/**
 * Sort data by multiple fields.
 */
export function sortByFields(
  data: DataRow[],
  fields: Array<{ field: string; order?: 'ascending' | 'descending' }>,
): DataRow[] {
  return applySort(
    data,
    fields.map((f) => ({
      field: f.field,
      order: f.order ?? 'ascending',
    })),
  );
}

/**
 * Sort data using a custom comparator function.
 */
export function sortByComparator(
  data: DataRow[],
  comparator: (a: DataRow, b: DataRow) => number,
): DataRow[] {
  return [...data].sort(comparator);
}

/**
 * Get sorted unique values from a field.
 */
export function getSortedUniqueValues(
  data: DataRow[],
  field: string,
  order: 'ascending' | 'descending' = 'ascending',
): unknown[] {
  const values = [...new Set(data.map((d) => d[field]))];

  return values.sort((a, b) => compareValues(a, b, order));
}

/**
 * Sort data based on the order of values in a given array.
 * Useful for custom categorical ordering.
 */
export function sortByCustomOrder(data: DataRow[], field: string, order: unknown[]): DataRow[] {
  const orderMap = new Map(order.map((v, i) => [v, i]));

  return [...data].sort((a, b) => {
    const aIndex = orderMap.get(a[field]) ?? Infinity;
    const bIndex = orderMap.get(b[field]) ?? Infinity;
    return aIndex - bIndex;
  });
}

/**
 * Sort data to ensure stable ordering (maintains original order for equal values).
 */
export function stableSort(
  data: DataRow[],
  comparator: (a: DataRow, b: DataRow) => number,
): DataRow[] {
  // Add original index for stable sorting
  const indexed = data.map((row, index) => ({ row, index }));

  indexed.sort((a, b) => {
    const cmp = comparator(a.row, b.row);
    return cmp !== 0 ? cmp : a.index - b.index;
  });

  return indexed.map((item) => item.row);
}

/**
 * Reverse the order of data rows.
 */
export function reverseData(data: DataRow[]): DataRow[] {
  return [...data].reverse();
}

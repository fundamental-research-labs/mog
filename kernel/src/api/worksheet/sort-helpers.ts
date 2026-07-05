/**
 * Map public API sort direction to bridge SortOrder.
 *
 * The public SortColumn uses 'asc'/'desc',
 * BridgeSortCriterion.direction is SortOrder = 'asc' | 'desc'.
 */
export function mapSortDirection(direction: 'asc' | 'desc' | undefined): 'asc' | 'desc' {
  if (direction === 'desc') return 'desc';
  return 'asc';
}

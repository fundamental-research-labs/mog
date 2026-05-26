/**
 * Hook: useViewsForTable
 *
 * Returns the list of views applicable for a given table.
 * Filters views by applicability and scope.
 *
 */

import type { AppTableInfo, ViewContribution } from '@mog-sdk/contracts/apps';
import { useMemo } from 'react';
import { getViewsForTable } from '../view-discovery';

/**
 * Get views applicable for a table.
 *
 * This hook automatically filters views based on:
 * - Table structure (via view.applicableWhen)
 * - View scope (all-tables vs app-tables-only)
 * - Active app context (for app-scoped views)
 *
 * @param table - Table metadata (or null if no table selected)
 * @param activeAppId - Currently active app ID (optional)
 * @returns Array of applicable view contributions
 *
 * @example
 * ```typescript
 * function ViewTabBar({ table }: { table: AppTableInfo }) {
 * const views = useViewsForTable(table);
 *
 * return (
 * <div className="view-tabs">
 * {views.map(view => (
 * <button key={view.id}>
 * {view.icon} {view.name}
 * </button>
 * ))}
 * </div>
 * );
 * }
 * ```
 */
export function useViewsForTable(
  table: AppTableInfo | null,
  activeAppId?: string,
): ViewContribution[] {
  return useMemo(() => {
    if (!table) {
      return [];
    }

    return getViewsForTable(table, activeAppId);
  }, [table, activeAppId]);
}

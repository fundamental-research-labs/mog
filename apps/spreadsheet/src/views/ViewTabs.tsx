/**
 * ViewTabs Component
 *
 * Renders tabs for all views applicable to a table.
 * Filters views by applicability and scope, then renders a tab bar.
 *
 * This component provides the UI for switching between different
 * visualizations of the same table (Grid, Kanban, Timeline, etc.).
 *
 * Uses Radix Tabs (via shell wrapper) for:
 * - Arrow Left/Right keyboard navigation between tabs
 * - Home/End to jump to first/last tab
 * - Proper ARIA tablist/tab/tabpanel semantics
 * - Roving tabindex for correct Tab key behavior
 *
 */

import type { Tab } from '@mog/shell';
import { Tabs } from '@mog/shell';
import type { AppTableInfo } from '@mog-sdk/contracts/apps';
import { useMemo } from 'react';
import { useViewsForTable } from './hooks';

export interface ViewTabsProps {
  /**
   * The table to show views for.
   */
  table: AppTableInfo;

  /**
   * Currently active view ID.
   */
  activeViewId: string;

  /**
   * Callback when a view tab is clicked.
   * @param viewId - The view ID to switch to
   */
  onViewChange: (viewId: string) => void;

  /**
   * Currently active app ID (for filtering app-scoped views).
   */
  activeAppId?: string;

  /**
   * Optional CSS class name for the container.
   */
  className?: string;
}

/**
 * ViewTabs - Renders a tab bar of applicable views for a table.
 *
 * @example
 * ```tsx
 * <ViewTabs
 * table={table}
 * activeViewId="kanban"
 * onViewChange={(viewId) => setActiveView(viewId)}
 * />
 * ```
 */
export function ViewTabs({
  table,
  activeViewId,
  onViewChange,
  activeAppId,
  className = 'view-tabs',
}: ViewTabsProps) {
  const views = useViewsForTable(table, activeAppId);

  const tabs: Tab[] = useMemo(
    () =>
      views.map((view) => ({
        id: view.id,
        label: (
          <>
            {view.icon && <span className="view-tab-icon">{view.icon}</span>}
            <span className="view-tab-name">{view.name}</span>
          </>
        ),
        title: view.name,
      })),
    [views],
  );

  if (views.length === 0) {
    return null; // No views available for this table
  }

  return (
    <Tabs
      tabs={tabs}
      activeTab={activeViewId}
      onTabChange={onViewChange}
      className={className}
      ariaLabel="View tabs"
      size="sm"
    />
  );
}

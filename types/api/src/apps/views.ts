/**
 * View Contribution Types for Apps
 *
 * Apps can contribute custom views that appear in the view tabs for applicable tables.
 * This enables apps to provide specialized visualizations for their data.
 *
 */

import type { AppTableInfo } from './types';

/** Framework-agnostic component type. Consumers cast to their framework's component type. */
type ComponentType<P> = (props: P) => unknown;

/**
 * Props passed to view components contributed by apps.
 *
 * Views receive the kernel API and table/view context.
 * The config object is view-specific and can be persisted.
 */
export interface ViewProps {
  /**
   * Unique view instance ID.
   * Multiple instances of the same view type can exist.
   */
  viewId: string;

  /**
   * The table this view is rendering.
   */
  tableId: string;

  /**
   * View-specific configuration (persisted).
   * Structure depends on the view type.
   * @example { groupByColumn: 'Status', cardSize: 'medium' }
   */
  config: Record<string, unknown>;

  /**
   * Callback to update view configuration.
   * Shell persists the updated config.
   */
  onConfigChange?: (config: Record<string, unknown>) => void;
}

/**
 * A view contribution from an app.
 *
 * Views appear in the view tabs for tables where they're applicable.
 * Apps can contribute specialized views (e.g., CRM Pipeline, Project Gantt).
 *
 * Design principle: Views are discovered at runtime and filtered by applicability.
 *
 * @example
 * ```typescript
 * const pipelineView: ViewContribution = {
 *   id: 'crm-pipeline',
 *   name: 'Pipeline',
 *   icon: '🔄',
 *   appId: 'crm',
 *   scope: 'app-tables-only',
 *   applicableWhen: (table) => table.name === 'Deals',
 *   component: PipelineViewComponent,
 *   defaultConfig: { cardSize: 'medium' }
 * };
 * ```
 */
export interface ViewContribution {
  /**
   * Unique view ID (scoped to app).
   * Format: `{appId}-{viewName}` recommended.
   * @example 'crm-pipeline', 'analytics-chart'
   */
  id: string;

  /**
   * Display name shown in view tabs.
   * @example 'Pipeline', 'Chart', 'Board'
   */
  name: string;

  /**
   * Icon for the view tab (emoji or icon identifier).
   * @example '🔄', 'chart-bar', '📊'
   */
  icon?: string;

  /**
   * The app that contributes this view.
   * Used to scope view visibility and determine ownership.
   */
  appId: string;

  /**
   * Scope determines where this view appears.
   *
   * - 'app-tables-only': Only for tables created/owned by this app.
   *   Use this for app-specific views that only make sense for the app's data.
   *   @example CRM Pipeline view only for Deals table
   *
   * - 'all-tables': For any table that matches applicableWhen.
   *   Use this for generic views that work on any compatible table structure.
   *   @example Generic chart view for tables with numeric columns
   */
  scope: 'app-tables-only' | 'all-tables';

  /**
   * Determines if this view is applicable for a given table.
   *
   * Called for each table to filter view tabs.
   * Should check table structure (columns, types) to determine compatibility.
   *
   * Performance note: Keep this function fast - it's called frequently.
   * Avoid async operations or expensive computations.
   *
   * @param table - Table metadata to check
   * @returns true if this view can render the table
   *
   * @example
   * // Kanban requires a select/status column
   * (table) => table.columns.some(c => c.type.kind === 'select')
   *
   * @example
   * // Timeline requires start/end date columns
   * (table) => {
   *   const hasStart = table.columns.some(c => c.type.kind === 'date');
   *   return hasStart;
   * }
   */
  applicableWhen: (table: AppTableInfo) => boolean;

  /**
   * The React component that renders this view.
   * Receives ViewProps with kernel API and configuration.
   *
   * Component should be exported from the app and can use any React features.
   * The Shell handles mounting, unmounting, and prop updates.
   */
  component: ComponentType<ViewProps>;

  /**
   * Default configuration for new instances of this view.
   * Merged with user-specific config.
   *
   * @example
   * {
   *   cardSize: 'medium',
   *   groupByColumn: null, // auto-detect
   *   showEmptyGroups: true
   * }
   */
  defaultConfig?: Record<string, unknown>;
}

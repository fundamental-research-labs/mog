/**
 * View Discovery System
 *
 * Discovers and filters views from two sources:
 * 1. Built-in views (Grid, Kanban, Timeline, etc.)
 * 2. App-contributed views (from app manifests)
 *
 * Views are filtered by applicability and scope to determine which
 * views should appear in the view tabs for a given table.
 *
 */

import type {
  AppManifest,
  AppTableInfo,
  ViewContribution,
  ViewProps,
} from '@mog-sdk/contracts/apps';
import { VIEW_REGISTRY } from './registry';

import { APP_MANIFESTS } from '@mog/shell/host/app-registry';

/**
 * Built-in views from the VIEW_REGISTRY.
 *
 * These are the core views registered in shell/src/views/index.ts:
 * - Grid, Kanban, Timeline, Calendar, Gallery, Form
 *
 * We convert ViewDefinition → ViewContribution format for unified handling.
 */
function getBuiltInViews(): ViewContribution[] {
  const definitions = VIEW_REGISTRY.list();

  return definitions.map((def) => {
    // Determine applicability based on required columns
    const applicableWhen = (table: AppTableInfo): boolean => {
      if (!def.requiredColumns || def.requiredColumns.length === 0) {
        return true; // No requirements = always applicable
      }

      // Check if table has the required column types
      return def.requiredColumns.every((requiredType) => {
        return table.columns.some((col) => col.type.kind === requiredType);
      });
    };

    // Extract React component if available (for react rendering mode)
    // Built-in views use ReactViewProps (shell internal type) while
    // ViewContribution expects ViewProps (app-facing type).
    // The component signatures are similar but not identical.
    const component = def.component;

    if (!component && def.renderingMode === 'react') {
      console.warn(
        `[view-discovery] React view '${def.type}' has no component. ` +
          `This view will not be available.`,
      );
    }

    // Cast is safe because Shell handles built-in views specially via renderingMode.
    // Built-in views use ReactViewProps (shell-internal) while ViewContribution
    // expects ViewProps (app-facing). The Shell dispatches by renderingMode,
    // so this component is never called with mismatched props.
    const viewComponent = (component || (() => null)) as (props: ViewProps) => unknown;

    return {
      id: def.type,
      name: def.name,
      icon: def.icon,
      appId: '__builtin__', // Special app ID for built-in views
      scope: 'all-tables' as const,
      applicableWhen,
      // For built-in views, we need the component
      // If it's imperative mode (Grid), component will be undefined
      // but we still include it in the list (Shell handles mounting differently)
      component: viewComponent,
      defaultConfig: def.defaultConfig,
    } satisfies ViewContribution;
  });
}

/**
 * App-contributed views from app manifests.
 *
 * Apps declare views in their manifest.views array.
 * These views are discovered at build time by the Vite plugin.
 */
function getAppContributedViews(): ViewContribution[] {
  const allViews: ViewContribution[] = [];

  // Iterate through all app manifests
  const manifests = APP_MANIFESTS as Record<string, AppManifest>;
  for (const manifest of Object.values(manifests)) {
    if (!manifest.views || manifest.views.length === 0) {
      continue;
    }

    // Add all views from this app
    allViews.push(...manifest.views);
  }

  return allViews;
}

/**
 * Get all views (built-in + app-contributed).
 *
 * This is the complete catalog of available views.
 * Filter with getViewsForTable() to get views applicable to a specific table.
 *
 * @returns Array of all view contributions
 */
export function getAllViews(): ViewContribution[] {
  const builtInViews = getBuiltInViews();
  const appViews = getAppContributedViews();

  return [...builtInViews, ...appViews];
}

/**
 * Get views applicable for a specific table.
 *
 * Filters views by:
 * 1. applicableWhen() check (table structure requirements)
 * 2. scope check (app-tables-only vs all-tables)
 *
 * The activeAppId is used to filter app-tables-only views.
 * If an app contributes a view with scope='app-tables-only', it only
 * appears when that app is active AND the table belongs to the app.
 *
 * @param table - Table metadata to check against
 * @param activeAppId - Currently active app ID (for scoping)
 * @returns Array of views that can render this table
 *
 * @example
 * ```typescript
 * const table = { name: 'Deals', columns: [...], ... };
 * const views = getViewsForTable(table, 'crm');
 * // Returns: [Grid, Kanban, Timeline, CRM Pipeline, ...]
 * ```
 */
export function getViewsForTable(table: AppTableInfo, activeAppId?: string): ViewContribution[] {
  return getAllViews().filter((view) => {
    // 1. Check applicableWhen
    if (!view.applicableWhen(table)) {
      return false;
    }

    // 2. Check scope
    if (view.scope === 'app-tables-only') {
      // Only show if this is the active app's table
      // TODO (Future): Tables should track which app created them
      // For now, we just check if the app is active
      if (view.appId !== activeAppId) {
        return false;
      }
    }

    // 3. All checks passed
    return true;
  });
}

/**
 * Get a specific view by ID.
 *
 * @param viewId - View identifier
 * @returns View contribution or undefined if not found
 */
export function getView(viewId: string): ViewContribution | undefined {
  return getAllViews().find((v) => v.id === viewId);
}

/**
 * Check if a view exists.
 *
 * @param viewId - View identifier
 * @returns true if view is registered
 */
export function hasView(viewId: string): boolean {
  return getView(viewId) !== undefined;
}

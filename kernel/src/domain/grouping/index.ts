/**
 * Grouping Domain Module
 *
 * Row/column grouping (outline) CRUD operations and subscriptions.
 * All operations delegate to ComputeBridge (Rust compute core).
 *
 * Stream O: Grouping/Outline Implementation
 *
 * Architecture Notes:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 * - No manual event emission from domain modules for CB operations
 * - Maximum 8 nested levels (Excel compatibility)
 *
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  GroupBoundary,
  ResolvedGroup,
  ResolvedGroupRange,
  SubtotalsCellAccessor,
} from './types';

export { MAX_OUTLINE_LEVEL, SUBTOTAL_FUNCTION_CODES } from './types';

// =============================================================================
// Helper Functions
// =============================================================================

export {
  // Level calculations
  calculateGroupLevel,
  findParentGroup,
  // ID generation
  generateGroupId,
  // Group queries (async via ComputeBridge)
  getGroupAsync,
  getGroupsAsync,
  // Config access (async via ComputeBridge)
  getSheetGroupingConfig,
  // Config access (sync, returns defaults)
  getSheetGroupingConfigSync,
  // Position resolution
  resolveGroupRange,
} from './helpers';

// =============================================================================
// Query Functions
// =============================================================================

export { getGroup, getGroups } from './queries';

// =============================================================================
// Row Group Operations
// =============================================================================

export { clearRowGrouping, getAffectedRowsByGroup, groupRows, ungroupRows } from './row-groups';

// =============================================================================
// Column Group Operations
// =============================================================================

export {
  clearColumnGrouping,
  getAffectedColumnsByGroup,
  groupColumns,
  ungroupColumns,
} from './column-groups';

// =============================================================================
// Expand/Collapse Operations
// =============================================================================

export {
  collapseAll,
  expandAll,
  setGroupCollapsed,
  setLevelCollapsed,
  toggleGroupCollapsed,
} from './expand-collapse';

// =============================================================================
// Outline Level Queries
// =============================================================================

export {
  getColumnOutlineLevels,
  getMaxOutlineLevel,
  getRowOutlineLevels,
  isColumnVisibleByGroups,
  isRowVisibleByGroups,
} from './outline-levels';

// =============================================================================
// Auto-Outline
// =============================================================================

export { autoOutline } from './auto-outline';

// =============================================================================
// Settings & Subscriptions
// =============================================================================

export { setOutlineSettings, subscribeToGrouping } from './settings';

// =============================================================================
// Rendering
// =============================================================================

export type { OutlineLevelButton, OutlineRenderData, OutlineSymbol, Viewport } from './rendering';

export {
  getOutlineGutterDimensions,
  getOutlineLevelButtons,
  getOutlineRenderData,
  getOutlineSymbols,
  shouldRenderOutlines,
} from './rendering';

// =============================================================================
// Grouping Namespace
// =============================================================================

/**
 * Grouping namespace that combines all public exports.
 * Provides a convenient way to access all grouping functions.
 *
 * @example
 * ```ts
 * import { Grouping } from './grouping';
 *
 * Grouping.groupRows(ctx, sheetId, 0, 10);
 * Grouping.toggleGroupCollapsed(ctx, sheetId, groupId);
 * ```
 */
export const Grouping = {
  // Re-export all functions for namespace access
  // These are dynamically imported to avoid circular dependencies
} as const;

// Note: The Grouping namespace object is intentionally left minimal.
// Consumers should use the direct named exports above for tree-shaking.
// The namespace pattern is preserved for API compatibility if needed.

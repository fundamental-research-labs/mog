/**
 * Ribbon Collapse Context
 *
 * Provides collapse state to toolbar components via React context.
 *
 * ARCHITECTURE:
 * - RibbonCollapseContext: Provided by TabbedToolbar, consumed by ToolbarGroup
 * - GroupRenderModeContext: Provided by ToolbarGroup, consumed by RibbonButton and other children
 *
 * This follows the coordinator pattern:
 * - useRibbonCollapse hook (coordinator) computes collapse level from width
 * - Context broadcasts the level to all groups
 * - Each group determines its render mode from config + level
 * - Groups provide GroupRenderModeContext to their children
 *
 */

import { createContext, useContext } from 'react';

import type { GroupRenderMode } from '@mog-sdk/contracts/ribbon';
// =============================================================================
// Ribbon Collapse Context (provided by TabbedToolbar)
// =============================================================================

/**
 * Collapse state broadcast to every group.
 *
 * Progressive collapse is PER-GROUP: `groupModes` maps a group's key to the
 * render mode the coordinator has assigned it. A group missing from the map
 * renders at its most-expanded rung (`full`-equivalent). There is no single
 * global "level" anymore — the coordinator collapses groups independently,
 * least-important first, so the ribbon fills the available width.
 */
export interface RibbonCollapseContextState {
  /** Render mode assigned to each group, keyed by group key. */
  groupModes: Record<string, GroupRenderMode>;
  /** Container width in pixels (consumed by width-sensitive groups, e.g. Charts). */
  containerWidth: number;
}

/**
 * Default state for collapse context: nothing collapsed.
 */
const DEFAULT_COLLAPSE_STATE: RibbonCollapseContextState = {
  groupModes: {},
  containerWidth: 1920,
};

/**
 * Context for ribbon collapse state.
 * Provided by TabbedToolbar, consumed by ToolbarGroup.
 */
const RibbonCollapseContext = createContext<RibbonCollapseContextState>(DEFAULT_COLLAPSE_STATE);

/**
 * Provider component for ribbon collapse state.
 */
export const RibbonCollapseProvider = RibbonCollapseContext.Provider;

/**
 * Hook to access the current ribbon collapse state.
 *
 * Used by ToolbarGroup to read the render mode the coordinator assigned to it.
 *
 * @returns Per-group render modes and container width
 *
 * @example
 * ```tsx
 * function ToolbarGroup({ groupKey, children }) {
 * const { groupModes } = useRibbonCollapseLevel();
 * const renderMode = groupModes[groupKey] ?? 'full';
 * // ...
 * }
 * ```
 */
export function useRibbonCollapseLevel(): RibbonCollapseContextState {
  return useContext(RibbonCollapseContext);
}

// =============================================================================
// Group Render Mode Context (provided by ToolbarGroup)
// =============================================================================

/**
 * Context for the current group's render mode.
 * Provided by ToolbarGroup, consumed by RibbonButton and other children.
 */
const GroupRenderModeContext = createContext<GroupRenderMode>('full');

/**
 * Provider component for group render mode.
 */
export const GroupRenderModeProvider = GroupRenderModeContext.Provider;

/**
 * Hook for child components to read their group's render mode.
 *
 * RibbonButton and other adaptive children use this to adjust their layout.
 * They don't need to know about collapse levels - just the render mode.
 *
 * @returns Current render mode ('full' | 'compact' | 'icons' | 'dropdown' | 'hidden')
 *
 * @example
 * ```tsx
 * function RibbonButton({ layout: preferredLayout, ...props }) {
 * const groupMode = useGroupRenderMode;
 *
 * // In icons mode, all buttons become icon-only
 * const actualLayout = groupMode === 'icons' ? 'icon-only' : preferredLayout;
 *
 * // ...
 * }
 * ```
 */
export function useGroupRenderMode(): GroupRenderMode {
  return useContext(GroupRenderModeContext);
}

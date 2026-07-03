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

import type { CollapseLevel, GroupRenderMode, RibbonCollapseState } from '@mog-sdk/contracts/ribbon';
// =============================================================================
// Ribbon Collapse Context (provided by TabbedToolbar)
// =============================================================================

export interface RibbonCollapseContextState extends RibbonCollapseState {
  /**
   * Collapse level derived from container width before content-aware overflow
   * escalation. When omitted, consumers should treat it as equal to `level`.
   */
  widthLevel?: CollapseLevel;
}

/**
 * Default state for collapse context.
 * Level 0 = full expansion (largest screens).
 */
const DEFAULT_COLLAPSE_STATE: RibbonCollapseContextState = {
  level: 0,
  widthLevel: 0,
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
 * Used by ToolbarGroup to determine render mode based on collapse config.
 *
 * @returns Current collapse level and container width
 *
 * @example
 * ```tsx
 * function ToolbarGroup({ collapseConfig, children }) {
 * const { level } = useRibbonCollapseLevel;
 * const renderMode = collapseConfig?.levels[level] ?? 'full';
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

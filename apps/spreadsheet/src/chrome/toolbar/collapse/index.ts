/**
 * Ribbon Collapse System - Engine Implementation
 *
 * This module provides the implementation for ribbon responsive collapse.
 *
 * Usage:
 * ```tsx
 * // In TabbedToolbar:
 * import { useRibbonCollapse, RibbonCollapseProvider } from './collapse';
 *
 * function TabbedToolbar() {
 * const containerRef = useRef<HTMLDivElement>(null);
 * const collapseState = useRibbonCollapse(containerRef);
 *
 * return (
 * <RibbonCollapseProvider value={collapseState}>
 * <div ref={containerRef}>...</div>
 * </RibbonCollapseProvider>
 * );
 * }
 *
 * // In ToolbarGroup:
 * import { useRibbonCollapseLevel, GroupRenderModeProvider } from './collapse';
 *
 * function ToolbarGroup({ collapseConfig, children }) {
 * const { level } = useRibbonCollapseLevel;
 * const renderMode = collapseConfig?.levels[level] ?? 'full';
 *
 * return (
 * <GroupRenderModeProvider value={renderMode}>
 * {children}
 * </GroupRenderModeProvider>
 * );
 * }
 *
 * // In RibbonButton:
 * import { useGroupRenderMode } from './collapse';
 *
 * function RibbonButton({ layout, ...props }) {
 * const groupMode = useGroupRenderMode;
 * const actualLayout = groupMode === 'icons' ? 'icon-only' : layout;
 * // ...
 * }
 * ```
 *
 */

// =============================================================================
// Context Providers and Hooks
// =============================================================================

export {
  // Group-level context (provided by ToolbarGroup)
  GroupRenderModeProvider,
  // Ribbon-level context (provided by TabbedToolbar)
  RibbonCollapseProvider,
  useGroupRenderMode,
  useRibbonCollapseLevel,
} from './context';

// =============================================================================
// Coordinator Hook
// =============================================================================

export { useRibbonCollapse } from './use-ribbon-collapse';

// =============================================================================
// Testing Exports
// =============================================================================

export { __testing__ } from './use-ribbon-collapse';

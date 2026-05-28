/**
 * Contextual Tab Framework
 *
 * Exports for the contextual tab system.
 *
 */

export {
  CONTEXTUAL_TAB_REGISTRY,
  getVisibleContextualTabs,
  isContextualTabVisible,
} from './contextual-tab-registry';
export type {
  ContextualTabConfig,
  ContextualTabContext,
  ContextualTabProps,
  DiagramSelectionContext,
  PivotSelectionContext,
} from './contextual-tab-registry';
export { useContextualTabs } from './useContextualTabs';

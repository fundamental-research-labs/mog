/**
 * useContextualTabs Hook
 *
 * Determines which contextual tabs should be shown based on current selection
 * and object state. This hook integrates with the contextual tab registry.
 *
 * Usage:
 * ```tsx
 * function TabbedToolbar() {
 * const contextualTabs = useContextualTabs;
 * // contextualTabs contains configs for all visible contextual tabs
 * }
 * ```
 *
 * PERFORMANCE: This hook NO LONGER subscribes to selection state directly.
 * Instead, it reads derived boolean values from UIStore which are updated by
 * coordinator modules (SparklineSelectionCoordination, TableSelectionCoordination).
 * This prevents toolbar re-renders on every cell selection change.
 *
 */

import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import type { RibbonTabId } from '@mog-sdk/contracts/actions';
import type { RibbonVisibilityTabKey } from '@mog-sdk/contracts/ribbon';
import { isRibbonPathVisible } from '@mog-sdk/contracts/ribbon';
import { useDocumentContext } from '../../../internal-api';
import { useFeatureGates } from '../../../infra/context/feature-gates-context';
import { useChartUI } from '../../../hooks/charts/use-chart';
import { useFloatingObject } from '../../../hooks/objects/use-floating-object';
import { useObjectInteraction } from '../../../hooks/objects/use-object-interaction';
import { useTableSelection } from '../../../hooks/selection/use-table-selection';
import type {
  ContextualTabConfig,
  ContextualTabContext,
  ObjectInteractionContext,
  SlicerSelectionContext,
  DiagramSelectionContext,
  SparklineSelectionContext,
  PivotSelectionContext,
} from './contextual-tab-registry';
import { getVisibleContextualTabs } from './contextual-tab-registry';

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook that determines which contextual tabs should be shown
 * based on current selection and object state.
 *
 * PERFORMANCE: This hook reads derived boolean values from UIStore instead of
 * subscribing to selection state directly. The coordinator modules handle the
 * selection-to-boolean computation:
 * - SparklineSelectionCoordination → hasSparklineInActiveCell
 * - TableSelectionCoordination → selectedTableId (via useTableSelection)
 *
 * This ensures the toolbar only re-renders when contextual tab visibility
 * ACTUALLY changes, not on every cell selection.
 *
 * @returns Array of contextual tab configs that should be visible
 */
export function useContextualTabs(): ContextualTabConfig[] {
  const tableSelection = useTableSelection();
  const chartUI = useChartUI();
  const objectInteraction = useObjectInteraction();
  const featureGates = useFeatureGates();
  const { uiStore } = useDocumentContext();
  // Get slicer selection state from UIStore
  // Note: The actual selectedSlicerId may be managed elsewhere, but we use UIStore
  // for consistency with other UI state
  const selectedSlicerId = useStore(uiStore, (s) => s.selectedSlicerId ?? null);

  // PERFORMANCE: Read sparkline detection from UIStore instead of computing it here.
  // SparklineSelectionCoordination updates this boolean when selection enters/exits
  // a cell containing a sparkline. This prevents re-renders on every cell selection.
  const hasSparklineInActiveCell = useStore(
    uiStore,
    (s) => s.contextualTabs.hasSparklineInActiveCell,
  );
  const hasSelectedChartObject = useStore(uiStore, (s) => s.contextualTabs.hasSelectedChartObject);

  // Diagram selection state from UIStore
  // Read selectedDiagramId from the Diagram UI slice
  const selectedDiagramId = useStore(uiStore, (s) => s.selectedDiagramId);
  const selectedPivotId = useStore(uiStore, (s) => s.pivot.selectedPivotId);

  // Determine object type for selected objects
  const firstSelectedId = objectInteraction.selectedIds[0] ?? '';
  const firstObject = useFloatingObject(firstSelectedId);

  const objectInteractionContext: ObjectInteractionContext = useMemo(() => {
    const { selectedIds } = objectInteraction;
    if (selectedIds.length === 0) {
      return { selectedIds: [], selectedObjectType: null };
    }

    let selectedObjectType: ObjectInteractionContext['selectedObjectType'] = null;
    if (hasSelectedChartObject) {
      selectedObjectType = 'chart';
    } else if (firstObject) {
      const type = firstObject.type;
      // Only match contextual tab types (chart, picture, textbox, shape)
      // drawing is a valid FloatingObjectType but not currently used
      if (type === 'chart' || type === 'picture' || type === 'textbox' || type === 'shape') {
        selectedObjectType = type;
      }
    }

    return { selectedIds, selectedObjectType };
  }, [objectInteraction, firstObject, hasSelectedChartObject]);

  // Slicer selection context
  const slicerSelectionContext: SlicerSelectionContext = useMemo(
    () => ({
      selectedSlicerId,
    }),
    [selectedSlicerId],
  );

  // Sparkline selection context - now read from UIStore (set by SparklineSelectionCoordination)
  const sparklineSelectionContext: SparklineSelectionContext = useMemo(
    () => ({
      hasSparklineInActiveCell,
    }),
    [hasSparklineInActiveCell],
  );

  // Diagram selection context
  // Read from UIStore Diagram slice
  const diagramSelectionContext: DiagramSelectionContext = useMemo(
    () => ({
      selectedDiagramId,
    }),
    [selectedDiagramId],
  );

  const pivotSelectionContext: PivotSelectionContext = useMemo(
    () => ({
      selectedPivotId,
    }),
    [selectedPivotId],
  );

  // Build context object for tab visibility checks
  const context: ContextualTabContext = useMemo(
    () => ({
      tableSelection,
      chartUI,
      objectInteraction: objectInteractionContext,
      slicerSelection: slicerSelectionContext,
      sparklineSelection: sparklineSelectionContext,
      diagramSelection: diagramSelectionContext,
      pivotSelection: pivotSelectionContext,
    }),
    [
      tableSelection,
      chartUI,
      objectInteractionContext,
      slicerSelectionContext,
      sparklineSelectionContext,
      diagramSelectionContext,
      pivotSelectionContext,
    ],
  );

  // Compute visible contextual tabs
  // This will re-compute whenever any of the context dependencies change
  const visibleTabs = useMemo(() => {
    const contextualTabs = getVisibleContextualTabs(context);
    return contextualTabs.filter((tab) => {
      const visibilityKey = contextualTabVisibilityKey(tab.id);
      return visibilityKey
        ? isRibbonPathVisible(featureGates.ribbonVisibility, [visibilityKey])
        : true;
    });
  }, [context, featureGates.ribbonVisibility]);

  // visible-tabs ownership: push contextual ids into the ribbon slice so
  // `setActiveRibbonTab` can validate against `[...visibleBaseTabs,
  // ...contextualTabIds]`. The hook still returns the configs above
  // for label rendering — only the *id set* now flows through the
  // store. Memoize the id array on `visibleTabs` identity so the
  // effect runs only when the contextual id set actually changes.
  const contextualIds = useMemo(() => visibleTabs.map((c) => c.id as RibbonTabId), [visibleTabs]);
  useEffect(() => {
    uiStore.getState().setContextualTabIds(contextualIds);
  }, [contextualIds, uiStore]);

  return visibleTabs;
}

function contextualTabVisibilityKey(tabId: string): RibbonVisibilityTabKey | null {
  switch (tabId) {
    case 'table-design':
      return 'tableDesign';
    case 'chart-design':
      return 'chartDesign';
    case 'picture-tools':
      return 'pictureTools';
    case 'slicer-tools':
      return 'slicerTools';
    case 'sparkline-tools':
      return 'sparklineTools';
    case 'diagram-design':
      return 'diagramDesign';
    case 'diagram-format':
      return 'diagramFormat';
    default:
      return null;
  }
}

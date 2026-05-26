/**
 * Chart Actor Access Implementation
 *
 * Implements ChartAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for handlers.
 *
 * NOTE: Selection/drag/resize has been removed - handled by objectInteractionActor.
 * Use ObjectAccessor for those operations.
 *
 * @module engine/state/coordinator/actor-access/chart
 */

import { chartSelectors } from '../../../selectors';
import type { ChartAccessor, ChartState } from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for chart accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type ChartActor = { getSnapshot(): ChartState };

/**
 * Creates a ChartAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * NOTE: Selection/drag/resize accessors have been removed - these operations
 * are now handled by objectInteractionActor. Use ObjectAccessor for those.
 *
 * @param actor - The XState chart actor
 * @returns ChartAccessor interface for handlers
 */
export function createChartAccessor(actor: ChartActor): ChartAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors (match value selectors)
    // ===========================================================================

    getSelectedChartIds: () => chartSelectors.selectedChartIds(snap()),
    getEditingChartId: () => chartSelectors.editingChartId(snap()),
    getCreationChartType: () => chartSelectors.creationChartType(snap()),
    getCreationDataRange: () => chartSelectors.creationDataRange(snap()),
    getCreationStep: () => chartSelectors.creationStep(snap()),
    getSelectedElement: () => chartSelectors.selectedElement(snap()),
    getSelectedSeriesIndex: () => chartSelectors.selectedSeriesIndex(snap()),
    getSelectedPointIndex: () => chartSelectors.selectedPointIndex(snap()),
    getTitleEditOriginalValue: () => chartSelectors.titleEditOriginalValue(snap()),

    // ===========================================================================
    // Derived Value Accessors
    // ===========================================================================

    getSelectedChartId: () => chartSelectors.selectedChartId(snap()),
    getSelectedCount: () => chartSelectors.selectedCount(snap()),
    hasSelection: () => chartSelectors.hasSelection(snap()),
    hasMultipleSelected: () => chartSelectors.hasMultipleSelected(snap()),
    hasElementSelected: () => chartSelectors.hasElementSelected(snap()),
    hasSeriesSelected: () => chartSelectors.hasSeriesSelected(snap()),
    hasPointSelected: () => chartSelectors.hasPointSelected(snap()),

    // ===========================================================================
    // State Matching Accessors (match state selectors)
    // ===========================================================================

    isIdle: () => chartSelectors.isIdle(snap()),
    isEditing: () => chartSelectors.isEditing(snap()),
    isCreating: () => chartSelectors.isCreating(snap()),
    isElementSelected: () => chartSelectors.isElementSelected(snap()),
    isSeriesSelected: () => chartSelectors.isSeriesSelected(snap()),
    isPointSelected: () => chartSelectors.isPointSelected(snap()),
    isTitleEditing: () => chartSelectors.isTitleEditing(snap()),

    // ===========================================================================
    // Compound State Checks
    // ===========================================================================

    isInElementSelectionState: () => chartSelectors.isInElementSelectionState(snap()),
    isCreationStep0: () => chartSelectors.isCreationStep0(snap()),
    isCreationStep1: () => chartSelectors.isCreationStep1(snap()),
    isCreationStep2: () => chartSelectors.isCreationStep2(snap()),

    // ===========================================================================
    // Derived State
    // ===========================================================================

    getUIState: () => chartSelectors.uiState(snap()),
  };
}

/**
 * Chart UI State Hook
 *
 * React hook that wraps the chart state machine actor.
 * Provides type-safe access to chart UI state and actions.
 *
 * This replaces the chart state from ui-store.ts:
 * - useSelectedChartId() -> useChartUI().selectedChartId
 * - useEditingChartId() -> useChartUI().editingChartId
 * - useChartCreation() -> useChartUI().isCreating, creationStep, etc.
 *
 * Note: This hook is for UI STATE only (selection, editing mode, creation wizard).
 * For chart DATA operations (create, update, delete), use useCharts() from hooks/use-charts.ts.
 *
 * Architecture: Actor Access Layer (
 * - All reactive reads use imported selectors with useSelector
 * - All writes use commands from createChartCommands
 * - NO inline selector functions
 * - NO direct .send() calls
 *
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import type { ChartType } from '@mog/charts';
import { chartSelectors } from '../../selectors';
import type { ChartElementType, ChartState } from '@mog-sdk/contracts/actors';

import { createChartCommands } from '../../coordinator/actor-access';
import { useCoordinator } from '../shared/use-coordinator';

// Type-safe selector wrapper to handle XState snapshot type compatibility

type AnySelector<T> = (state: any) => T;
const asSelector = <T>(selector: (state: ChartState) => T): AnySelector<T> => selector;

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseChartUIReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Currently selected chart ID */
  selectedChartId: string | null;

  /** Chart being edited (editor panel open) */
  editingChartId: string | null;

  /** Whether a chart is selected (in selected or editing state) */
  isSelected: boolean;

  /** Whether editing a chart (editor panel open) */
  isEditing: boolean;

  /** Whether chart creation wizard is open */
  isCreating: boolean;

  /** Current step in creation wizard (0=type, 1=data, 2=options) */
  creationStep: number;

  /** Selected chart type in creation wizard */
  creationChartType: ChartType | null;

  /** Data range in creation wizard */
  creationDataRange: string | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // ELEMENT-LEVEL SELECTION STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Currently selected element type (null = chart body, not element) */
  selectedElement: ChartElementType | null;

  /** Index of selected series (for series/dataPoint selection) */
  selectedSeriesIndex: number | null;

  /** Index of selected data point within series */
  selectedPointIndex: number | null;

  /** True if an element is selected (axis, legend, series, point, etc.) */
  hasElementSelected: boolean;

  /** True if a series is selected */
  hasSeriesSelected: boolean;

  /** True if a specific data point is selected */
  hasPointSelected: boolean;

  /** True if title is being edited */
  isTitleEditing: boolean;

  /** Original title value (for cancel/revert during title editing) */
  titleEditOriginalValue: string | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Select a chart */
  selectChart: (chartId: string) => void;

  /** Deselect the current chart */
  deselectChart: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITING ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Start editing the selected chart (open editor panel) */
  startEditing: () => void;

  /** Stop editing (close editor panel) */
  stopEditing: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATION WIZARD ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Open chart creation wizard */
  openCreation: (initialDataRange?: string) => void;

  /** Set chart type in creation wizard */
  setCreationType: (chartType: ChartType) => void;

  /** Set data range in creation wizard */
  setCreationDataRange: (dataRange: string) => void;

  /** Go to next step in creation wizard */
  nextStep: () => void;

  /** Go to previous step in creation wizard */
  prevStep: () => void;

  /** Cancel chart creation */
  cancelCreation: () => void;

  /**
   * Confirm chart creation.
   * Note: This only signals intent. The coordinator will execute the actual
   * store.createChart() call and read the chart type/data range from context.
   */
  confirmCreation: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETION ACTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Delete the selected chart.
   * Note: This only signals intent. The coordinator will execute the actual
   * store.deleteChart() call.
   */
  deleteSelectedChart: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // ELEMENT-LEVEL SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Click on a chart element (axis, legend, title, etc.) */
  clickElement: (elementType: ChartElementType) => void;

  /** Click on a data series (selects all points in series) */
  clickSeries: (seriesIndex: number) => void;

  /** Click on a specific data point */
  clickPoint: (seriesIndex: number, pointIndex: number) => void;

  /** Double-click on a chart element */
  doubleClickElement: (elementType?: ChartElementType) => void;

  /** Clear element selection (click on chart body, not element) */
  clearElementSelection: () => void;

  /** Start editing the chart title */
  startTitleEdit: (originalValue: string) => void;

  /** End title editing (commit changes) */
  endTitleEdit: () => void;

  /** Cancel title editing (revert to original value) */
  cancelTitleEdit: () => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing and controlling the chart UI state machine.
 *
 * @example
 * ```tsx
 * function ChartToolbar() {
 * const {
 * selectedChartId,
 * isEditing,
 * isCreating,
 * selectChart,
 * startEditing,
 * openCreation,
 * deleteSelectedChart,
 * } = useChartUI;
 *
 * return (
 * <div>
 * <button onClick={ => openCreation}>New Chart</button>
 * {selectedChartId && (
 * <>
 * <button onClick={startEditing}>Edit</button>
 * <button onClick={deleteSelectedChart}>Delete</button>
 * </>
 * )}
 * </div>
 * );
 * }
 * ```
 */
export function useChartUI(): UseChartUIReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.objects.access.actors.chart;

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE - Using imported selectors (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const selectedChartId = useSelector(actor, asSelector(chartSelectors.selectedChartId));
  const editingChartId = useSelector(actor, asSelector(chartSelectors.editingChartId));
  const isSelected = useSelector(actor, asSelector(chartSelectors.hasSelection));
  const isEditing = useSelector(actor, asSelector(chartSelectors.isEditing));
  const isCreating = useSelector(actor, asSelector(chartSelectors.isCreating));
  const creationStep = useSelector(actor, asSelector(chartSelectors.creationStep));
  const creationChartType = useSelector(actor, asSelector(chartSelectors.creationChartType));
  const creationDataRange = useSelector(actor, asSelector(chartSelectors.creationDataRange));

  // Element-level selection state
  const selectedElement = useSelector(actor, asSelector(chartSelectors.selectedElement));
  const selectedSeriesIndex = useSelector(actor, asSelector(chartSelectors.selectedSeriesIndex));
  const selectedPointIndex = useSelector(actor, asSelector(chartSelectors.selectedPointIndex));
  const hasElementSelected = useSelector(actor, asSelector(chartSelectors.hasElementSelected));
  const hasSeriesSelected = useSelector(actor, asSelector(chartSelectors.hasSeriesSelected));
  const hasPointSelected = useSelector(actor, asSelector(chartSelectors.hasPointSelected));
  const isTitleEditing = useSelector(actor, asSelector(chartSelectors.isTitleEditing));
  const titleEditOriginalValue = useSelector(
    actor,
    asSelector(chartSelectors.titleEditOriginalValue),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMANDS - Using createChartCommands (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const commands = useMemo(() => createChartCommands(actor), [actor]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      selectedChartId,
      editingChartId,
      isSelected,
      isEditing,
      isCreating,
      creationStep,
      creationChartType: creationChartType as ChartType | null,
      creationDataRange,

      // Element-level selection state
      selectedElement,
      selectedSeriesIndex,
      selectedPointIndex,
      hasElementSelected,
      hasSeriesSelected,
      hasPointSelected,
      isTitleEditing,
      titleEditOriginalValue,

      // Selection actions - using commands
      selectChart: commands.select,
      deselectChart: commands.deselect,

      // Editing actions - using commands
      startEditing: commands.startEdit,
      stopEditing: commands.stopEdit,

      // Creation wizard actions - using commands
      openCreation: commands.create,
      setCreationType: commands.setType as (chartType: ChartType) => void,
      setCreationDataRange: commands.setDataRange,
      nextStep: commands.nextStep,
      prevStep: commands.prevStep,
      cancelCreation: commands.cancel,
      confirmCreation: commands.confirm,

      // Deletion action - using commands
      deleteSelectedChart: commands.delete,

      // Element-level selection actions - using commands
      clickElement: commands.clickElement,
      clickSeries: commands.clickSeries,
      clickPoint: commands.clickPoint,
      doubleClickElement: commands.doubleClick,
      clearElementSelection: commands.clearElementSelection,
      startTitleEdit: commands.startTitleEdit,
      endTitleEdit: commands.endTitleEdit,
      cancelTitleEdit: commands.cancelTitleEdit,
    }),
    [
      selectedChartId,
      editingChartId,
      isSelected,
      isEditing,
      isCreating,
      creationStep,
      creationChartType,
      creationDataRange,
      selectedElement,
      selectedSeriesIndex,
      selectedPointIndex,
      hasElementSelected,
      hasSeriesSelected,
      hasPointSelected,
      isTitleEditing,
      titleEditOriginalValue,
      commands,
    ],
  );
}

/**
 * Chart Actor Selectors
 *
 * Pure functions that extract data from chart state.
 * Copied from kernel/src/selectors/ during kernel export tightening.
 */

import type { ChartState, ChartUIState } from '@mog-sdk/contracts/actors/chart';

export const chartSelectors = {
  // Value selectors
  selectedChartIds: (state: ChartState) => state.context.selectedChartIds,
  editingChartId: (state: ChartState) => state.context.editingChartId,
  creationChartType: (state: ChartState) => state.context.creationChartType,
  creationDataRange: (state: ChartState) => state.context.creationDataRange,
  creationStep: (state: ChartState): number => state.context.creationStep,
  selectedElement: (state: ChartState) => state.context.selectedElement,
  selectedSeriesIndex: (state: ChartState) => state.context.selectedSeriesIndex,
  selectedPointIndex: (state: ChartState) => state.context.selectedPointIndex,
  titleEditOriginalValue: (state: ChartState) => state.context.titleEditOriginalValue,

  // Derived value selectors
  selectedChartId: (state: ChartState): string | null => {
    const ids = state.context.selectedChartIds;
    if (ids.size === 0) return null;
    return ids.values().next().value ?? null;
  },
  selectedCount: (state: ChartState): number => state.context.selectedChartIds.size,
  hasSelection: (state: ChartState): boolean => state.context.selectedChartIds.size > 0,
  hasMultipleSelected: (state: ChartState): boolean => state.context.selectedChartIds.size > 1,
  hasElementSelected: (state: ChartState): boolean => state.context.selectedElement !== null,
  hasSeriesSelected: (state: ChartState): boolean => state.context.selectedSeriesIndex !== null,
  hasPointSelected: (state: ChartState): boolean => state.context.selectedPointIndex !== null,

  // State matching selectors
  isIdle: (state: ChartState): boolean => state.matches('idle'),
  isEditing: (state: ChartState): boolean => state.matches('editing'),
  isCreating: (state: ChartState): boolean => state.matches('creating'),
  isElementSelected: (state: ChartState): boolean => state.matches('elementSelected'),
  isSeriesSelected: (state: ChartState): boolean => state.matches('seriesSelected'),
  isPointSelected: (state: ChartState): boolean => state.matches('pointSelected'),
  isTitleEditing: (state: ChartState): boolean => state.matches('titleEditing'),

  isInElementSelectionState: (state: ChartState): boolean =>
    state.matches('elementSelected') ||
    state.matches('seriesSelected') ||
    state.matches('pointSelected') ||
    state.matches('titleEditing'),

  // Creation wizard step checks
  isCreationStep0: (state: ChartState): boolean => state.matches('creating.step0'),
  isCreationStep1: (state: ChartState): boolean => state.matches('creating.step1'),
  isCreationStep2: (state: ChartState): boolean => state.matches('creating.step2'),

  /**
   * Derive the chart UI state from the machine state.
   */
  uiState: (state: ChartState): ChartUIState => {
    if (state.matches('creating')) return 'creating';
    if (state.matches('editing')) return 'editing';
    if (state.matches('titleEditing')) return 'titleEditing';
    if (state.matches('pointSelected')) return 'pointSelected';
    if (state.matches('seriesSelected')) return 'seriesSelected';
    if (state.matches('elementSelected')) return 'elementSelected';
    return 'idle';
  },
};

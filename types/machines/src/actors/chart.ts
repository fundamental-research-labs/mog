/**
 * Chart Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - idle: No chart-specific interaction (selection handled by objectInteractionActor)
 * - editing: Chart editor panel open
 * - creating: Chart creation wizard open (3 steps)
 * - elementSelected: A chart element (axis, legend, etc.) is selected
 * - seriesSelected: A data series is selected
 * - pointSelected: A specific data point is selected
 * - titleEditing: Chart title is being edited inline
 *
 * NOTE: Selection/drag/resize is now handled by objectInteractionActor.
 * Chart selection is synced via SYNC_SELECTION event from coordinator.
 *
 * @see state-machines/src/chart-machine.ts
 */

import type { ChartType } from '@mog/types-data/data/charts';
import type { ChartUIState } from '../machines/types';

// =============================================================================
// TYPES (from chart-machine.ts)
// =============================================================================

export type { ChartType };

/**
 * Chart element types that can be selected.
 */
export type ChartElementType =
  | 'title'
  | 'legend'
  | 'xAxis'
  | 'yAxis'
  | 'series'
  | 'dataPoint'
  | 'gridLine'
  | 'tooltip';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 * NOTE: Selection/drag/resize context removed - handled by objectInteractionActor.
 */
export interface ChartState {
  context: {
    /** Currently selected chart IDs (synced from objectInteractionActor via SYNC_SELECTION) */
    selectedChartIds: Set<string>;
    /** Chart being edited (when editor panel is open) */
    editingChartId: string | null;
    /** Chart creation wizard state - selected type */
    creationChartType: ChartType | null;
    /** Data range for chart creation (e.g., "A1:D10") */
    creationDataRange: string | null;
    /** Current step in creation wizard (0=type, 1=data, 2=options) */
    creationStep: number;
    /** Currently selected chart element type */
    selectedElement: ChartElementType | null;
    /** Index of the selected series */
    selectedSeriesIndex: number | null;
    /** Index of the selected data point within a series */
    selectedPointIndex: number | null;
    /** Original title value before editing */
    titleEditOriginalValue: string | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface ChartAccessor {
  // Value accessors (match selectors)
  /** Get selected chart IDs (synced from objectInteractionActor) */
  getSelectedChartIds(): Set<string>;
  getEditingChartId(): string | null;
  getCreationChartType(): ChartType | null;
  getCreationDataRange(): string | null;
  getCreationStep(): number;
  getSelectedElement(): ChartElementType | null;
  getSelectedSeriesIndex(): number | null;
  getSelectedPointIndex(): number | null;
  getTitleEditOriginalValue(): string | null;

  // Derived value accessors
  /** @deprecated Use getSelectedChartIds instead */
  getSelectedChartId(): string | null;
  getSelectedCount(): number;
  hasSelection(): boolean;
  hasMultipleSelected(): boolean;
  hasElementSelected(): boolean;
  hasSeriesSelected(): boolean;
  hasPointSelected(): boolean;

  // State matching accessors (match selectors)
  isIdle(): boolean;
  isEditing(): boolean;
  isCreating(): boolean;
  isElementSelected(): boolean;
  isSeriesSelected(): boolean;
  isPointSelected(): boolean;
  isTitleEditing(): boolean;

  // Compound state checks
  isInElementSelectionState(): boolean;
  isCreationStep0(): boolean;
  isCreationStep1(): boolean;
  isCreationStep2(): boolean;

  // Derived state
  getUIState(): ChartUIState;
}

// Re-export ChartUIState for convenience
export type { ChartUIState };

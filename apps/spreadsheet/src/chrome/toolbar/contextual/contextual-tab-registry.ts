/**
 * Contextual Tab Registry
 *
 * Registry for contextual tabs that appear/disappear based on selection context.
 * Contextual tabs are shown when specific objects are selected (tables, charts, etc.)
 *
 * Examples:
 * - Table Design: Shows when selection is inside a table
 * - Chart Tools: Shows when a chart is selected
 * - Picture Tools: Shows when an image is selected
 * - Slicer Tools: Shows when a slicer is selected
 * - Sparkline Tools: Shows when a cell with sparkline is selected
 *
 * Architecture:
 * - Contextual tabs are rendered in TabbedToolbar when showWhen() returns true
 * - Each contextual tab has an optional groupLabel (e.g., "Chart Tools" groups "Chart")
 * - Tabs can be styled differently (Excel uses colored headers for contextual groups)
 *
 */

import type { ComponentType } from 'react';

import type { UseChartUIReturn } from '../../../hooks/charts/use-chart';
import type { UseTableSelectionReturn } from '../../../hooks/selection/use-table-selection';

// =============================================================================
// Types
// =============================================================================

/**
 * Object interaction state relevant for contextual tabs
 */
export interface ObjectInteractionContext {
  /** Currently selected object IDs */
  selectedIds: string[];
  /** Type of the first selected object (for single-select contextual tabs) */
  selectedObjectType: 'picture' | 'textbox' | 'shape' | null;
}

/**
 * Slicer selection state relevant for contextual tabs
 */
export interface SlicerSelectionContext {
  /** Currently selected slicer ID (null if none) */
  selectedSlicerId: string | null;
}

/**
 * Sparkline selection state relevant for contextual tabs
 */
export interface SparklineSelectionContext {
  /** Whether the active cell contains a sparkline */
  hasSparklineInActiveCell: boolean;
}

/**
 * Diagram selection state relevant for contextual tabs
 * Diagram Contextual Tab Registry
 */
export interface DiagramSelectionContext {
  /** Currently selected Diagram ID (null if none) */
  selectedDiagramId: string | null;
}

export interface PivotSelectionContext {
  /** Currently selected PivotTable ID (null if none) */
  selectedPivotId: string | null;
}

/**
 * Context object passed to showWhen() predicates
 * Contains all selection and object state needed to determine tab visibility
 *
 * PERFORMANCE: This context does NOT include raw selection state.
 * All selection-derived values are read from UIStore (set by coordinator modules).
 * This prevents toolbar re-renders on every cell selection change.
 */
export interface ContextualTabContext {
  /** Table selection state (from UIStore via useTableSelection) */
  tableSelection: UseTableSelectionReturn;
  /** Chart UI state */
  chartUI: UseChartUIReturn;
  /** Object interaction state (pictures, shapes, textboxes) */
  objectInteraction: ObjectInteractionContext;
  /** Slicer selection state */
  slicerSelection: SlicerSelectionContext;
  /** Sparkline selection state (from UIStore via SparklineSelectionCoordination) */
  sparklineSelection: SparklineSelectionContext;
  /** Diagram selection state (from UIStore Diagram slice) */
  diagramSelection: DiagramSelectionContext;
  /** PivotTable selection state (from UIStore Pivot slice) */
  pivotSelection: PivotSelectionContext;
}

/**
 * Props passed to contextual tab components
 */
export interface ContextualTabProps {
  // Add common props if needed in the future
}

/**
 * Configuration for a contextual tab
 */
export interface ContextualTabConfig {
  /** Unique tab ID */
  id: string;

  /** Tab label (displayed in tab bar) */
  label: string;

  /** Optional group label (e.g., "Table Tools", "Chart Tools") */
  groupLabel?: string;

  /** Color accent for the tab (Excel-style contextual tab styling) */
  accentColor?: string;

  /**
   * Predicate that determines when this tab should be visible
   * @param context - Full selection and object state
   * @returns true if tab should be shown
   */
  showWhen: (context: ContextualTabContext) => boolean;

  /**
   * React component for the tab's ribbon content
   * Receives standard ribbon props
   */
  component: ComponentType<ContextualTabProps>;
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Global registry of all contextual tabs
 *
 * Tabs are checked in order. Multiple contextual tabs can be shown simultaneously.
 *
 * KeyTip mappings (defined in TabBar.tsx TAB_KEYTIP_MAP):
 * - table-design: JT (multi-key sequence J then T)
 * - chart-design: JC (multi-key sequence J then C)
 * - chart-format: JF (multi-key sequence J then F)
 * - picture-tools: JP (multi-key sequence J then P)
 * - slicer-tools: JS (multi-key sequence J then S)
 * - sparkline-tools: JK (multi-key sequence J then K)
 * - diagram-design: JA (multi-key sequence J then A)
 * - diagram-format: JO (multi-key sequence J then O)
 * - pivot-analyze: JY (multi-key sequence J then Y)
 * - pivot-design: JV (multi-key sequence J then V)
 */
export const CONTEXTUAL_TAB_REGISTRY: ContextualTabConfig[] = [
  // Table Design tab - shows when selection is inside a table
  {
    id: 'table-design',
    label: 'Table Design',
    groupLabel: 'Table Tools',
    accentColor: 'var(--color-table-accent, #7cb342)', // Green accent for tables
    showWhen: (context) => context.tableSelection.isInTable,
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Chart Design tab - shows when a chart is selected
  {
    id: 'chart-design',
    label: 'Chart Design',
    groupLabel: 'Chart Tools',
    accentColor: 'var(--color-chart-accent, #1976d2)', // Blue accent for charts
    showWhen: (context) => context.chartUI.selectedChartId !== null,
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Chart Format tab - shows when a chart is selected
  {
    id: 'chart-format',
    label: 'Chart Format',
    groupLabel: 'Chart Tools',
    accentColor: 'var(--color-chart-accent, #1976d2)', // Blue accent for charts
    showWhen: (context) => context.chartUI.selectedChartId !== null,
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Picture Tools tab - shows when a picture/image is selected
  {
    id: 'picture-tools',
    label: 'Picture Format',
    groupLabel: 'Picture Tools',
    accentColor: 'var(--color-picture-accent, #f57c00)', // Orange accent for pictures
    showWhen: (context) => context.objectInteraction.selectedObjectType === 'picture',
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Filter control tools tab - shows when a filter control is selected
  {
    id: 'slicer-tools',
    label: 'Filter control',
    groupLabel: 'Filter control tools',
    accentColor: 'var(--color-slicer-accent, #8e24aa)', // Purple accent for slicers
    showWhen: (context) => context.slicerSelection.selectedSlicerId !== null,
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Sparkline Tools tab - shows when active cell contains a sparkline
  {
    id: 'sparkline-tools',
    label: 'Sparkline',
    groupLabel: 'Sparkline Tools',
    accentColor: 'var(--color-sparkline-accent, #00897b)', // Teal accent for sparklines
    showWhen: (context) => context.sparklineSelection.hasSparklineInActiveCell,
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Diagram Design tab - shows when a diagram object is selected
  // Diagram Contextual Tab Registry
  {
    id: 'diagram-design',
    label: 'Diagram Design',
    groupLabel: 'Diagram tools',
    accentColor: 'var(--color-diagram-accent, #43a047)', // Green accent for diagrams
    showWhen: (context) => context.diagramSelection.selectedDiagramId !== null,
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Diagram Format tab - shows when a diagram object is selected
  // Diagram Contextual Tab Registry
  {
    id: 'diagram-format',
    label: 'Format',
    groupLabel: 'Diagram tools',
    accentColor: 'var(--color-diagram-accent, #43a047)', // Green accent for Diagram
    showWhen: (context) => context.diagramSelection.selectedDiagramId !== null,
    // Component will be imported dynamically to avoid circular dependencies
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  {
    id: 'pivot-analyze',
    label: 'PivotTable Analyze',
    groupLabel: 'PivotTable Tools',
    accentColor: 'var(--color-pivot-accent, #2e7d32)',
    showWhen: (context) => context.pivotSelection.selectedPivotId !== null,
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  {
    id: 'pivot-design',
    label: 'Design',
    groupLabel: 'PivotTable Tools',
    accentColor: 'var(--color-pivot-accent, #2e7d32)',
    showWhen: (context) => context.pivotSelection.selectedPivotId !== null,
    component: (() => null) as ComponentType<ContextualTabProps>,
  },

  // Future contextual tabs (when implemented):
  // - Draw Tools (when drawing mode is active)
];

// =============================================================================
// Helpers
// =============================================================================

// PERFORMANCE: Stable empty array reference to prevent unnecessary re-renders.
// Without this, every call to getVisibleContextualTabs() returns a new [] reference,
// causing React to think the array changed even when it's still empty.
// @see docs/ARCHITECTURE-CHECKLIST.md - Section 15 (Render Isolation)
const EMPTY_TABS: ContextualTabConfig[] = [];

/**
 * Get all contextual tabs that should be shown for the current context
 * @param context - Current selection and object state
 * @returns Array of tab configs that should be visible
 */
export function getVisibleContextualTabs(context: ContextualTabContext): ContextualTabConfig[] {
  const visible = CONTEXTUAL_TAB_REGISTRY.filter((tab) => tab.showWhen(context));
  // Return stable empty array reference when no tabs are visible (common case)
  return visible.length === 0 ? EMPTY_TABS : visible;
}

/**
 * Check if a specific contextual tab should be shown
 * @param tabId - Tab ID to check
 * @param context - Current selection and object state
 * @returns true if the tab should be visible
 */
export function isContextualTabVisible(tabId: string, context: ContextualTabContext): boolean {
  const tab = CONTEXTUAL_TAB_REGISTRY.find((t) => t.id === tabId);
  return tab ? tab.showWhen(context) : false;
}

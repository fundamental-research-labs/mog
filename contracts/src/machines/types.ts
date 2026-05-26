/**
 * Machine Types for State Machines
 *
 * Types used by state machines in the renderer architecture.
 * Moved to contracts to enable decoupling of canvas and state subsystems.
 *
 * @module @mog-sdk/contracts/machines/types
 */

// Re-export coordinate types from rendering module
export type { CellCoord } from '@mog/types-viewport/rendering/primitives';

// Re-export rendering primitives. Imported from the primitives leaf (not
// grid-renderer.ts) so machines/types doesn't pull in the full grid
// renderer contract, which would re-create a cycle through render-context.
export { RenderPriority } from '../rendering/grid-renderer-primitives';
export type { LayerName } from '../rendering/grid-renderer-primitives';

// =============================================================================
// SELECTION DIRECTION TYPE
// =============================================================================

/**
 * Selection direction type — owned by @mog/types-editor/selection/types.
 * Re-exported here for back-compat. Moved out to break an upward Tier 1
 * (selection) -> Tier 2 (machines) import.
 */
export type { SelectionDirection } from '@mog/types-editor/selection/types';

// =============================================================================
// INTERACTION TYPES
// =============================================================================

/**
 * Cardinal directions for keyboard navigation and commit actions.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

// =============================================================================
// RENDERER STATUS
// =============================================================================

/**
 * All possible renderer states.
 */
export type RendererStatus =
  | 'unmounted'
  | 'waitingForLayout'
  | 'initializing'
  | 'ready'
  | 'switchingSheet'
  | 'suspended'
  | 'error'
  | 'disposing';

// =============================================================================
// CHART UI STATE
// =============================================================================

/**
 * Chart UI states (derived from state machine).
 * NOTE: 'selected', 'moving', 'resizing' removed - selection/drag/resize handled by objectInteractionActor.
 * Element selection states for chart-specific interactions.
 */
export type ChartUIState =
  | 'idle'
  | 'editing'
  | 'creating'
  | 'elementSelected'
  | 'seriesSelected'
  | 'pointSelected'
  | 'titleEditing';

// =============================================================================
// FOCUS LAYER TYPE
// =============================================================================

/**
 * Focus layer types for the focus machine.
 */
export type FocusLayerType =
  | 'grid'
  | 'editor'
  | 'formulaBar' // Formula bar has focus (editing via formula bar)
  | 'dialog'
  | 'commandPalette'
  | 'contextMenu'
  | 'formulaPicker'
  | 'sheetTabs'
  | 'formControl'; // Form control has focus

// =============================================================================
// FUNCTION REGISTRY INTERFACE
// =============================================================================

/**
 * Minimal function metadata interface for editor machines.
 * This is a subset of the full FunctionMetadata from calculator-engine,
 * containing only what machines need for argument hint insertion.
 */
export interface IFunctionMetadata {
  /** Minimum number of arguments */
  minArgs?: number;
  /** Maximum number of arguments (Infinity for variadic) */
  maxArgs?: number;
}

/**
 * Interface for function registry lookup.
 * Machines receive this via context injection rather than importing globalRegistry.
 * This decouples machines from calculator-engine.
 */
export interface IFunctionRegistry {
  /**
   * Get metadata for a function by name.
   * @param name Function name (e.g., "SUM", "VLOOKUP")
   * @returns Function metadata or undefined if not found
   */
  getMetadata(name: string): IFunctionMetadata | undefined;
}

// =============================================================================
// FORMULA RANGE COLORS
// =============================================================================

/**
 * Colors used for formula range highlighting (matches Excel/Sheets).
 */
export const FORMULA_RANGE_COLORS = [
  '#4285f4', // Blue
  '#ea4335', // Red
  '#9334e6', // Purple
  '#ff6d01', // Orange
  '#34a853', // Green
  '#46bdc6', // Cyan
  '#7baaf7', // Light blue
  '#f07b72', // Light red
] as const;

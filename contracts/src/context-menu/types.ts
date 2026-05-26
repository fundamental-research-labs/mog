/**
 * Context Menu Types
 *
 * Pure type definitions for the right-click context menu system.
 * These types are shared between the UI components that render the menu
 * and the state management that tracks menu visibility and target.
 *
 * @module @mog-sdk/contracts/context-menu
 */

// =============================================================================
// TARGET TYPES
// =============================================================================

/** What element the user right-clicked on. */
export type ContextMenuTarget =
  | 'cell'
  | 'row-header'
  | 'column-header'
  | 'selection'
  | 'pivot'
  | 'pivot-row-header'
  | 'pivot-column-header'
  | 'pivot-value';

// =============================================================================
// STATE
// =============================================================================

/** Current state of the context menu (visibility, position, and target). */
export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  target: ContextMenuTarget;
  targetRow?: number;
  targetCol?: number;
  pivotId?: string;
  pivotHeaderKey?: string;
  pivotFieldId?: string;
  /** Monotonically increasing counter to force React remount on each open */
  instanceId: number;
}

/** Initial (closed) state for the context menu. */
export const INITIAL_CONTEXT_MENU_STATE: ContextMenuState = {
  isOpen: false,
  x: 0,
  y: 0,
  target: 'cell',
  targetRow: undefined,
  targetCol: undefined,
  instanceId: 0,
};

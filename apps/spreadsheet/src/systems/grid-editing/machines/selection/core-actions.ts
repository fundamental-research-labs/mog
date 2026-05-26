/**
 * Selection Machine Core Actions - Main Export
 *
 * This module serves as the main export point for all selection actions.
 * It combines actions from specialized modules and exports helper functions
 * used across the selection machine.
 *
 * The actions are organized into specialized modules:
 * - mouse-actions.ts - Mouse click and drag interactions
 * - keyboard-actions.ts - Keyboard navigation (arrows, home, end, tab, enter)
 * - page-actions.ts - Page navigation (Page Up/Down/Left/Right)
 * - system-actions.ts - System state management and settings
 * - header-actions.ts - Column/row header selection
 * - formula-actions.ts - Formula range selection mode
 * - drag-actions.ts - Fill handle, cell drag-drop, resize operations
 *
 * @see selection-machine.ts - Main state machine that uses these actions
 * @see ARCHITECTURE.md - State Machine 2: Selection
 */

// Import specialized action modules
import { dragActions } from './drag-actions';
import { emitUserSelectionChanged } from './emits';
import { formulaActions } from './formula-actions';
import { headerActions } from './header-actions';
import { keyboardActions } from './keyboard-actions';
import { mouseActions } from './mouse-actions';
import { systemActions } from './system-actions';

// Re-export helpers for external consumers. `addRange` /
// `extendLastRange` were the splice primitives the new pending/committed
// model retired — they have no remaining callers.
export {
  computeDirection,
  getEffectiveRanges,
  getSelectAllRange,
  initialSelectionContext,
  moveTo,
  moveToPending,
} from './helpers';

// =============================================================================
// ACTIONS EXPORT
// =============================================================================

/**
 * All action functions for the selection machine.
 * Export as an object to spread into XState's setup({ actions: ... }).
 */
export const selectionCoreActions = {
  // Mouse actions
  ...mouseActions,

  // Keyboard navigation actions (includes page actions)
  ...keyboardActions,

  // System actions
  ...systemActions,

  // Column/row header selection actions
  ...headerActions,

  // Formula range mode actions
  ...formulaActions,

  // Fill handle, drag, and resize actions
  ...dragActions,

  emitUserSelectionChanged,
} as const;

/**
 * Type for the actions object, useful for type-safe action references.
 */
export type SelectionCoreActions = typeof selectionCoreActions;

/**
 * Key Action Map
 *
 * Maps keyboard combinations to action handler names.
 * Used by the IntegrationSimulator to dispatch keystrokes through
 * real action handlers instead of raw state machine commands.
 *
 * @module systems/grid-editing/testing
 */

// =============================================================================
// Types
// =============================================================================

export interface KeyModifiers {
  shift?: boolean;
  ctrl?: boolean;
}

/**
 * All action types that can be dispatched through the key-action map.
 * These correspond to exported handler names from actions/handlers/selection/.
 */
export type SelectionActionType =
  // Movement (Arrow keys)
  | 'MOVE_UP'
  | 'MOVE_DOWN'
  | 'MOVE_LEFT'
  | 'MOVE_RIGHT'
  // Extension (Shift+Arrow)
  | 'EXTEND_SELECTION_UP'
  | 'EXTEND_SELECTION_DOWN'
  | 'EXTEND_SELECTION_LEFT'
  | 'EXTEND_SELECTION_RIGHT'
  // Data-edge (Ctrl+Arrow)
  | 'MOVE_TO_EDGE_UP'
  | 'MOVE_TO_EDGE_DOWN'
  | 'MOVE_TO_EDGE_LEFT'
  | 'MOVE_TO_EDGE_RIGHT'
  // Data-edge extension (Ctrl+Shift+Arrow)
  | 'EXTEND_TO_EDGE_UP'
  | 'EXTEND_TO_EDGE_DOWN'
  | 'EXTEND_TO_EDGE_LEFT'
  | 'EXTEND_TO_EDGE_RIGHT'
  // Home/End
  | 'MOVE_TO_ROW_START'
  | 'MOVE_TO_ROW_END'
  | 'MOVE_TO_A1'
  | 'MOVE_TO_LAST_USED_CELL'
  | 'EXTEND_TO_ROW_START'
  | 'EXTEND_TO_A1'
  | 'EXTEND_TO_LAST_USED_CELL'
  // Tab/Enter
  | 'TAB_FORWARD'
  | 'TAB_BACKWARD'
  | 'ENTER_NAVIGATE'
  | 'SHIFT_ENTER_NAVIGATE'
  | 'COMMIT_ENTER'
  | 'COMMIT_SHIFT_ENTER'
  // Page navigation
  | 'PAGE_UP'
  | 'PAGE_DOWN'
  | 'EXTEND_SELECTION_PAGE_UP'
  | 'EXTEND_SELECTION_PAGE_DOWN';

// =============================================================================
// Key Combo Builder (delegated to testing-foundation)
// =============================================================================

import { buildKeyCombo } from '../../testing-foundation/key-utils';
export { buildKeyCombo };

// =============================================================================
// Action Map
// =============================================================================

/**
 * Static lookup from key combo string to action type.
 */
const KEY_ACTION_MAP: Record<string, SelectionActionType> = {
  // Arrow keys (plain)
  ArrowUp: 'MOVE_UP',
  ArrowDown: 'MOVE_DOWN',
  ArrowLeft: 'MOVE_LEFT',
  ArrowRight: 'MOVE_RIGHT',

  // Arrow keys + Shift (extend selection)
  'Shift+ArrowUp': 'EXTEND_SELECTION_UP',
  'Shift+ArrowDown': 'EXTEND_SELECTION_DOWN',
  'Shift+ArrowLeft': 'EXTEND_SELECTION_LEFT',
  'Shift+ArrowRight': 'EXTEND_SELECTION_RIGHT',

  // Arrow keys + Ctrl (data-edge navigation)
  'Ctrl+ArrowUp': 'MOVE_TO_EDGE_UP',
  'Ctrl+ArrowDown': 'MOVE_TO_EDGE_DOWN',
  'Ctrl+ArrowLeft': 'MOVE_TO_EDGE_LEFT',
  'Ctrl+ArrowRight': 'MOVE_TO_EDGE_RIGHT',

  // Arrow keys + Ctrl+Shift (data-edge extension)
  'Ctrl+Shift+ArrowUp': 'EXTEND_TO_EDGE_UP',
  'Ctrl+Shift+ArrowDown': 'EXTEND_TO_EDGE_DOWN',
  'Ctrl+Shift+ArrowLeft': 'EXTEND_TO_EDGE_LEFT',
  'Ctrl+Shift+ArrowRight': 'EXTEND_TO_EDGE_RIGHT',

  // Home/End
  Home: 'MOVE_TO_ROW_START',
  End: 'MOVE_TO_ROW_END',
  'Ctrl+Home': 'MOVE_TO_A1',
  'Ctrl+End': 'MOVE_TO_LAST_USED_CELL',
  'Shift+Home': 'EXTEND_TO_ROW_START',
  'Ctrl+Shift+Home': 'EXTEND_TO_A1',
  'Ctrl+Shift+End': 'EXTEND_TO_LAST_USED_CELL',

  // Tab
  Tab: 'TAB_FORWARD',
  'Shift+Tab': 'TAB_BACKWARD',

  // Enter
  Enter: 'ENTER_NAVIGATE',
  'Shift+Enter': 'SHIFT_ENTER_NAVIGATE',

  // Page navigation
  PageUp: 'PAGE_UP',
  PageDown: 'PAGE_DOWN',
  'Shift+PageUp': 'EXTEND_SELECTION_PAGE_UP',
  'Shift+PageDown': 'EXTEND_SELECTION_PAGE_DOWN',
};

/**
 * Look up the action type for a key combo.
 * Returns null if no handler is mapped for this combo.
 */
export function lookupAction(key: string, modifiers?: KeyModifiers): SelectionActionType | null {
  const combo = buildKeyCombo(key, modifiers);
  return KEY_ACTION_MAP[combo] ?? null;
}

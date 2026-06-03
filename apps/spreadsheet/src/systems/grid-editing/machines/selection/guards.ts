/**
 * Selection Machine Guards
 *
 * Pure guard functions for the selection state machine.
 * Guards are used by XState to conditionally determine state transitions
 * based on the current context and/or event data.
 *
 * These guards are pure functions with no side effects - they only read
 * from context and event to return a boolean decision.
 *
 * @see selection-machine.ts - Main state machine that uses these guards
 * @see ARCHITECTURE.md - State Machine 2: Selection
 */

import type { SelectionContext, SelectionEvent } from './types';

// =============================================================================
// GUARD FUNCTION TYPES
// =============================================================================

/**
 * Guard function signature for XState setup().
 * Guards receive context and event, return boolean.
 */
type GuardArgs = {
  context: SelectionContext;
  event: SelectionEvent;
};

// =============================================================================
// MOUSE CLICK GUARDS
// =============================================================================

/**
 * Check if the mouse down event is a shift+click (for range extension).
 * Shift+click extends the current selection to include the clicked cell.
 */
function isShiftClick({ event }: GuardArgs): boolean {
  return event.type === 'MOUSE_DOWN' && event.shiftKey && !event.ctrlKey;
}

/**
 * Check if the mouse down event is a ctrl+click (for multi-selection).
 * Ctrl+click adds a new range to the existing selection.
 */
function isCtrlClick({ event }: GuardArgs): boolean {
  return event.type === 'MOUSE_DOWN' && event.ctrlKey && !event.shiftKey;
}

// =============================================================================
// KEYBOARD NAVIGATION GUARDS
// =============================================================================

/**
 * Check if the arrow key event has shift modifier (for selection extension).
 * Shift+Arrow extends the selection in the arrow direction.
 */
function isShiftArrow({ event }: GuardArgs): boolean {
  return event.type === 'KEY_ARROW' && event.shiftKey;
}

/**
 * Check if context has an anchor point set.
 * Used for determining if shift+click should extend from anchor or active cell.
 */
function hasAnchor({ context }: GuardArgs): boolean {
  return context.anchor !== null;
}

// =============================================================================
// COLUMN/ROW HEADER SELECTION GUARDS
// =============================================================================

/**
 * Check if column selection is a shift+click (for column range extension).
 */
function isShiftColumnClick({ event }: GuardArgs): boolean {
  return event.type === 'SELECT_COLUMN' && event.shiftKey && !event.ctrlKey;
}

/**
 * Check if column selection is a ctrl+click (for multi-column selection).
 */
function isCtrlColumnClick({ event }: GuardArgs): boolean {
  return event.type === 'SELECT_COLUMN' && event.ctrlKey && !event.shiftKey;
}

/**
 * Check if row selection is a shift+click (for row range extension).
 */
function isShiftRowClick({ event }: GuardArgs): boolean {
  return event.type === 'SELECT_ROW' && event.shiftKey && !event.ctrlKey;
}

/**
 * Check if row selection is a ctrl+click (for multi-row selection).
 */
function isCtrlRowClick({ event }: GuardArgs): boolean {
  return event.type === 'SELECT_ROW' && event.ctrlKey && !event.shiftKey;
}

/**
 * Check if column selection is from keyboard (Ctrl+Space).
 * Keyboard-triggered selection should stay in idle, not enter drag state.
 */
function isKeyboardColumnSelect({ event }: GuardArgs): boolean {
  return event.type === 'SELECT_COLUMN' && event.fromKeyboard === true;
}

/**
 * Check if row selection is from keyboard (Shift+Space).
 * Keyboard-triggered selection should stay in idle, not enter drag state.
 */
function isKeyboardRowSelect({ event }: GuardArgs): boolean {
  return event.type === 'SELECT_ROW' && event.fromKeyboard === true;
}

// =============================================================================
// SETTINGS-BASED GUARDS (Issue 8: Settings Panel)
// =============================================================================

/**
 * Check if fill handle dragging is allowed based on WorkbookSettings.
 * When allowDragFill is false, the fill handle is disabled.
 */
function isFillHandleAllowed({ context }: GuardArgs): boolean {
  return context.allowDragFill;
}

// =============================================================================
// EXTENDED NAVIGATION GUARDS (Issue 8 Wave 2B)
// =============================================================================

/**
 * Check if Ctrl+Arrow event has shift modifier (for jump-to-edge with selection extension).
 */
function isShiftCtrlArrow({ event }: GuardArgs): boolean {
  return event.type === 'KEY_CTRL_ARROW' && event.shiftKey === true;
}

/**
 * Check if Home key event has shift modifier (for selection extension to beginning).
 */
function isShiftHome({ event }: GuardArgs): boolean {
  return event.type === 'KEY_HOME' && event.shiftKey === true;
}

/**
 * Check if End key event has shift modifier (for selection extension to end).
 */
function isShiftEnd({ event }: GuardArgs): boolean {
  return event.type === 'KEY_END' && event.shiftKey === true;
}

/**
 * Check if Page Up event has shift modifier (for selection extension up by viewport).
 */
function isShiftPageUp({ event }: GuardArgs): boolean {
  return event.type === 'PAGE_UP' && event.shiftKey === true;
}

/**
 * Check if Page Down event has shift modifier (for selection extension down by viewport).
 */
function isShiftPageDown({ event }: GuardArgs): boolean {
  return event.type === 'PAGE_DOWN' && event.shiftKey === true;
}

/**
 * Check if Page Left event has shift modifier (for selection extension left by viewport).
 */
function isShiftPageLeft({ event }: GuardArgs): boolean {
  return event.type === 'PAGE_LEFT' && event.shiftKey === true;
}

/**
 * Check if Page Right event has shift modifier (for selection extension right by viewport).
 */
function isShiftPageRight({ event }: GuardArgs): boolean {
  return event.type === 'PAGE_RIGHT' && event.shiftKey === true;
}

// =============================================================================
// VIEWPORT-FOLLOW EMIT GUARD
// =============================================================================

/**
 * Check whether a SET_SELECTION event should fire `userSelectionChanged`.
 * Only `source === 'user'` (the default) is local-user-initiated and should
 * pull the viewport along. `'remote'` and `'agent'` are collaborator/AI
 * and `'restore'` is per-sheet view-state restoration on sheet switch.
 *
 */
function isUserSelection({ event }: GuardArgs): boolean {
  if (event.type !== 'SET_SELECTION') return false;
  return (event.source ?? 'user') === 'user';
}

// =============================================================================
// SELECTION-MODE GUARDS
//
// Implements the keyboard-selection priority matrix:
// 1a. end ∧ (extend ∨ shift) → extend-to-edge, deactivate end
// 1b. end ∧ ¬extend ∧ ¬shift → move-to-edge, deactivate end
// 2. additive ∧ shift → extend pending only
// 3. additive ∧ ¬shift → move active cell, collapse pending
// 4. extend ∨ shift → extend single range
// 5. default → move + collapse
//
// `extend` and `additive` are mutually exclusive by SET_MODE invariant, so
// no row covers both true.
// =============================================================================

/**
 * Read the shift modifier off whichever event carries one. Returns false for
 * events with no shift field.
 */
function eventShift(event: SelectionEvent): boolean {
  switch (event.type) {
    case 'KEY_ARROW':
    case 'KEY_TAB':
    case 'KEY_ENTER':
      return event.shiftKey;
    case 'KEY_CTRL_ARROW':
    case 'KEY_HOME':
    case 'KEY_END':
    case 'PAGE_UP':
    case 'PAGE_DOWN':
    case 'PAGE_LEFT':
    case 'PAGE_RIGHT':
      return event.shiftKey === true;
    default:
      return false;
  }
}

/** Matrix row 1a: End mode AND (extend mode OR raw shift). */
function endModeWithShiftIntent({ context, event }: GuardArgs): boolean {
  return context.modes.end && (context.modes.extend || eventShift(event));
}

/** Matrix row 1b: End mode AND no shift intent. */
function endModeWithoutShiftIntent({ context, event }: GuardArgs): boolean {
  return context.modes.end && !context.modes.extend && !eventShift(event);
}

/** Matrix row 2: Additive mode AND raw shift. (No End — End wins.) */
function additiveModeWithShift({ context, event }: GuardArgs): boolean {
  return !context.modes.end && context.modes.additive && eventShift(event);
}

/** Matrix row 3: Additive mode AND no shift. (No End.) */
function additiveModeWithoutShift({ context, event }: GuardArgs): boolean {
  return !context.modes.end && context.modes.additive && !eventShift(event);
}

/** Matrix row 4: Extend mode OR raw shift. (No End, no Additive.) */
function extendIntent({ context, event }: GuardArgs): boolean {
  if (context.modes.end || context.modes.additive) return false;
  return context.modes.extend || eventShift(event);
}

// =============================================================================
// MOUSE_DOWN PRIORITY MATRIX
//
// Compose modes with raw modifiers. Effective shift = raw shift ∨ extend
// mode; effective ctrl = raw ctrl ∨ additive mode.
// =============================================================================

function effectiveShiftClick({ context, event }: GuardArgs): boolean {
  if (event.type !== 'MOUSE_DOWN') return false;
  return event.shiftKey || context.modes.extend;
}

function effectiveCtrlClick({ context, event }: GuardArgs): boolean {
  if (event.type !== 'MOUSE_DOWN') return false;
  return event.ctrlKey || context.modes.additive;
}

/** Shift+F8 ADD mode plus raw Shift+Click adds the clicked cell only. */
function isAdditiveShiftOnlyClick({ context, event }: GuardArgs): boolean {
  return (
    event.type === 'MOUSE_DOWN' &&
    context.modes.additive &&
    event.shiftKey &&
    !event.ctrlKey &&
    !context.modes.extend
  );
}

/** Row 4 / 6 / 8: effective shift AND effective ctrl. */
function isShiftAndCtrlClick(args: GuardArgs): boolean {
  return effectiveShiftClick(args) && effectiveCtrlClick(args);
}

/** Row 2 / 5: effective shift, NOT effective ctrl. */
function isShiftOnlyClick(args: GuardArgs): boolean {
  return effectiveShiftClick(args) && !effectiveCtrlClick(args);
}

/** Row 3 / 7: effective ctrl, NOT effective shift. */
function isCtrlOnlyClick(args: GuardArgs): boolean {
  return effectiveCtrlClick(args) && !effectiveShiftClick(args);
}

// =============================================================================
// GUARDS EXPORT
// =============================================================================

/**
 * All guard functions for the selection machine.
 * Export as an object to spread into XState's setup({ guards: ... }).
 */
export const selectionGuards = {
  // Mouse click guards
  isShiftClick,
  isCtrlClick,

  // Keyboard navigation guards
  isShiftArrow,
  hasAnchor,

  // Column/row header selection guards
  isShiftColumnClick,
  isCtrlColumnClick,
  isShiftRowClick,
  isCtrlRowClick,
  isKeyboardColumnSelect,
  isKeyboardRowSelect,

  // Settings-based guards (Issue 8: Settings Panel)
  isFillHandleAllowed,

  // Extended navigation guards (Issue 8 Wave 2B)
  isShiftCtrlArrow,
  isShiftHome,
  isShiftEnd,
  isShiftPageUp,
  isShiftPageDown,
  isShiftPageLeft,
  isShiftPageRight,

  // Viewport-follow emit guard
  isUserSelection,

  // selection-mode priority matrix
  endModeWithShiftIntent,
  endModeWithoutShiftIntent,
  additiveModeWithShift,
  additiveModeWithoutShift,
  extendIntent,
  // MOUSE_DOWN priority matrix
  isAdditiveShiftOnlyClick,
  isShiftAndCtrlClick,
  isShiftOnlyClick,
  isCtrlOnlyClick,
} as const;

/**
 * Type for the guards object, useful for type-safe guard references.
 */
export type SelectionGuards = typeof selectionGuards;

/**
 * Extension Action Handlers - Shift+Arrow selection extension.
 *
 * Handlers for extending the current selection using Shift+Arrow keys.
 * These handlers delegate to the selection commands' keyArrow method with shiftKey=true.
 *
 */

import { handled, type ActionHandler } from './helpers';

// =============================================================================
// Extension Handlers (Shift+Arrow)
// =============================================================================

export const EXTEND_SELECTION_UP: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('up', true);
  return handled();
};

export const EXTEND_SELECTION_DOWN: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('down', true);
  return handled();
};

export const EXTEND_SELECTION_LEFT: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('left', true);
  return handled();
};

export const EXTEND_SELECTION_RIGHT: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('right', true);
  return handled();
};

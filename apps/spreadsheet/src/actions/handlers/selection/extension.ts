/**
 * Extension Action Handlers - Shift+Arrow selection extension.
 *
 * Handlers for extending the current selection using Shift+Arrow keys.
 * In sticky F8 Extend mode, the action is still routed here for bare arrows,
 * but the machine must see shiftKey=false so it can distinguish sticky extend
 * from physical Shift+Arrow for mode handling. Normal Shift+Arrow keeps the
 * anchor as activeCell while the viewport-follow target tracks the moving
 * edge; sticky/additive extend modes keep their legacy edge-active behavior.
 *
 */

import { handled, type ActionHandler } from './helpers';

// =============================================================================
// Extension Handlers (Shift+Arrow)
// =============================================================================

export const EXTEND_SELECTION_UP: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('up', !deps.accessors.selection.getModes().extend);
  return handled();
};

export const EXTEND_SELECTION_DOWN: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('down', !deps.accessors.selection.getModes().extend);
  return handled();
};

export const EXTEND_SELECTION_LEFT: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('left', !deps.accessors.selection.getModes().extend);
  return handled();
};

export const EXTEND_SELECTION_RIGHT: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('right', !deps.accessors.selection.getModes().extend);
  return handled();
};

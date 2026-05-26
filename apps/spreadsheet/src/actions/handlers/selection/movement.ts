/**
 * Movement Action Handlers - Basic arrow key movement.
 *
 * MOVE_UP / MOVE_DOWN / MOVE_LEFT / MOVE_RIGHT delegate to
 * `commands.selection.keyArrow(direction, false)`. The selection machine
 * handles multi-cell collapse (Excel Parity 2.3) and merge-escape internally
 * via `ctx.getMergedRegionAt`, so handlers stay mode-naive and merge-naive.
 *
 * @see machines/selection/keyboard-actions.ts — KEY_ARROW assign actions
 * @see machines/selection/merge-escape.ts — escapeMergeOnMove
 */

import { handled, type ActionHandler } from './helpers';

export const MOVE_UP: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('up', false);
  return handled();
};

export const MOVE_DOWN: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('down', false);
  return handled();
};

export const MOVE_LEFT: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('left', false);
  return handled();
};

export const MOVE_RIGHT: ActionHandler = (deps) => {
  deps.commands.selection.keyArrow('right', false);
  return handled();
};

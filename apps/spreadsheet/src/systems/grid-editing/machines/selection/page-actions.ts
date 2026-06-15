/**
 * Selection Machine - Page Navigation Actions
 *
 * Handles page-based navigation (Issue 8 Wave 2B):
 * - Page Up/Down (pageUp, pageDown + extend variants)
 * - Page Left/Right (pageLeft, pageRight + extend variants)
 *
 * All actions are pure state transitions using XState's assign() function.
 * No side effects - only state updates.
 *
 * @see core-actions.ts - Main export point
 * @see selection-machine.ts - State machine that uses these actions
 */

import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { assign } from 'xstate';
import { getMovingEdge } from '../../../shared/types';
import { buildExtendUpdate, moveInAdditive, moveTo } from './helpers';
import type { SelectionContext, SelectionEvent } from './types';

// All Shift+Page extends route through buildExtendUpdate so the range geometry
// and viewport-follow track the moving edge while activeCell stays anchored.
// getMovingEdge(range, anchor) finds that edge without relying on activeCell.

// =============================================================================
// PAGE NAVIGATION ACTIONS (Issue 8 Wave 2B)
// =============================================================================

/**
 * Page Up: Move up by approximately one viewport height.
 * visibleRows is passed from the UI which knows the viewport size.
 */
const pageUp = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_UP') return {};
    const newRow = Math.max(0, context.activeCell.row - event.visibleRows);
    const newCell = { row: newRow, col: context.activeCell.col };
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Shift+Page Up: Extend selection up by approximately one viewport height.
 * Physical Shift-extension keeps activeCell anchored.
 */
const pageUpExtend = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_UP') return {};
    const anchor = context.anchor ?? context.activeCell;
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    const newRow = Math.max(0, movingEdge.row - event.visibleRows);
    const newEnd = { row: newRow, col: movingEdge.col };
    const activeCell = context.modes.additive || context.modes.extend ? newEnd : anchor;
    return buildExtendUpdate(anchor, newEnd, activeCell);
  },
);

/**
 * Page Down: Move down by approximately one viewport height.
 * visibleRows is passed from the UI which knows the viewport size.
 */
const pageDown = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_DOWN') return {};
    const newRow = Math.min(context.activeCell.row + event.visibleRows, MAX_ROWS - 1);
    const newCell = { row: newRow, col: context.activeCell.col };
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Shift+Page Down: Extend selection down by approximately one viewport height.
 * Physical Shift-extension keeps activeCell anchored.
 */
const pageDownExtend = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_DOWN') return {};
    const anchor = context.anchor ?? context.activeCell;
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    const newRow = Math.min(movingEdge.row + event.visibleRows, MAX_ROWS - 1);
    const newEnd = { row: newRow, col: movingEdge.col };
    const activeCell = context.modes.additive || context.modes.extend ? newEnd : anchor;
    return buildExtendUpdate(anchor, newEnd, activeCell);
  },
);

/**
 * Page Left: Move left by approximately one viewport width.
 * visibleCols is passed from the UI which knows the viewport size.
 */
const pageLeft = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_LEFT') return {};
    const newCol = Math.max(0, context.activeCell.col - event.visibleCols);
    const newCell = { row: context.activeCell.row, col: newCol };
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Shift+Page Left: Extend selection left by approximately one viewport width.
 * Physical Shift-extension keeps activeCell anchored.
 */
const pageLeftExtend = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_LEFT') return {};
    const anchor = context.anchor ?? context.activeCell;
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    const newCol = Math.max(0, movingEdge.col - event.visibleCols);
    const newEnd = { row: movingEdge.row, col: newCol };
    const activeCell = context.modes.additive || context.modes.extend ? newEnd : anchor;
    return buildExtendUpdate(anchor, newEnd, activeCell);
  },
);

/**
 * Page Right: Move right by approximately one viewport width.
 * visibleCols is passed from the UI which knows the viewport size.
 */
const pageRight = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_RIGHT') return {};
    const newCol = Math.min(context.activeCell.col + event.visibleCols, MAX_COLS - 1);
    const newCell = { row: context.activeCell.row, col: newCol };
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Shift+Page Right: Extend selection right by approximately one viewport width.
 * Physical Shift-extension keeps activeCell anchored.
 */
const pageRightExtend = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'PAGE_RIGHT') return {};
    const anchor = context.anchor ?? context.activeCell;
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    const newCol = Math.min(movingEdge.col + event.visibleCols, MAX_COLS - 1);
    const newEnd = { row: movingEdge.row, col: newCol };
    const activeCell = context.modes.additive || context.modes.extend ? newEnd : anchor;
    return buildExtendUpdate(anchor, newEnd, activeCell);
  },
);

// =============================================================================
// EXPORT
// =============================================================================

export const pageActions = {
  pageUp,
  pageUpExtend,
  pageDown,
  pageDownExtend,
  pageLeft,
  pageLeftExtend,
  pageRight,
  pageRightExtend,
} as const;

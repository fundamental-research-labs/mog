/**
 * Navigation Action Handlers
 *
 * Pure handler functions for navigation-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - Navigation actions interact with pane focus via deps.commands.paneFocus (Actor Access Layer)
 *
 * This file handles:
 * - F6 / Shift+F6 pane navigation
 * - Ctrl+Backspace scroll to active cell
 * - Open hyperlink (Context Menus)
 *
 * Excel Parity Quickwins:
 * - E1: F6 Pane Navigation
 * - E4: Ctrl+Backspace Scroll to Active Cell
 * - Context menu OPEN_HYPERLINK action
 *
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';

import { handled, notHandled } from './handler-utils';

// =============================================================================
// Pane Navigation Actions (E1: F6 Pane Navigation)
// =============================================================================

/**
 * F6 - Focus next pane in cycle.
 *
 * Cycles through: toolbar -> formulaBar -> grid -> statusBar -> toolbar
 *
 * Excel Parity Quickwin E1: F6 Pane Navigation
 */
export const FOCUS_NEXT_PANE: ActionHandler = (deps): ActionResult => {
  // Send event to pane focus commands. The actor command surface is the
  // canonical (and only) wiring path post-the
  // legacy stringly-typed callback fallback was deleted along with the
  // rest of the escape hatches.
  const paneFocusCommands = deps.commands.paneFocus;
  if (!paneFocusCommands) {
    return notHandled('disabled');
  }

  paneFocusCommands.focusNextPane();
  return handled();
};

/**
 * Shift+F6 - Focus previous pane in cycle.
 *
 * Cycles through: statusBar -> grid -> formulaBar -> toolbar -> statusBar
 *
 * Excel Parity Quickwin E1: F6 Pane Navigation
 */
export const FOCUS_PREVIOUS_PANE: ActionHandler = (deps): ActionResult => {
  // Send event to pane focus commands. As with FOCUS_NEXT_PANE, the
  // stringly-typed fallback was removed in the
  // actor command surface is the canonical wiring.
  const paneFocusCommands = deps.commands.paneFocus;
  if (!paneFocusCommands) {
    return notHandled('disabled');
  }

  paneFocusCommands.focusPreviousPane();
  return handled();
};

// =============================================================================
// Viewport Navigation Actions (E4: Scroll to Active Cell)
// =============================================================================

/**
 * Ctrl+Backspace (Cmd+Backspace on Mac) - Scroll viewport to center active cell.
 *
 * Ctrl+Backspace path: scroll without changing selection. The viewport-follow
 * coordinator only scrolls on selection changes; this handler is the explicit
 * "I want to see where the active cell is" action that does not move it.
 *
 * Excel Parity Quickwin E4.
 */
export const SCROLL_TO_ACTIVE_CELL: ActionHandler = (deps): ActionResult => {
  const activeCell = deps.accessors.selection.getActiveCell();
  if (!activeCell) {
    return notHandled('disabled');
  }

  if (!deps.commands.renderer) {
    return notHandled('disabled');
  }

  deps.commands.renderer.scrollToActiveCell(activeCell);
  return handled();
};

// =============================================================================
// End Mode Navigation
// =============================================================================

/**
 * Toggle End Mode on/off.
 *
 * End Mode is a stateful navigation mode where pressing End key followed by
 * an arrow key jumps to the edge of data regions (like Ctrl+Arrow but requires
 * pressing End first, then arrow).
 *
 * End Mode Behavior:
 * 1. Press End → Activates End Mode (status bar shows "End")
 * 2. Press Arrow → Navigates to data boundary AND deactivates End Mode
 * 3. Press End again while active → Deactivates End Mode
 *
 * End-mode flag lives in `ctx.modes.end` on the selection
 * machine. Read the current value via `accessors.selection.getModes()`
 * and toggle via `commands.selection.setMode('end', !curr)`. Distinct from
 * `ACTIVATE_END_MODE` (selection/modes.ts) — that one only activates.
 *
 * End Mode Navigation
 *
 */
export const TOGGLE_END_MODE: ActionHandler = (deps): ActionResult => {
  const modes = deps.accessors.selection.getModes();
  deps.commands.selection.setMode('end', !modes.end);
  return handled();
};

// =============================================================================
// Hyperlink Actions (Context Menus)
// =============================================================================

/**
 * Open hyperlink at the active cell.
 *
 * Context Menus - Item 4.2
 *
 * Security considerations:
 * - Only allows http:, https:, mailto:, tel: protocols
 * - Blocks javascript:, file:, data: URLs
 * - Opens in new tab with noopener,noreferrer
 */
export const OPEN_HYPERLINK: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(deps.getActiveSheetId());
  const hyperlink = await ws.hyperlinks.get(activeCell.row, activeCell.col);

  if (!hyperlink) {
    return notHandled('disabled');
  }

  const url = hyperlink;

  // Validate URL protocol for security
  const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];
  try {
    const parsed = new URL(url);
    if (!allowedProtocols.includes(parsed.protocol)) {
      console.warn('Blocked hyperlink with disallowed protocol:', parsed.protocol);
      return notHandled('disabled');
    }
  } catch {
    console.warn('Invalid hyperlink URL:', url);
    return notHandled('disabled');
  }

  // Open URL in new tab with security attributes
  window.open(url, '_blank', 'noopener,noreferrer');
  return handled();
};

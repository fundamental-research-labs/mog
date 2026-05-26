/**
 * Draw Border Action Handlers
 *
 * Handles draw border tool activation/deactivation actions:
 * - ACTIVATE_DRAW_BORDER - Activate draw border mode
 * - ACTIVATE_DRAW_BORDER_GRID - Activate draw border grid mode
 * - ACTIVATE_ERASE_BORDER - Activate erase border mode
 * - DEACTIVATE_DRAW_BORDER - Deactivate any draw border mode
 *
 * These handlers send events to the draw border machine via deps.commands.drawBorder
 * (Actor Access Layer), which the coordinator then uses to apply borders as the user draws.
 *
 */

import type { ActionHandler } from '@mog-sdk/contracts/actions';

import { handled, notHandled } from '../handler-utils';

// =============================================================================
// Payload Types
// =============================================================================

/**
 * Payload for ACTIVATE_DRAW_BORDER and ACTIVATE_DRAW_BORDER_GRID actions.
 */
export interface ActivateDrawBorderPayload {
  /** Border style to apply when drawing */
  borderStyle: {
    color: string;
    style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair';
  };
}

// =============================================================================
// Draw Border Handlers
// =============================================================================

/**
 * Activate draw border mode.
 *
 * In this mode, clicking and dragging on cells applies the specified
 * border style to the outer edges of each cell.
 *
 * @param deps - Action dependencies
 * @param payload - { borderStyle: { color, style } }
 */
export const ACTIVATE_DRAW_BORDER: ActionHandler = (deps, payload) => {
  const drawBorderCommands = deps.commands.drawBorder;

  // Check if draw border commands are available
  if (!drawBorderCommands) {
    // Draw border feature not initialized
    return notHandled('disabled');
  }

  const data = payload as ActivateDrawBorderPayload | undefined;

  // Default border style if not specified
  const borderStyle = data?.borderStyle ?? {
    color: '#000000',
    style: 'thin' as const,
  };

  const sheetId = deps.getActiveSheetId();

  // Send activation event to draw border machine
  drawBorderCommands.activateDrawBorder(borderStyle, sheetId);

  return handled();
};

/**
 * Activate draw border grid mode.
 *
 * In this mode, clicking and dragging on cells applies the specified
 * border style as a complete grid (all four edges) to each cell.
 *
 * @param deps - Action dependencies
 * @param payload - { borderStyle: { color, style } }
 */
export const ACTIVATE_DRAW_BORDER_GRID: ActionHandler = (deps, payload) => {
  const drawBorderCommands = deps.commands.drawBorder;

  // Check if draw border commands are available
  if (!drawBorderCommands) {
    // Draw border feature not initialized
    return notHandled('disabled');
  }

  const data = payload as ActivateDrawBorderPayload | undefined;

  // Default border style if not specified
  const borderStyle = data?.borderStyle ?? {
    color: '#000000',
    style: 'thin' as const,
  };

  const sheetId = deps.getActiveSheetId();

  // Send activation event to draw border machine
  drawBorderCommands.activateDrawBorderGrid(borderStyle, sheetId);

  return handled();
};

/**
 * Activate erase border mode.
 *
 * In this mode, clicking and dragging on cells removes all borders
 * from each cell.
 *
 * @param deps - Action dependencies
 */
export const ACTIVATE_ERASE_BORDER: ActionHandler = (deps) => {
  const drawBorderCommands = deps.commands.drawBorder;

  // Check if draw border commands are available
  if (!drawBorderCommands) {
    // Draw border feature not initialized
    return notHandled('disabled');
  }

  const sheetId = deps.getActiveSheetId();

  // Send activation event to draw border machine
  drawBorderCommands.activateEraseBorder(sheetId);

  return handled();
};

/**
 * Deactivate any active draw border mode.
 *
 * Returns the draw border machine to the inactive state.
 *
 * @param deps - Action dependencies
 */
export const DEACTIVATE_DRAW_BORDER: ActionHandler = (deps) => {
  const drawBorderCommands = deps.commands.drawBorder;

  // Check if draw border commands are available
  if (!drawBorderCommands) {
    // Draw border feature not initialized - nothing to deactivate
    return handled();
  }

  // Send deactivation event to draw border machine
  drawBorderCommands.deactivate();

  return handled();
};

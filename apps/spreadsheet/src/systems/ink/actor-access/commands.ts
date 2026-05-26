/**
 * Ink Machine Commands
 *
 * Type-safe command wrappers for ink machine events.
 * Part of the Actor Access Layer pattern - commands via send().
 *
 * ARCHITECTURE NOTES:
 * - Commands provide type-safe event dispatch
 * - Each command maps to a single machine event
 * - No side effects - just event dispatch
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Actor Access Layer
 */

import type { InkPoint, InkTool, StrokeId } from '@mog-sdk/contracts/ink';
import type { AnyActorRef } from 'xstate';

import type { InkEvent, InkSelectionMode } from '../machines/types';

// =============================================================================
// COMMAND INTERFACE
// =============================================================================

/**
 * Command interface for ink operations.
 *
 * These wrap actor.send() calls for type safety and provide
 * a clean API for controlling the ink machine.
 */
export interface InkCommands {
  // Mode transitions
  /**
   * Activate ink mode for a drawing object.
   * @param drawingId - ID of the drawing object to edit
   */
  activate(drawingId: string): void;

  /**
   * Deactivate ink mode, returning to idle state.
   */
  deactivate(): void;

  // Pen operations
  /**
   * Start a new stroke.
   * @param point - Starting point of the stroke
   * @param strokeId - Unique ID for the new stroke
   */
  penDown(point: InkPoint, strokeId: StrokeId): void;

  /**
   * Continue the current stroke.
   * @param point - Next point in the stroke
   */
  penMove(point: InkPoint): void;

  /**
   * End the current stroke.
   */
  penUp(): void;

  // Eraser operations
  /**
   * Start erasing.
   * @param point - Starting point of the eraser
   */
  eraserDown(point: InkPoint): void;

  /**
   * Move the eraser.
   * @param point - Current eraser position
   */
  eraserMove(point: InkPoint): void;

  /**
   * Stop erasing.
   */
  eraserUp(): void;

  // Lasso operations
  /**
   * Start lasso selection.
   * @param point - Starting point of the lasso
   */
  lassoStart(point: InkPoint): void;

  /**
   * Continue lasso selection.
   * @param point - Next point in the lasso
   */
  lassoMove(point: InkPoint): void;

  /**
   * End lasso selection.
   */
  lassoEnd(): void;

  // Settings
  /**
   * Change the active ink tool.
   * @param tool - Tool to activate
   */
  setTool(tool: InkTool): void;

  /**
   * Change the stroke color.
   * @param color - CSS color string
   */
  setColor(color: string): void;

  /**
   * Change the stroke width.
   * @param width - Width in pixels
   */
  setWidth(width: number): void;

  /**
   * Change the stroke opacity.
   * @param opacity - Opacity value (0-1)
   */
  setOpacity(opacity: number): void;

  // Selection
  /**
   * Change the selection mode.
   * @param mode - Selection mode to activate
   */
  setSelectionMode(mode: InkSelectionMode): void;

  /**
   * Set the selected strokes.
   * @param strokeIds - IDs of strokes to select
   */
  setSelectedStrokes(strokeIds: StrokeId[]): void;

  /**
   * Clear the current selection.
   */
  clearSelection(): void;
}

// =============================================================================
// COMMAND FACTORY
// =============================================================================

/**
 * Create commands object that wraps an ink actor.
 *
 * @param actor - The ink machine actor to control
 * @returns Object with type-safe command methods
 *
 * @example
 * const commands = createInkCommands(inkActor);
 * commands.activate('drawing-123');
 * commands.setTool('pen');
 * commands.penDown({ x: 100, y: 100 }, generateStrokeId());
 */
export function createInkCommands(actor: AnyActorRef): InkCommands {
  const send = (event: InkEvent) => actor.send(event);

  return {
    // Mode transitions
    activate: (drawingId) => send({ type: 'ACTIVATE', drawingId }),
    deactivate: () => send({ type: 'DEACTIVATE' }),

    // Pen operations
    penDown: (point, strokeId) => send({ type: 'PEN_DOWN', point, strokeId }),
    penMove: (point) => send({ type: 'PEN_MOVE', point }),
    penUp: () => send({ type: 'PEN_UP' }),

    // Eraser operations
    eraserDown: (point) => send({ type: 'ERASER_DOWN', point }),
    eraserMove: (point) => send({ type: 'ERASER_MOVE', point }),
    eraserUp: () => send({ type: 'ERASER_UP' }),

    // Lasso operations
    lassoStart: (point) => send({ type: 'LASSO_START', point }),
    lassoMove: (point) => send({ type: 'LASSO_MOVE', point }),
    lassoEnd: () => send({ type: 'LASSO_END' }),

    // Settings
    setTool: (tool) => send({ type: 'SET_TOOL', tool }),
    setColor: (color) => send({ type: 'SET_COLOR', color }),
    setWidth: (width) => send({ type: 'SET_WIDTH', width }),
    setOpacity: (opacity) => send({ type: 'SET_OPACITY', opacity }),

    // Selection
    setSelectionMode: (mode) => send({ type: 'SET_SELECTION_MODE', mode }),
    setSelectedStrokes: (strokeIds) => send({ type: 'SET_SELECTED_STROKES', strokeIds }),
    clearSelection: () => send({ type: 'CLEAR_SELECTION' }),
  };
}

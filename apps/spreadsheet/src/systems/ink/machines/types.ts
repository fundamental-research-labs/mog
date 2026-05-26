/**
 * Ink Machine Context Types
 *
 * Defines the context and event types for the ink state machine.
 * This module provides mutable buffer utilities for high-performance
 * stroke capture during drawing operations.
 *
 * ARCHITECTURE NOTES:
 * - Performance-First: Uses mutable buffer to avoid GC pressure during stroking
 * - CRDT-Safe: Machine is pure, all persistence handled by coordinator
 * - XState v5 Compatible: Uses setup() pattern for type-safe machine definition
 *
 */

import type { InkPoint, InkTool, StrokeId } from '@mog-sdk/contracts/ink';

// =============================================================================
// SELECTION MODE (Extended for Machine State)
// =============================================================================

/**
 * Selection mode for the ink machine.
 *
 * Extends the contracts SelectionMode to include 'none' state for
 * tracking when no selection operation is active.
 *
 * - 'none': No selection mode active (default)
 * - 'lasso': Free-form lasso selection
 * - 'rectangle': Rectangular selection box
 */
export type InkSelectionMode = 'none' | 'lasso' | 'rectangle';

// =============================================================================
// INK CONTEXT
// =============================================================================

/**
 * Ink machine context - minimal state required for drawing
 *
 * PERFORMANCE NOTE: currentStrokeBuffer is a mutable array that gets mutated
 * during stroking to avoid creating new arrays 60+ times per second.
 * Only copied to immutable on stroke completion.
 */
export interface InkContext {
  // Current drawing session
  /** ID of the drawing object being edited (null if not in drawing mode) */
  targetDrawingId: string | null;

  // Active stroke data (mutable during stroking for performance)
  /** ID of the stroke currently being drawn */
  currentStrokeId: StrokeId | null;
  /**
   * Mutable buffer for stroke points - mutated in place during stroking.
   * Pre-allocated to avoid array reallocations during drawing.
   */
  currentStrokeBuffer: InkPoint[];
  /** Track actual length (buffer may be pre-allocated with empty slots) */
  currentStrokeBufferLength: number;

  // Tool settings
  /** Currently active ink tool */
  activeTool: InkTool;
  /** Current stroke color (CSS color string) */
  activeColor: string;
  /** Current stroke width in pixels */
  activeWidth: number;
  /** Current stroke opacity (0-1) */
  activeOpacity: number;

  // Selection
  /** Current selection mode */
  selectionMode: InkSelectionMode;
  /** Points defining the lasso selection boundary */
  lassoPoints: InkPoint[];
  /** IDs of currently selected strokes */
  selectedStrokeIds: StrokeId[];

  // Last known point (for eraser cursor, etc.)
  /** Last point recorded (for cursor display and eraser position) */
  lastPoint: InkPoint | null;
}

// =============================================================================
// INK EVENTS
// =============================================================================

/**
 * Events that can be sent to the ink machine.
 *
 * Organized by category:
 * - Mode transitions: ACTIVATE, DEACTIVATE
 * - Pen operations: PEN_DOWN, PEN_MOVE, PEN_UP
 * - Eraser operations: ERASER_DOWN, ERASER_MOVE, ERASER_UP
 * - Lasso operations: LASSO_START, LASSO_MOVE, LASSO_END
 * - Settings: SET_TOOL, SET_COLOR, SET_WIDTH, SET_OPACITY
 * - Selection: SET_SELECTION_MODE, SET_SELECTED_STROKES, CLEAR_SELECTION
 */
export type InkEvent =
  // Mode transitions
  | { type: 'ACTIVATE'; drawingId: string }
  | { type: 'DEACTIVATE' }
  // Pen operations
  | { type: 'PEN_DOWN'; point: InkPoint; strokeId: StrokeId }
  | { type: 'PEN_MOVE'; point: InkPoint }
  | { type: 'PEN_UP' }
  // Eraser operations
  | { type: 'ERASER_DOWN'; point: InkPoint }
  | { type: 'ERASER_MOVE'; point: InkPoint }
  | { type: 'ERASER_UP' }
  // Lasso operations
  | { type: 'LASSO_START'; point: InkPoint }
  | { type: 'LASSO_MOVE'; point: InkPoint }
  | { type: 'LASSO_END' }
  // Settings
  | { type: 'SET_TOOL'; tool: InkTool }
  | { type: 'SET_COLOR'; color: string }
  | { type: 'SET_WIDTH'; width: number }
  | { type: 'SET_OPACITY'; opacity: number }
  // Selection
  | { type: 'SET_SELECTION_MODE'; mode: InkSelectionMode }
  | { type: 'SET_SELECTED_STROKES'; strokeIds: StrokeId[] }
  | { type: 'CLEAR_SELECTION' };

// =============================================================================
// INITIAL CONTEXT FACTORY
// =============================================================================

/** Default pre-allocated buffer size (500 points ≈ 8 seconds at 60fps) */
const DEFAULT_BUFFER_SIZE = 500;

/**
 * Create initial ink context with pre-allocated buffer.
 *
 * Pre-allocates a buffer for stroke points to avoid repeated
 * array reallocations during drawing. The buffer auto-grows
 * if a stroke exceeds the initial capacity.
 */
export function createInitialInkContext(): InkContext {
  return {
    targetDrawingId: null,
    currentStrokeId: null,
    // Pre-allocate buffer for typical stroke (500 points at 60fps ≈ 8 seconds)
    currentStrokeBuffer: new Array(DEFAULT_BUFFER_SIZE),
    currentStrokeBufferLength: 0,
    activeTool: 'pen',
    activeColor: '#000000',
    activeWidth: 2,
    activeOpacity: 1,
    selectionMode: 'none',
    lassoPoints: [],
    selectedStrokeIds: [],
    lastPoint: null,
  };
}

// =============================================================================
// BUFFER UTILITIES
// =============================================================================

/**
 * Get the current stroke as an immutable copy.
 *
 * Only call this when stroke is complete (PEN_UP) - creates
 * a new array to prevent mutation of the returned value.
 *
 * @param context - Ink context containing the stroke buffer
 * @returns New array containing only the valid stroke points
 */
export function getCurrentStrokeCopy(context: InkContext): InkPoint[] {
  return context.currentStrokeBuffer.slice(0, context.currentStrokeBufferLength);
}

/**
 * Reset the stroke buffer for next stroke.
 *
 * Does NOT reallocate the array - just resets the length counter.
 * This preserves the pre-allocated capacity for the next stroke.
 *
 * @param context - Ink context to reset
 */
export function resetStrokeBuffer(context: InkContext): void {
  context.currentStrokeBufferLength = 0;
  // Don't reallocate the array - just reset the length counter
}

/**
 * Add a point to the stroke buffer (mutates in place for performance).
 *
 * If the buffer is full, automatically grows it by doubling capacity.
 * This mutation is intentional for performance - avoids creating
 * new arrays on every mouse move event (60+ times per second).
 *
 * @param context - Ink context to modify
 * @param point - Point to add to the buffer
 */
export function addPointToBuffer(context: InkContext, point: InkPoint): void {
  const index = context.currentStrokeBufferLength;

  // Grow buffer if needed (double capacity)
  if (index >= context.currentStrokeBuffer.length) {
    const newCapacity = context.currentStrokeBuffer.length * 2;
    const newBuffer = new Array(newCapacity);
    for (let i = 0; i < index; i++) {
      newBuffer[i] = context.currentStrokeBuffer[i];
    }
    context.currentStrokeBuffer = newBuffer;
  }

  context.currentStrokeBuffer[index] = point;
  context.currentStrokeBufferLength++;
}

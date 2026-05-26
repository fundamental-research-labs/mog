/**
 * Ink Coordination Module
 *
 * Wires ink input handling to the state machine and persistence layer.
 * This is the bridge between raw pointer events and the ink engine.
 *
 * ARCHITECTURE NOTES:
 * - Reads Direct: Uses inkSelectors to read machine state
 * - Writes Orchestrated: All writes go through Mutations layer
 * - XState Machines Pure: Machine receives events, coordination performs side effects
 * - Resource Ownership: Owned by coordinator (SheetCoordinator or GridCoordinator)
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md
 */

import type { DrawingObject, InkPoint, InkStroke, StrokeId } from '@mog-sdk/contracts/ink';
import { generateStrokeId } from '@mog/spreadsheet-utils/ink/types';
import {
  createInkAccessor,
  createInkCommands,
  type InkAccessor,
  type InkCommands,
} from '../actor-access';
import { getCurrentStrokeCopy, inkSelectors, resetStrokeBuffer, type InkActor } from '../machines';
import { createInkInputHandler, type InkInputHandler } from './ink-input-handler';
import type { PointerInputType } from './ink-touch-discriminator';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Debounce delay for batched erasing operations.
 * Groups rapid eraser movements into single Yjs transactions.
 */
const ERASE_BATCH_DELAY_MS = 50;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for ink coordination.
 */
export interface InkCoordinationConfig {
  /**
   * The ink state machine actor.
   */
  inkActor: InkActor;

  /**
   * The canvas element for attaching input handlers.
   */
  canvas: HTMLCanvasElement;

  /**
   * Current user ID for stroke attribution.
   */
  userId: string;

  /**
   * Active sheet ID.
   */
  sheetId: string;

  /**
   * Get the offset from viewport to drawing local coordinates.
   * Called during point extraction.
   */
  getDrawingOffset?: () => { x: number; y: number };

  /**
   * Mutation callbacks injected from coordinator layer.
   * systems/ must NOT import from coordinator/mutations/ directly.
   */
  mutations: {
    addStroke: (drawingId: string, stroke: InkStroke) => Promise<void>;
    eraseStrokes: (drawingId: string, strokeIds: StrokeId[]) => Promise<void>;
  };

  /**
   * Query callbacks injected from coordinator layer.
   * Provides drawing read access without importing kernel internals.
   */
  queries: {
    /** Get a drawing by ID with deserialized Map fields. */
    getDrawing: (drawingId: string) => Promise<DrawingObject | null>;
    /** Find strokes at a point using spatial index. */
    findStrokesAtPoint: (
      drawing: DrawingObject,
      x: number,
      y: number,
      tolerance?: number,
    ) => StrokeId[];
  };
}

/**
 * Ink coordination result.
 */
export interface InkCoordination {
  /**
   * Get the ink accessor for reading state.
   */
  getAccessor(): InkAccessor;

  /**
   * Get the ink commands for sending events.
   */
  getCommands(): InkCommands;

  /**
   * Get the input handler for external control.
   */
  getInputHandler(): InkInputHandler;

  /**
   * Activate ink mode for a drawing.
   * @param drawingId - ID of the drawing to edit
   */
  activate(drawingId: string): void;

  /**
   * Deactivate ink mode.
   */
  deactivate(): void;

  /**
   * Check if ink mode is active.
   */
  isActive(): boolean;

  /**
   * Dispose the coordination and release resources.
   */
  dispose(): void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create ink coordination.
 *
 * @param config - Configuration options
 * @returns InkCoordination instance
 *
 * @example
 * const coordination = createInkCoordination({
 * inkActor,
 * canvas,
 * userId: 'user-123',
 * sheetId: 'sheet-1'
 * });
 *
 * coordination.activate('drawing-456');
 * // ... user draws ...
 * coordination.deactivate();
 * coordination.dispose();
 */
export function createInkCoordination(config: InkCoordinationConfig): InkCoordination {
  const {
    inkActor,
    canvas,
    userId,
    // sheetId is available for future use (e.g., multi-sheet ink support)
    // sheetId,
    getDrawingOffset,
  } = config;

  // Create commands and accessor from actor
  const commands = createInkCommands(inkActor);
  const accessor = createInkAccessor(inkActor);

  // State
  let isDisposed = false;
  let inputHandler: InkInputHandler | null = null;
  let activeDrawingId: string | null = null;

  // Eraser batching state
  let eraseBatchTimeout: ReturnType<typeof setTimeout> | null = null;
  const pendingEraseStrokeIds: Set<StrokeId> = new Set();

  // ==========================================================================
  // DRAWING ACCESS
  // ==========================================================================

  /**
   * Get the active drawing object.
   * Delegates to the injected queries.getDrawing() callback.
   *
   * @returns The active drawing object or null if not found
   */
  async function getActiveDrawing(): Promise<DrawingObject | null> {
    if (!activeDrawingId) return null;
    return config.queries.getDrawing(activeDrawingId);
  }

  // ==========================================================================
  // STROKE ID GENERATION
  // ==========================================================================

  /**
   * Generate a new stroke ID with user attribution.
   */
  function generateUniqueStrokeId(): StrokeId {
    return generateStrokeId();
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  /**
   * Commit a completed stroke to Yjs via Mutations layer.
   */
  function commitStroke(): void {
    if (!activeDrawingId) return;

    const state = inkActor.getSnapshot();
    const strokeId = inkSelectors.currentStrokeId(state);
    if (!strokeId) return;

    // Get stroke data from machine
    const points = getCurrentStrokeCopy(state.context);
    if (points.length === 0) return;

    // Build stroke object
    const stroke: InkStroke = {
      id: strokeId,
      points,
      tool: inkSelectors.activeTool(state),
      color: inkSelectors.activeColor(state),
      width: inkSelectors.activeWidth(state),
      opacity: inkSelectors.activeOpacity(state),
      createdBy: userId,
      createdAt: Date.now(),
    };

    // Commit via Mutations layer (injected)
    config.mutations.addStroke(activeDrawingId, stroke);

    // Reset the machine's stroke buffer
    resetStrokeBuffer(state.context);
  }

  /**
   * Flush any pending eraser operations.
   */
  function flushEraseBatch(): void {
    if (eraseBatchTimeout !== null) {
      clearTimeout(eraseBatchTimeout);
      eraseBatchTimeout = null;
    }

    if (pendingEraseStrokeIds.size === 0 || !activeDrawingId) return;

    // Commit via Mutations layer (injected)
    const strokeIds = Array.from(pendingEraseStrokeIds);
    config.mutations.eraseStrokes(activeDrawingId, strokeIds);

    // Clear pending
    pendingEraseStrokeIds.clear();
  }

  /**
   * Add stroke IDs to the erase batch.
   * Uses debouncing to group rapid eraser movements into single Yjs transactions.
   *
   * Called from handleEraseMove when spatial index hit testing finds strokes
   * under the eraser cursor.
   *
   * @param strokeIds - Array of stroke IDs to batch for erasure
   */
  function batchErase(strokeIds: StrokeId[]): void {
    for (const id of strokeIds) {
      pendingEraseStrokeIds.add(id);
    }

    // Debounce the flush
    if (eraseBatchTimeout !== null) {
      clearTimeout(eraseBatchTimeout);
    }

    eraseBatchTimeout = setTimeout(flushEraseBatch, ERASE_BATCH_DELAY_MS);
  }

  // ==========================================================================
  // INPUT HANDLER CALLBACKS
  // ==========================================================================

  /**
   * Handle stroke start from input handler.
   */
  function handleStrokeStart(point: InkPoint, _pointerType: PointerInputType): void {
    if (!activeDrawingId) return;

    const strokeId = generateUniqueStrokeId();
    commands.penDown(point, strokeId);
  }

  /**
   * Handle stroke move from input handler.
   * Processes all coalesced points.
   */
  function handleStrokeMove(points: InkPoint[], _pointerType: PointerInputType): void {
    // Send each coalesced point to the machine
    // The machine buffers them for rendering
    for (const point of points) {
      commands.penMove(point);
    }
  }

  /**
   * Handle stroke end from input handler.
   */
  function handleStrokeEnd(_point: InkPoint | null, _pointerType: PointerInputType): void {
    // Send pen up to machine
    commands.penUp();

    // Commit the completed stroke to persistence
    commitStroke();
  }

  /**
   * Handle stroke cancel from input handler.
   */
  function handleStrokeCancel(): void {
    // Just send pen up - don't commit incomplete stroke
    const state = inkActor.getSnapshot();
    if (inkSelectors.isStroking(state)) {
      commands.penUp();
      // Reset buffer without committing
      resetStrokeBuffer(state.context);
    }
  }

  /**
   * Handle erase start from input handler.
   */
  function handleEraseStart(point: InkPoint): void {
    commands.eraserDown(point);
  }

  /**
   * Handle erase move from input handler.
   * Hit tests each point against strokes using spatial index and batches deletions.
   *
   * PERFORMANCE: Uses GridSpatialIndex for O(1) average case candidate lookup,
   * then precise hit testing on candidates only.
   */
  async function handleEraseMove(points: InkPoint[]): Promise<void> {
    // Get the active drawing for hit testing
    const drawing = await getActiveDrawing();

    for (const point of points) {
      commands.eraserMove(point);

      // Perform spatial index hit testing if we have a drawing
      if (drawing) {
        // Get eraser width from current tool settings for tolerance
        const state = inkActor.getSnapshot();
        const eraserWidth = inkSelectors.activeWidth(state);

        // findStrokesAtPoint uses spatial index for O(1) candidate lookup,
        // then precise hit testing. Tolerance is half eraser width + small buffer.
        const hitTolerance = eraserWidth / 2;
        const hitStrokeIds = config.queries.findStrokesAtPoint(
          drawing,
          point.x,
          point.y,
          hitTolerance,
        );

        if (hitStrokeIds.length > 0) {
          batchErase(hitStrokeIds);
        }
      }
    }
  }

  /**
   * Handle erase end from input handler.
   */
  function handleEraseEnd(): void {
    commands.eraserUp();
    // Flush any pending erases
    flushEraseBatch();
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  function activate(drawingId: string): void {
    if (isDisposed) return;
    if (activeDrawingId === drawingId) return;

    // Deactivate previous if any
    if (activeDrawingId) {
      deactivate();
    }

    activeDrawingId = drawingId;

    // Send activation to machine
    commands.activate(drawingId);

    // Create and attach input handler
    inputHandler = createInkInputHandler({
      target: canvas,
      callbacks: {
        onStrokeStart: handleStrokeStart,
        onStrokeMove: handleStrokeMove,
        onStrokeEnd: handleStrokeEnd,
        onStrokeCancel: handleStrokeCancel,
        onEraseStart: handleEraseStart,
        onEraseMove: handleEraseMove,
        onEraseEnd: handleEraseEnd,
      },
      isEraserActive: () => accessor.getActiveTool() === 'eraser',
      getDrawingOffset,
    });

    inputHandler.attach();
  }

  function deactivate(): void {
    if (isDisposed) return;
    if (!activeDrawingId) return;

    // Flush any pending operations
    flushEraseBatch();

    // Cancel any active stroke
    inputHandler?.cancelStroke();

    // Detach input handler
    inputHandler?.detach();
    inputHandler?.destroy();
    inputHandler = null;

    // Send deactivation to machine
    commands.deactivate();

    activeDrawingId = null;
  }

  function dispose(): void {
    if (isDisposed) return;

    // Deactivate first
    deactivate();

    isDisposed = true;
  }

  return {
    getAccessor: () => accessor,
    getCommands: () => commands,
    getInputHandler: () => {
      if (!inputHandler) {
        throw new Error('Input handler not available - ink mode not active');
      }
      return inputHandler;
    },
    activate,
    deactivate,
    isActive: () => accessor.isActive(),
    dispose,
  };
}

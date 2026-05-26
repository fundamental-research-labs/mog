/**
 * Renderer Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - unmounted: Initial state, no resources allocated
 * - waitingForLayout: Container mounted, waiting for dimensions
 * - initializing: Creating renderer and bridges
 * - ready: Fully operational, accepting actions
 * - switchingSheet: Transitioning between sheets
 * - suspended: Tab backgrounded, render loop paused
 * - error: Initialization or operation failed
 * - disposing: Cleaning up resources
 *
 * ARCHITECTURE: Selectors are the single primitive for extraction logic.
 * - Snapshots compose selectors (no duplication)
 * - Accessors wrap selectors + getSnapshot() (no duplication)
 * - Hooks use selectors directly with useSelector (no duplication)
 *
 * @see state-machines/src/renderer-machine.ts
 * @module @mog-sdk/contracts/actors/renderer
 */

import type { CellRange } from '@mog/types-core';
import type { RendererStatus } from '../machines/types';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';
import type { RenderPriority } from '@mog/types-viewport/rendering/grid-renderer-primitives';

// =============================================================================
// TYPES (from renderer-machine.ts)
// =============================================================================

/**
 * Actions that can be queued when renderer is not ready.
 * Applied when renderer transitions to 'ready' state.
 */
export type PendingAction =
  | { type: 'setSelection'; ranges: CellRange[]; activeCell: CellCoord }
  | { type: 'scrollTo'; top: number; left: number }
  | { type: 'invalidate'; priority: RenderPriority; regions?: CellRange[] };

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface RendererState {
  context: {
    /** The container element for the canvas */
    container: HTMLElement | null;
    /** Current canvas width */
    width: number;
    /** Current canvas height */
    height: number;
    /** Currently active sheet ID */
    currentSheetId: string | null;
    /** Sheet ID being switched to */
    targetSheetId: string | null;
    /** Actions queued before renderer was ready */
    pendingActions: PendingAction[];
    /** Last error that occurred */
    error: Error | null;
    /** Number of retry attempts */
    retryCount: number;
    /** Maximum retry attempts before giving up */
    maxRetries: number;
  };
  value: string;
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

/**
 * RendererAccessor interface for handlers.
 * Mirrors selectors 1:1 with method names (get* prefix for values).
 *
 * This is the contract that handlers use to read renderer state.
 */
export interface RendererAccessor {
  // ===========================================================================
  // Value Accessors (match value selectors)
  // ===========================================================================

  /** Get the container element */
  getContainer(): HTMLElement | null;

  /** Get the canvas width */
  getWidth(): number;

  /** Get the canvas height */
  getHeight(): number;

  /** Get the current sheet ID */
  getCurrentSheetId(): string | null;

  /** Get the target sheet ID (during sheet switching) */
  getTargetSheetId(): string | null;

  /** Get pending actions */
  getPendingActions(): PendingAction[];

  /** Get the last error */
  getError(): Error | null;

  /** Get the retry count */
  getRetryCount(): number;

  /** Get the max retries */
  getMaxRetries(): number;

  // ===========================================================================
  // State Matching Accessors (match state selectors)
  // ===========================================================================

  /** Check if in unmounted state */
  isUnmounted(): boolean;

  /** Check if waiting for layout */
  isWaitingForLayout(): boolean;

  /** Check if initializing */
  isInitializing(): boolean;

  /** Check if ready */
  isReady(): boolean;

  /** Check if switching sheet */
  isSwitchingSheet(): boolean;

  /** Check if suspended */
  isSuspended(): boolean;

  /** Check if in error state */
  isError(): boolean;

  /** Check if disposing */
  isDisposing(): boolean;

  // ===========================================================================
  // Derived Accessors
  // ===========================================================================

  /** Get the renderer status */
  getStatus(): RendererStatus;

  /** Check if switching (alias for isSwitchingSheet) */
  isSwitching(): boolean;

  /** Check if renderer can accept operations */
  canAcceptOperations(): boolean;

  /** Check if renderer has valid dimensions */
  hasValidDimensions(): boolean;

  /** Check if there are pending actions */
  hasPendingActions(): boolean;

  /** Check if retry is possible */
  canRetry(): boolean;
}

// =============================================================================
// COMMANDS INTERFACE (for Actor Access Layer)
// =============================================================================

/**
 * Commands for the renderer state machine.
 * Handles renderer lifecycle, visibility, error handling, and rendering operations.
 *
 * All methods are fire-and-forget (return void) - commands trigger state
 * transitions, not queries.
 *
 * @see state-machines/src/renderer-machine.ts for event definitions
 */
export interface RendererCommands {
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Mount the renderer with a container element.
   * @param container - The container element for the canvas
   */
  mount(container: HTMLElement): void;

  /**
   * Signal that layout is ready with dimensions.
   * @param width - Canvas width in pixels
   * @param height - Canvas height in pixels
   */
  layoutReady(width: number, height: number): void;

  /**
   * Signal that initialization is complete.
   * @param sheetId - The initial sheet ID
   */
  initialized(sheetId: string): void;

  /**
   * Switch to a different sheet.
   * @param sheetId - The target sheet ID
   */
  switchSheet(sheetId: string): void;

  /**
   * Signal that sheet switch is complete.
   */
  sheetSwitched(): void;

  /**
   * Unmount the renderer.
   */
  unmount(): void;

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  /**
   * Suspend the renderer (tab hidden).
   */
  suspend(): void;

  /**
   * Resume the renderer (tab visible).
   */
  resume(): void;

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  /**
   * Report an error.
   * @param error - The error that occurred
   */
  reportError(error: Error): void;

  /**
   * Retry after error.
   */
  retry(): void;

  // -------------------------------------------------------------------------
  // Rendering Operations
  // -------------------------------------------------------------------------

  /**
   * Handle container resize.
   * @param width - New width in pixels
   * @param height - New height in pixels
   */
  resize(width: number, height: number): void;

  /**
   * Invalidate regions for re-render.
   * @param priority - Render priority
   * @param regions - Optional regions to invalidate
   */
  invalidate(priority: RenderPriority, regions?: CellRange[]): void;

  /**
   * Scroll the viewport to ensure the given cell is visible.
   *
   * Fire-and-forget: dispatches a SCROLL_TO_ACTIVE_CELL event to the renderer
   * machine. The machine emits a request the RenderSystem listens for and
   * applies via the coordinate system + setScrollPosition path. No-op when
   * the renderer is not ready (no current sheet, no coordinate system).
   *
   * @param cell - The cell coordinate to bring into view
   */
  scrollToActiveCell(cell: CellCoord): void;
}

// Re-export RendererStatus for convenience
export type { RendererStatus };

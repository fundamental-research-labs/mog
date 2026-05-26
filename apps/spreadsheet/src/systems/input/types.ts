/**
 * Input System - Type Definitions
 *
 * The InputSystem owns all keyboard/pointer input routing and processing.
 * It determines WHERE input goes and HOW it's processed (focus, gestures, navigation).
 *
 * RESPONSIBILITIES:
 * - Focus stack management (grid, editor, dialogs, formula bar)
 * - Pane navigation (F6 navigation between UI panes)
 * - Gesture processing (scroll/zoom/pan physics)
 * - Keyboard coordination (shortcut routing and dispatch)
 * - Pointer capture and state tracking
 * - Input event routing to the correct systems
 *
 * ARCHITECTURE:
 * - No direct machine ownership (machines live in coordinator)
 * - Pure delegation: wraps FocusCoordination, InputCoordinator, KeyboardCoordinator
 * - Exposes actor access layer for cross-system coordination
 * - Emits scroll/zoom changes for renderer wiring
 *
 */

import type { ReadableStoreApi } from '../shared/types';

import type { paneFocusSelectors } from '../../selectors';
import type { PaneFocusAccessor, PaneFocusCommands } from '@mog-sdk/contracts/actors';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { FocusLayerType, FocusSnapshot } from '@mog-sdk/contracts/machines';
import type { Point } from '@mog-sdk/contracts/viewport';

import type { PointerCaptureManager } from '@mog-sdk/contracts/rendering';
import type { DragTerminator } from '../shared/drag-terminator';

// =============================================================================
// NARROW UI STORE INTERFACE (DAG: systems/ must not import ui-store/)
// =============================================================================

// KeyboardUIStore lives in `./shared-types` so that submodules referenced by
// this file (e.g., keyboard-coordinator) can import it without forming an
// import cycle back through `./types`.
import type { KeyboardUIStore } from './shared-types';
export type { KeyboardUIStore };

// Actor types (for useSelector hook subscriptions)
import type { FocusActor } from './coordination/focus-coordination';
import type { PaneFocusActor } from './machines/pane-focus-machine';

// Re-export from coordinator modules
import type { Metric } from '../shared/types';
import type { InputCoordinator } from './coordination/input-coordination';
import type { KeyboardCoordinator } from './keyboard/keyboard-coordinator';
import type { InputCoordinatorConfig } from './machines/input-types';

// =============================================================================
// INPUT DEPENDENCIES (for coordinator wiring)
// =============================================================================

/**
 * Dependencies needed by InputCoordinator after initialization.
 * These are React-dependent and provided by components after mount.
 */
export interface InputDependencies {
  /** Hit testing capability — classify viewport points against rendered layers */
  hitTest: import('@mog-sdk/sheet-view').ISheetViewHitTest;
  /** Viewport capability — scroll bounds */
  viewport: import('@mog-sdk/sheet-view').ISheetViewViewport;
  /** Geometry capability — position dimensions for snap-to-cell */
  geometry: import('@mog-sdk/sheet-view').ISheetViewGeometry;
  /** Commands capability — dispatch view commands (zoom, etc.) */
  commands: import('@mog-sdk/sheet-view').ISheetViewCommands;
  /** Callback to forward sheet-related events (clicks, selection, etc.) */
  forwardToSheet: (event: import('./machines/input-types').SheetInputEvent) => void;
  /** Callback to request render after scroll/zoom changes */
  requestRender?: () => void;
  /** Callback to request the next renderer frame after input-driven movement */
  requestFrame?: () => void;
  /** Get fill handle bounds in viewport coordinates */
  getFillHandleBounds?: () => { x: number; y: number; width: number; height: number } | null;
  /** Callback to update scroll position through renderer-execution (single owner pattern) */
  setScrollPosition?: (position: Point) => void;
}

// =============================================================================
// ACTOR ACCESS LAYER
// =============================================================================

/**
 * Actor access layer for input-related actors.
 * Provides read/write access to input actors for cross-system coordination.
 */
export interface InputActorAccess {
  /** Read-only accessors for extracting actor state */
  accessors: {
    /** Pane focus accessor (optional - not all contexts have it) */
    paneFocus?: PaneFocusAccessor;
  };
  /** Command interfaces for sending events to actors */
  commands: {
    /** Pane focus commands (optional - not all contexts have it) */
    paneFocus?: PaneFocusCommands;
  };
  /** Selector functions for deriving state */
  selectors: {
    /** Pane focus selectors */
    paneFocus: typeof paneFocusSelectors;
  };

  /**
   * Actor refs for useSelector hook subscriptions.
   * Use accessors/commands for programmatic reads/writes.
   * These are exposed solely for React hooks that need reactive subscriptions.
   */
  actors: {
    paneFocus: PaneFocusActor;
    focus?: FocusActor;
  };
}

// =============================================================================
// SYSTEM CONFIGURATION
// =============================================================================

/**
 * Configuration for InputSystem initialization.
 * All dependencies needed at construction time.
 */
export interface InputSystemConfig {
  /** Keyboard platform for shortcut resolution ('macos' | 'windows' | 'linux') */
  platform?: import('@mog-sdk/contracts/platform').Platform;
  /** Workbook for unified API access */
  workbook?: Workbook;
  /** Input coordinator configuration (scroll/zoom physics, gestures) */
  inputConfig?: Partial<InputCoordinatorConfig>;
  /** Enable keyboard coordinator (shortcuts and navigation) */
  enableKeyboard?: boolean;
  /** Callback to trigger UI-level actions (open find dialog, etc.) */
  onUIAction?: (action: string) => void;
  /** Dependencies for sheet switch coordination (per-sheet view state) */
  sheetSwitchDeps?: { uiStoreApi: ReadableStoreApi<KeyboardUIStore> };
  /** Callback for metrics/observability */
  onMetric?: (metric: Metric) => void;
}

// =============================================================================
// PUBLIC INTERFACE
// =============================================================================

/**
 * IInputSystem - Public interface for the Input subsystem.
 *
 * The InputSystem is responsible for ALL keyboard and pointer input routing.
 * It owns the focus stack, gesture processing, keyboard coordination, and
 * pointer state tracking.
 *
 * USAGE PATTERN:
 * ```typescript
 * // 1. Create at coordinator construction
 * this.input = new InputSystem(config);
 *
 * // 2. Wire dependencies from components
 * this.input.setInputDependencies(deps);
 *
 * // 3. Register DOM containers for focus management
 * this.input.setGridContainer(gridElement);
 * this.input.setPaneGridElement(gridElement);
 *
 * // 4. Subscribe to scroll/zoom changes for renderer
 * this.input.onScrollChange((position) => renderer.setScroll(position));
 * this.input.onZoomChange((zoom, center) => renderer.setZoom(zoom, center));
 *
 * // 5. Start the system (begins animation loops)
 * this.input.start();
 *
 * // 6. Clean up on dispose
 * this.input.dispose();
 * ```
 */
export interface IInputSystem {
  // ===========================================================================
  // FOCUS MANAGEMENT
  // ===========================================================================

  /**
   * Initialize focus coordination with an externally-provided focus actor.
   * Must be called before using focus management methods.
   */
  setFocusActor(focusActor: FocusActor): void;

  /**
   * Push a focus layer onto the stack.
   * Used when opening dialogs, context menus, command palette, etc.
   */
  pushFocusLayer(layerType: FocusLayerType, id: string): void;

  /**
   * Pop the current focus layer from the stack.
   * Automatically restores focus to the previous layer.
   */
  popFocusLayer(): void;

  /**
   * Emergency reset - close all overlays and return to grid.
   * Use sparingly, e.g., on unrecoverable errors or explicit user escape.
   */
  resetFocusToGrid(): void;

  /**
   * Check if the grid should handle keyboard events.
   * Returns false when dialogs or overlays have focus.
   */
  shouldGridHandleKeyboard(): boolean;

  /**
   * Set the grid container element for focus restoration fallback.
   */
  setGridContainer(container: HTMLElement | null): void;

  /**
   * Dispatch a synthetic contextmenu event on the grid container.
   *
   * Radix ContextMenu is uncontrolled — it only opens in response to native
   * contextmenu DOM events on its trigger. This method encapsulates the DOM
   * access so action handlers never need a raw HTMLElement reference.
   *
   * When called without arguments, positions the event inside the cells area.
   * Explicit clientX/clientY can be passed to override the default position.
   *
   * @returns true if the event was dispatched, false if no grid container is available
   */
  dispatchContextMenu(clientX?: number, clientY?: number): boolean;

  /**
   * Get a snapshot of the current focus state.
   * Used for debugging and testing.
   */
  getFocusSnapshot(): FocusSnapshot;

  /**
   * Focus the editor layer.
   * Opens the editor and captures return focus target.
   */
  focusEditor(): void;

  /**
   * Focus the grid layer.
   * Returns focus to the grid (default state).
   */
  focusGrid(): void;

  // ===========================================================================
  // PANE NAVIGATION (F6 navigation between toolbar, formula bar, grid, status bar)
  // ===========================================================================

  /**
   * Set the toolbar element for pane navigation.
   */
  setPaneToolbarElement(el: HTMLElement | null): void;

  /**
   * Set the formula bar element for pane navigation.
   */
  setPaneFormulaBarElement(el: HTMLElement | null): void;

  /**
   * Set the grid element for pane navigation.
   */
  setPaneGridElement(el: HTMLElement | null): void;

  /**
   * Set the status bar element for pane navigation.
   */
  setPaneStatusBarElement(el: HTMLElement | null): void;

  // ===========================================================================
  // INPUT COORDINATION (scroll/zoom/pan gestures)
  // ===========================================================================

  /**
   * The InputCoordinator instance.
   * Provides access to gesture handling and scroll/zoom state.
   */
  readonly inputCoordinator: InputCoordinator;

  /**
   * The KeyboardCoordinator instance.
   * Provides access to keyboard shortcut handling.
   */
  readonly keyboardCoordinator: KeyboardCoordinator;

  /**
   * Set dependencies for InputCoordinator.
   * Called by components after mount (requires React hooks).
   */
  setInputDependencies(deps: InputDependencies): void;

  // ===========================================================================
  // POINTER STATE TRACKING
  // ===========================================================================

  /**
   * Set the active pointer ID.
   * Used to track which pointer is currently interacting.
   */
  setActivePointerId(id: number): void;

  /**
   * Get the active pointer ID.
   * Returns null if no pointer is active.
   */
  getActivePointerId(): number | null;

  /**
   * Clear the active pointer ID.
   * Called on pointer-up or pointer-cancel.
   */
  clearActivePointerId(): void;

  /**
   * Set the last known mouse position.
   * Used for context menus and hover tracking.
   */
  setLastMousePosition(x: number, y: number): void;

  /**
   * Get the last known mouse position.
   * Returns null if no position has been recorded.
   */
  getLastMousePosition(): { x: number; y: number } | null;

  // ===========================================================================
  // POINTER CAPTURE MANAGEMENT
  // ===========================================================================

  /**
   * The PointerCaptureManager instance.
   * Handles pointer capture for drag operations outside the window.
   */
  readonly pointerCaptureManager: PointerCaptureManager;

  // ===========================================================================
  // SCROLL/ZOOM OUTPUT (for renderer wiring)
  // ===========================================================================

  /**
   * Subscribe to scroll position changes.
   * Returns unsubscribe function.
   */
  onScrollChange(callback: (position: Point) => void): () => void;

  /**
   * Subscribe to zoom level changes.
   * Returns unsubscribe function.
   */
  onZoomChange(callback: (zoom: number, center?: Point) => void): () => void;

  // ===========================================================================
  // ACTOR ACCESS LAYER
  // ===========================================================================

  /**
   * Actor access layer for cross-system coordination.
   * Provides accessors, commands, and selectors for input-related actors.
   */
  readonly access: InputActorAccess;

  // ===========================================================================
  // DRAG TERMINATION (for coordinator pointer-up dispatch)
  // ===========================================================================

  /**
   * Drag terminator for ending input-related drag operations.
   * Called by coordinator on pointer-up to terminate any active drags.
   */
  readonly dragTerminator: DragTerminator;

  // ===========================================================================
  // ACTION CALLBACKS (coordinator config)
  // ===========================================================================

  /**
   * Callback to trigger UI-level actions (open find dialog, etc.)
   * Configured at coordinator construction time — read-only after init.
   */
  readonly onUIAction?: (action: string) => void;

  // ===========================================================================
  // CROSS-SYSTEM COORDINATION
  // ===========================================================================

  /**
   * Subscribe to state changes.
   * Called when input state changes (scroll, zoom, focus, etc.).
   * Returns unsubscribe function.
   */
  onStateChange(callback: () => void): () => void;

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Start the input system.
   * Begins animation loops for physics updates.
   */
  start(): void;

  /**
   * Dispose the input system.
   * Cleans up all subscriptions and stops animation loops.
   */
  dispose(): void;
}

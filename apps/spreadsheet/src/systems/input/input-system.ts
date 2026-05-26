/**
 * InputSystem - Keyboard/Pointer Input Routing Coordinator.
 *
 * of Stream 1: Spreadsheet Subsystem Architecture.
 *
 * This system owns ALL keyboard and pointer input routing:
 * - Focus stack management (grid, editor, dialogs, formula bar)
 * - Pane navigation (F6 cycling between toolbar, formula bar, grid, status bar)
 * - Gesture processing (scroll/zoom/pan physics via InputCoordinator)
 * - Keyboard coordination (shortcut routing and dispatch)
 * - Pointer capture and state tracking
 * - Input event routing to the correct systems
 *
 * ARCHITECTURE:
 * - Creates InputCoordinator and KeyboardCoordinator internally
 * - Creates paneFocus actor internally, delegates pane DOM focus to PaneNavigationCoordination
 * - Delegates focus stack to FocusCoordination (which wraps the externally-provided focus actor)
 * - Owns pointer state (activePointerId, lastMousePosition)
 * - Exposes scroll/zoom change callbacks for renderer wiring
 * - Owns PointerCaptureManager for drag operations outside the window
 *
 * @module apps/spreadsheet/src/systems/input
 */

import { createActor } from 'xstate';

import { paneFocusSelectors } from '../../selectors';
import type { FocusLayerType, FocusSnapshot } from '@mog-sdk/contracts/machines';
import type { Point } from '@mog-sdk/contracts/viewport';

import type { PointerCaptureManager } from '@mog-sdk/contracts/rendering';
import type { DragTerminator } from '../shared/drag-terminator';
import {
  createPaneFocusAccessor,
  createPaneFocusCommands,
} from './actor-access/pane-focus-accessor';
import { FocusCoordination, type FocusActor } from './coordination/focus-coordination';
import {
  InputCoordinator,
  type InputCoordinatorDependencies,
} from './coordination/input-coordination';
import {
  setupPaneNavigationCoordination,
  type PaneNavigationCoordinationResult,
} from './coordination/pane-navigation-coordination';
import { createPointerCaptureManager } from './coordination/pointer-capture-coordination';
import type { Platform } from '@mog-sdk/contracts/keyboard';
import { KeyboardCoordinator } from './keyboard/keyboard-coordinator';
import { paneFocusMachine, type PaneFocusActor } from './machines/pane-focus-machine';
import type { IInputSystem, InputActorAccess, InputDependencies, InputSystemConfig } from './types';

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * InputSystem implementation.
 *
 * Creates and owns the InputCoordinator, KeyboardCoordinator, pane focus actor,
 * focus coordination, pointer capture manager, and pane navigation coordination.
 * Provides a unified interface for all input-related operations.
 *
 * @example
 * const input = new InputSystem(config);
 * input.start();
 *
 * // Wire dependencies from components
 * input.setInputDependencies(deps);
 *
 * // Register DOM containers
 * input.setGridContainer(gridElement);
 * input.setPaneGridElement(gridElement);
 *
 * // Subscribe to scroll/zoom changes
 * input.onScrollChange((pos) => renderer.setScroll(pos));
 * input.onZoomChange((zoom, center) => renderer.setZoom(zoom, center));
 *
 * // Cleanup
 * input.dispose();
 */
export class InputSystem implements IInputSystem {
  // ===========================================================================
  // Private State
  // ===========================================================================

  /** Configuration provided at construction time */
  private readonly config: InputSystemConfig;

  /** The pane focus state machine actor (owned by this system) */
  private readonly paneFocusActor: PaneFocusActor;

  /** Focus coordination (wraps externally-provided focus actor) */
  private focusCoordination: FocusCoordination | null = null;

  /** Pane navigation coordination (DOM focus for F6 pane cycling) */
  private paneNavigation: PaneNavigationCoordinationResult | null = null;

  /** Pointer state tracking */
  private activePointerId: number | null = null;
  private lastMousePos: { x: number; y: number } | null = null;

  /** Whether the system has been started */
  private started = false;

  /** Whether the system has been disposed */
  private disposed = false;

  /** State change callbacks */
  private readonly stateChangeCallbacks = new Set<() => void>();

  /** Scroll change callbacks (simplified Point interface for renderer) */
  private readonly scrollChangeCallbacks = new Set<(position: Point) => void>();

  /** Zoom change callbacks (simplified interface for renderer) */
  private readonly zoomChangeCallbacks = new Set<(zoom: number, center?: Point) => void>();

  /** Cleanup functions for subscriptions */
  private readonly cleanupFns: Array<() => void> = [];

  // ===========================================================================
  // Public Coordinators (exposed as readonly per interface)
  // ===========================================================================

  /** The InputCoordinator instance (scroll/zoom/pan gestures) */
  readonly inputCoordinator: InputCoordinator;

  /** The KeyboardCoordinator instance (shortcut handling) */
  readonly keyboardCoordinator: KeyboardCoordinator;

  /** The PointerCaptureManager instance (drag capture outside window) */
  readonly pointerCaptureManager: PointerCaptureManager;

  // ===========================================================================
  // Actor Access Layer
  // ===========================================================================

  /** Actor access layer for cross-system coordination */
  readonly access: InputActorAccess;

  // ===========================================================================
  // Action Callbacks (from coordinator config)
  // ===========================================================================

  /** Callback to trigger UI-level actions (open find dialog, etc.) */
  readonly onUIAction?: (action: string) => void;

  // ===========================================================================
  // DragTerminator
  // ===========================================================================

  /**
   * DragTerminator for input-related drag operations.
   *
   * The InputCoordinator manages panning gestures (middle-click pan,
   * space+drag pan, touch pan). When a pointer-up occurs during panning,
   * the coordinator's handlePointerUp already handles momentum/cleanup.
   * This terminator is a no-op since InputCoordinator handles its own
   * pointer-up lifecycle internally.
   */
  readonly dragTerminator: DragTerminator = {
    endDrag: () => {
      // InputCoordinator handles its own pointer-up in handlePointerUp().
      // The input machine transitions are driven by the coordinator's event
      // handlers, not by external drag termination.
    },
    cancelDrag: () => {
      // Interrupt any active gesture (pan, momentum, etc.)
      this.inputCoordinator.interrupt();
    },
  };

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(config: InputSystemConfig) {
    this.config = config;

    // Expose action callbacks from config (M9: route through coordinator, not prop-drilling)
    this.onUIAction = config.onUIAction;

    // Create InputCoordinator (owns input machine, physics engines)
    this.inputCoordinator = new InputCoordinator(config.inputConfig);

    // Create KeyboardCoordinator (shortcut routing)
    const kbPlatform: Platform = config.platform ?? 'windows';
    this.keyboardCoordinator =
      config.enableKeyboard !== false
        ? new KeyboardCoordinator(kbPlatform)
        : new KeyboardCoordinator(kbPlatform); // Always create, but dependencies may not be set

    // Create PointerCaptureManager
    this.pointerCaptureManager = createPointerCaptureManager();

    // Create pane focus actor (owned by this system)
    this.paneFocusActor = createActor(paneFocusMachine);

    // Build actor access layer from the pane focus actor
    const paneFocusAccessor = createPaneFocusAccessor(this.paneFocusActor);
    const paneFocusCommands = createPaneFocusCommands(this.paneFocusActor);

    this.access = {
      accessors: { paneFocus: paneFocusAccessor },
      commands: { paneFocus: paneFocusCommands },
      selectors: { paneFocus: paneFocusSelectors },
      actors: { paneFocus: this.paneFocusActor },
    };
  }

  // ===========================================================================
  // Focus Management (delegates to FocusCoordination)
  // ===========================================================================

  /**
   * Initialize focus coordination with an externally-provided focus actor.
   * Must be called before using focus management methods.
   *
   * The focus actor is created by the ActorManager (not by InputSystem)
   * because it's shared across systems. InputSystem wraps it with
   * FocusCoordination for DOM side effects.
   */
  setFocusActor(focusActor: FocusActor): void {
    this.access.actors.focus = focusActor;
    this.focusCoordination = new FocusCoordination(focusActor, {
      onDialogOpenedDuringEdit: this.config.onUIAction
        ? (dialogId: string) => this.config.onUIAction?.(`dialog-opened:${dialogId}`)
        : undefined,
      onDialogClosedDuringEdit: this.config.onUIAction
        ? () => this.config.onUIAction?.('dialog-closed')
        : undefined,
    });

    // Subscribe to focus state changes for stateChange notifications
    const sub = focusActor.subscribe(() => {
      this.notifyStateChange();
    });
    this.cleanupFns.push(() => sub.unsubscribe());
  }

  pushFocusLayer(layerType: FocusLayerType, id: string): void {
    this.focusCoordination?.pushFocusLayer(layerType, id);
  }

  popFocusLayer(): void {
    this.focusCoordination?.popFocusLayer();
  }

  resetFocusToGrid(): void {
    this.focusCoordination?.resetToGrid();
  }

  shouldGridHandleKeyboard(): boolean {
    return this.focusCoordination?.shouldGridHandleKeyboard() ?? true;
  }

  setGridContainer(container: HTMLElement | null): void {
    this.focusCoordination?.setGridContainer(container);
  }

  dispatchContextMenu(clientX?: number, clientY?: number): boolean {
    return this.focusCoordination?.dispatchContextMenu(clientX, clientY) ?? false;
  }

  getFocusSnapshot(): FocusSnapshot {
    if (this.focusCoordination) {
      return this.focusCoordination.getSnapshot();
    }
    // Return a sensible default when focus coordination isn't initialized
    const defaultLayer = { type: 'grid' as const, id: 'grid', returnFocusTarget: null };
    return {
      state: 'grid' as const,
      currentLayer: defaultLayer,
      stack: [defaultLayer],
      shouldGridHandle: true,
      isInOverlay: false,
    };
  }

  focusEditor(): void {
    // Focus editor requires a cellId; delegate with a default
    // The actual cellId is typically set by the editor system
    this.focusCoordination?.focusEditor('');
  }

  focusGrid(): void {
    this.focusCoordination?.focusGrid();
  }

  // ===========================================================================
  // Pane Navigation (F6 cycling between toolbar, formula bar, grid, status bar)
  // ===========================================================================

  /**
   * Initialize pane navigation.
   * Called after the pane focus actor is started.
   */
  private initPaneNavigation(): void {
    this.paneNavigation = setupPaneNavigationCoordination({
      paneFocusActor: this.paneFocusActor,
      onPaneFocusChanged: () => {
        this.notifyStateChange();
      },
    });
  }

  setPaneToolbarElement(el: HTMLElement | null): void {
    this.paneNavigation?.setToolbarElement(el);
  }

  setPaneFormulaBarElement(el: HTMLElement | null): void {
    this.paneNavigation?.setFormulaBarElement(el);
  }

  setPaneGridElement(el: HTMLElement | null): void {
    this.paneNavigation?.setGridElement(el);
  }

  setPaneStatusBarElement(el: HTMLElement | null): void {
    this.paneNavigation?.setStatusBarElement(el);
  }

  // ===========================================================================
  // Input Coordination (scroll/zoom/pan gestures)
  // ===========================================================================

  setInputDependencies(deps: InputDependencies): void {
    this.inputCoordinator.setDependencies(deps as InputCoordinatorDependencies);
  }

  // ===========================================================================
  // Pointer State Tracking
  // ===========================================================================

  setActivePointerId(id: number): void {
    this.activePointerId = id;
  }

  getActivePointerId(): number | null {
    return this.activePointerId;
  }

  clearActivePointerId(): void {
    this.activePointerId = null;
  }

  setLastMousePosition(x: number, y: number): void {
    this.lastMousePos = { x, y };
  }

  getLastMousePosition(): { x: number; y: number } | null {
    return this.lastMousePos;
  }

  // ===========================================================================
  // Scroll/Zoom Output (for renderer wiring)
  // ===========================================================================

  onScrollChange(callback: (position: Point) => void): () => void {
    this.scrollChangeCallbacks.add(callback);

    // Wire to InputCoordinator's scroll callbacks (translating ScrollState -> Point)
    const unsubCoordinator = this.inputCoordinator.onScrollChange((scrollState) => {
      callback({ x: scrollState.x, y: scrollState.y });
    });

    return () => {
      this.scrollChangeCallbacks.delete(callback);
      unsubCoordinator();
    };
  }

  onZoomChange(callback: (zoom: number, center?: Point) => void): () => void {
    this.zoomChangeCallbacks.add(callback);

    // Wire to InputCoordinator's zoom callbacks (translating ZoomState -> simplified args)
    const unsubCoordinator = this.inputCoordinator.onZoomChange((zoomState) => {
      callback(zoomState.level, { x: zoomState.centerX, y: zoomState.centerY });
    });

    return () => {
      this.zoomChangeCallbacks.delete(callback);
      unsubCoordinator();
    };
  }

  // ===========================================================================
  // Cross-System Coordination
  // ===========================================================================

  onStateChange(callback: () => void): () => void {
    this.stateChangeCallbacks.add(callback);

    // Also wire to InputCoordinator state changes
    const unsubCoordinator = this.inputCoordinator.onStateChange(callback);

    return () => {
      this.stateChangeCallbacks.delete(callback);
      unsubCoordinator();
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    if (this.started || this.disposed) return;

    // Start the pane focus actor
    this.paneFocusActor.start();

    // Initialize pane navigation coordination (subscribes to pane focus actor)
    this.initPaneNavigation();

    // Subscribe to pane focus actor state changes
    const paneSub = this.paneFocusActor.subscribe(() => {
      this.notifyStateChange();
    });
    this.cleanupFns.push(() => paneSub.unsubscribe());

    this.started = true;
  }

  dispose(): void {
    if (this.disposed) return;

    // Dispose pane navigation coordination
    this.paneNavigation?.dispose();
    this.paneNavigation = null;

    // Dispose focus coordination
    this.focusCoordination?.dispose();
    this.focusCoordination = null;

    // Run all cleanup functions (subscriptions)
    for (const fn of this.cleanupFns) {
      fn();
    }
    this.cleanupFns.length = 0;

    // Stop the pane focus actor
    if (this.started) {
      this.paneFocusActor.stop();
    }

    // Dispose InputCoordinator (stops animation loops, cleans up actor)
    this.inputCoordinator.dispose();

    // Clear all callbacks
    this.stateChangeCallbacks.clear();
    this.scrollChangeCallbacks.clear();
    this.zoomChangeCallbacks.clear();

    // Clear pointer state
    this.activePointerId = null;
    this.lastMousePos = null;

    this.disposed = true;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /** Notify all state change subscribers */
  private notifyStateChange(): void {
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[InputSystem] State change callback error:', error);
      }
    }
  }
}

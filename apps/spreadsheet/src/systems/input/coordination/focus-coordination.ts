/**
 * Focus Coordination
 *
 * Handles all DOM operations for focus management.
 * The focus machine is pure (no DOM access), so all DOM operations
 * are executed here by the coordinator.
 *
 * Responsibilities:
 * - Captures returnFocusTarget before PUSH_LAYER
 * - Restores focus on POP_LAYER (using stored CSS selector)
 * - Notifies editor when dialogs open/close during editing
 * - Provides public API for components to push/pop focus layers
 *
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md for architecture details
 */

import { getFocusSnapshot, type FocusActor as FocusMachineActor } from '@mog/shell';
import type { FocusLayer, FocusLayerType, FocusSnapshot } from '@mog-sdk/contracts/machines';
import type { Subscription } from 'xstate';

// =============================================================================
// TYPES
// =============================================================================

export type FocusActor = FocusMachineActor;

/**
 * Options for FocusCoordination.
 */
export interface FocusCoordinationOptions {
  /** Called when focus machine wants to notify editor of dialog open */
  onDialogOpenedDuringEdit?: (dialogId: string) => void;
  /** Called when focus machine wants to notify editor of dialog close */
  onDialogClosedDuringEdit?: () => void;
}

// =============================================================================
// FOCUS COORDINATION CLASS
// =============================================================================

/**
 * Coordinates focus state with DOM operations.
 *
 * The focus machine is pure - it only tracks state.
 * This class subscribes to the machine and executes DOM side effects:
 * - Capturing focus before pushing a layer
 * - Restoring focus when popping a layer
 * - Notifying editor of dialog state changes
 */
export class FocusCoordination {
  private focusActor: FocusActor;
  private gridContainer: HTMLElement | null = null;
  private options: FocusCoordinationOptions;
  private previousStack: FocusLayer[] = [];
  private subscriptions: Subscription[] = [];
  private containerRegistrationCallbacks: Array<() => void> = [];

  constructor(focusActor: FocusActor, options: FocusCoordinationOptions = {}) {
    this.focusActor = focusActor;
    this.options = options;

    // Initialize previous stack from current state
    this.previousStack = [...focusActor.getSnapshot().context.stack];

    this.setupFocusRestoration();
    this.setupEditorNotifications();
  }

  // ===========================================================================
  // PUBLIC API FOR COORDINATOR
  // ===========================================================================

  /**
   * Set the grid container element for focus restoration fallback.
   * Notifies any registered callbacks when a container is registered.
   */
  setGridContainer(container: HTMLElement | null): void {
    this.gridContainer = container;

    // Notify listeners when container is registered
    if (container) {
      this.containerRegistrationCallbacks.forEach((cb) => cb());
      this.containerRegistrationCallbacks = []; // One-shot callbacks
    }
  }

  /**
   * Register a callback to be called when the grid container is registered.
   * If the container is already registered, the callback is called immediately.
   *
   * @param callback - Function to call when container is registered
   * @returns Unsubscribe function to remove the callback
   */
  onGridContainerRegistered(callback: () => void): () => void {
    // If already registered, call immediately
    if (this.gridContainer) {
      callback();
      return () => {};
    }

    // Otherwise, queue for later
    this.containerRegistrationCallbacks.push(callback);
    return () => {
      const idx = this.containerRegistrationCallbacks.indexOf(callback);
      if (idx >= 0) this.containerRegistrationCallbacks.splice(idx, 1);
    };
  }

  /**
   * Push a focus layer onto the stack.
   * Automatically captures the current focus target for restoration.
   *
   * @param layerType - Type of focus layer
   * @param id - Unique identifier for this layer instance
   */
  pushFocusLayer(layerType: FocusLayerType, id: string): void {
    const returnFocusTarget = this.captureReturnFocusTarget();
    this.focusActor.send({
      type: 'PUSH_LAYER',
      layerType,
      id,
      returnFocusTarget,
    });
  }

  /**
   * Pop the current focus layer from the stack.
   * Focus restoration is handled automatically via subscription.
   */
  popFocusLayer(): void {
    this.focusActor.send({ type: 'POP_LAYER' });
  }

  /**
   * Emergency reset - close all overlays and return to grid.
   * Use sparingly, e.g., on unrecoverable errors or explicit user escape.
   */
  resetToGrid(): void {
    this.focusActor.send({ type: 'RESET_TO_GRID' });
  }

  /**
   * Focus the editor layer.
   * Automatically captures the current focus target for restoration.
   *
   * @param cellId - Cell identifier in "row-col" format
   */
  focusEditor(cellId: string): void {
    const returnFocusTarget = this.captureReturnFocusTarget();
    this.focusActor.send({
      type: 'FOCUS_EDITOR',
      cellId,
      returnFocusTarget,
    });
  }

  /**
   * Return focus to the grid.
   *
   * Sends `FOCUS_GRID` to the focus actor AND drives DOM focus back to the
   * grid container element. Both halves are necessary:
   *
   * - The state-machine event makes `shouldGridHandle` truthy and resets
   * the focus stack to the base layer (so the next keystroke is routed
   * to the grid handler logically).
   * - The DOM focus call makes the grid container the literal
   * `document.activeElement` so React `onKeyDown` on the grid div
   * actually receives the next printable keystroke.
   *
   * The subscriber in `setupFocusRestoration` covers two adjacent
   * concerns — POP_LAYER's `returnFocusTarget` restoration and the
   * stack-shrink-from-N-to-1 case — but it intentionally does NOT fire
   * when a chrome input (Name Box, formula bar, sheet-tab edit) hits
   * `focusGrid()` while the focus stack is already at length 1. In that
   * scenario `previousStack.length === 1`, so the stack-shrink branch
   * is skipped, the chrome input blurs, and the browser default is to
   * leave focus on `<body>`. Subsequent printable keystrokes never reach
   * the grid div, the type-to-edit fallback in `use-grid-keyboard.ts`
   * never opens the inline editor, and `Enter` then triggers
   * `ENTER_NAVIGATE` on a still-empty cell.
   *
   * The `requestAnimationFrame` mirrors the pop-restore path's pattern:
   * it lets React unmount the chrome input before we grab focus, so we
   * don't fight the browser's own focus restoration.
   *
   * Documented contract: a navigator (Name Box, formula bar, etc.) owns
   * the focus contract — it both moves the selection AND returns DOM
   * focus to the destination. See `NameBoxDropdown.tsx` lines 625-630.
   */
  focusGrid(): void {
    this.focusActor.send({ type: 'FOCUS_GRID' });
    requestAnimationFrame(() => {
      // If a newer non-grid focus layer was pushed between `focusGrid()` being
      // called and this rAF firing, that layer's owner owns the focus contract.
      // Skip the DOM focus steal — otherwise the stale rAF can steal DOM focus
      // from a just-mounted input on its first frame. This covers sheet-tab
      // rename inputs and double-click cell editing, where pointer-down queues
      // grid focus before the editor layer is mounted and focused.
      //
      // This is the layer-aware version of the stop-gap added in 017f0b73e
      // (which checked `instanceof HTMLInputElement` — too broad, at the
      // wrong abstraction level). The layer-stack check speaks the same
      // language as the rest of the focus state machine.
      const stack = this.focusActor.getSnapshot().context.stack;
      const top = stack[stack.length - 1];
      if (top && top.type !== 'grid') {
        return;
      }
      this.focusGridContainer();
    });
  }

  /**
   * Check if the grid should handle keyboard events.
   * Returns true only when in the 'grid' state.
   */
  shouldGridHandleKeyboard(): boolean {
    return this.focusActor.getSnapshot().matches('grid');
  }

  /**
   * Get the current focus state name.
   */
  getCurrentState(): string {
    return this.focusActor.getSnapshot().value as string;
  }

  /**
   * Get the current (top) focus layer.
   */
  getCurrentLayer(): FocusLayer {
    const stack = this.focusActor.getSnapshot().context.stack;
    return stack[stack.length - 1];
  }

  /**
   * Get a readonly copy of the focus stack.
   */
  getStack(): readonly FocusLayer[] {
    return this.focusActor.getSnapshot().context.stack;
  }

  /**
   * Get a normalized snapshot of the focus state.
   */
  getSnapshot(): FocusSnapshot {
    return getFocusSnapshot(this.focusActor.getSnapshot());
  }

  /**
   * Check if focus is in an overlay (not grid or editor).
   */
  isInOverlay(): boolean {
    const state = this.focusActor.getSnapshot();
    return !state.matches('grid') && !state.matches('editor');
  }

  /**
   * Directly focus the grid container DOM element.
   * Use this for initial focus establishment when the grid becomes ready.
   * For normal focus transitions, use focusGrid() instead.
   */
  focusGridContainerElement(): void {
    this.focusGridContainer();
  }

  /**
   * Dispatch a synthetic contextmenu event on the grid container.
   *
   * Radix ContextMenu is uncontrolled — it only opens in response to native
   * contextmenu DOM events on its trigger. This method encapsulates the DOM
   * access so action handlers never need a raw HTMLElement reference.
   *
   * When called without arguments, positions the event inside the cells area
   * (offset past row/column headers). Explicit clientX/clientY can be passed
   * to override the default position.
   *
   * @returns true if the event was dispatched, false if no grid container is available
   */
  dispatchContextMenu(clientX?: number, clientY?: number): boolean {
    if (!this.gridContainer || !document.contains(this.gridContainer)) {
      return false;
    }

    let x = clientX;
    let y = clientY;
    if (x === undefined || y === undefined) {
      const rect = this.gridContainer.getBoundingClientRect();
      // Position inside the cells area (past row/column headers)
      x = rect.left + 60;
      y = rect.top + 40;
    }

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 2,
    });
    this.gridContainer.dispatchEvent(event);
    return true;
  }

  /**
   * Clean up subscriptions.
   */
  dispose(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  // ===========================================================================
  // PRIVATE: DOM OPERATIONS
  // ===========================================================================

  /**
   * Capture current focus target before pushing a layer.
   * All DOM access for focus capture happens here.
   *
   * @returns CSS selector for the focused element, or null if none
   */
  private captureReturnFocusTarget(): string | null {
    const active = document.activeElement;
    if (!active || active === document.body) return null;

    // Prefer ID selector (most reliable)
    if (active.id) return `#${active.id}`;

    // Fall back to data attribute (for dynamically generated elements)
    const dataFocusId = active.getAttribute('data-focus-id');
    if (dataFocusId) return `[data-focus-id="${dataFocusId}"]`;

    // Last resort: check for data-focus-trap to at least return to the dialog
    const focusTrap = active.closest('[data-focus-trap]');
    if (focusTrap) {
      const trapId = focusTrap.getAttribute('data-focus-trap');
      if (trapId) return `[data-focus-trap="${trapId}"]`;
    }

    // Cannot identify element - will fall back to grid
    return null;
  }

  /**
   * Restore focus to a previously captured target.
   * All DOM access for focus restoration happens here.
   *
   * @param target - CSS selector for the target element
   */
  private restoreFocus(target: string | null): void {
    if (!target) {
      // Default to grid container
      this.focusGridContainer();
      return;
    }

    const element = document.querySelector<HTMLElement>(target);
    if (element && document.contains(element)) {
      element.focus();
    } else {
      // Fallback to grid if target no longer exists or was removed
      console.debug('[FocusCoordination] Target not found, falling back to grid:', target);
      this.focusGridContainer();
    }
  }

  /**
   * Focus the grid container element.
   */
  private focusGridContainer(): void {
    if (this.gridContainer && document.contains(this.gridContainer)) {
      this.gridContainer.focus();
    }
  }

  // ===========================================================================
  // PRIVATE: SUBSCRIPTIONS
  // ===========================================================================

  /**
   * Subscribe to focus state changes and execute DOM side effects.
   */
  private setupFocusRestoration(): void {
    const subscription = this.focusActor.subscribe((state) => {
      const currentStack = state.context.stack;

      // Detect POP_LAYER: stack got shorter
      if (currentStack.length < this.previousStack.length) {
        const poppedLayer = this.previousStack[this.previousStack.length - 1];
        // Delay to allow DOM to update after dialog unmounts
        requestAnimationFrame(() => {
          this.restoreFocus(poppedLayer.returnFocusTarget);
        });
      }

      // Focus grid when returning to grid state with only base layer
      if (state.matches('grid') && currentStack.length === 1 && this.previousStack.length > 1) {
        requestAnimationFrame(() => {
          this.focusGridContainer();
        });
      }

      this.previousStack = [...currentStack];
    });

    this.subscriptions.push(subscription);
  }

  /**
   * Notify editor machine when dialogs open/close during editing.
   * This enables bidirectional coordination.
   */
  private setupEditorNotifications(): void {
    let wasInEditor = false;
    let previousStackLength = this.previousStack.length;

    const subscription = this.focusActor.subscribe((state) => {
      const currentStack = state.context.stack;
      const isCurrentlyInEditor = currentStack.some((l) => l.type === 'editor');
      const isInOverlay =
        state.matches('dialog') ||
        state.matches('formulaPicker') ||
        state.matches('commandPalette');

      // Detect: was editing, now in overlay (stack grew)
      if (wasInEditor && isInOverlay && currentStack.length > previousStackLength) {
        const newLayer = currentStack[currentStack.length - 1];
        this.options.onDialogOpenedDuringEdit?.(newLayer.id);
      }

      // Detect: was in overlay during edit, now back to editor (stack shrunk)
      if (
        isCurrentlyInEditor &&
        state.matches('editor') &&
        previousStackLength > currentStack.length
      ) {
        this.options.onDialogClosedDuringEdit?.();
      }

      wasInEditor = isCurrentlyInEditor && state.matches('editor');
      previousStackLength = currentStack.length;
    });

    this.subscriptions.push(subscription);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a FocusCoordination instance.
 */
export function createFocusCoordination(
  focusActor: FocusActor,
  options?: FocusCoordinationOptions,
): FocusCoordination {
  return new FocusCoordination(focusActor, options);
}

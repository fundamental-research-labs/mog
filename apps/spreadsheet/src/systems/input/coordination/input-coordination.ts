/**
 * Input Coordinator
 *
 * Central coordinator for all input handling - scrolling, panning, zooming, touch gestures.
 * Follows the coordinator pattern: owns XState actor and physics engines, executes side effects.
 *
 * Responsibilities:
 * - Creates and owns the input XState actor
 * - Owns physics engines (ScrollPhysics, ZoomPhysics)
 * - Manages its own animation frame loop for physics updates
 * - Hit testing: determines what was clicked
 * - Event routing: sends events to appropriate systems
 * - Provides public API for React hooks
 *
 * @see ARCHITECTURE.md - Coordinator Pattern
 */

import type {
  ISheetViewCommands,
  ISheetViewGeometry,
  ISheetViewHitTest,
  ISheetViewViewport,
  SheetHitResult,
} from '@mog-sdk/sheet-view';
import type { Point } from '@mog-sdk/contracts/viewport';
import type { ViewportPositionIndexLike } from '@mog-sdk/contracts/rendering';
import { createActor } from 'xstate';
import { getScrollLineHeight } from '../../../infra/utils/system-preferences';
import {
  getInputSnapshot,
  inputMachine,
  type InputActor as InputMachineActor,
  type InputState,
} from '../machines/grid-input-machine';
import {
  DEFAULT_INPUT_CONFIG,
  type HitTestResult,
  type InputCoordinatorConfig,
  type InputMachineState,
  type ScrollChangeCallback,
  type ScrollState,
  type SheetInputEvent,
  type ZoomChangeCallback,
  type ZoomState,
} from '../machines/input-types';
import { ScrollPhysics } from '../physics/scroll-physics';
import { ZoomPhysics } from '../physics/zoom-physics';

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type InputActor = InputMachineActor;

// =============================================================================
// DEPENDENCIES
// =============================================================================

/**
 * Dependencies needed by InputCoordinator.
 * Provided by the component after mount since they may require React hooks.
 */
export interface InputCoordinatorDependencies {
  /** Hit testing capability — classify viewport points against rendered layers */
  hitTest: ISheetViewHitTest;
  /** Viewport capability — scroll bounds */
  viewport: ISheetViewViewport;
  /** Geometry capability — position dimensions for snap-to-cell */
  geometry: ISheetViewGeometry;
  /** Commands capability — dispatch view commands (zoom, etc.) */
  commands: ISheetViewCommands;
  /** Callback to forward sheet-related events (clicks, selection, etc.) */
  forwardToSheet: (event: SheetInputEvent) => void;
  /** Callback to request render after scroll/zoom changes */
  requestRender?: () => void;
  /** Callback to request a frame after scroll has already dirtied the right layers */
  requestFrame?: () => void;
  /** Get fill handle bounds in viewport coordinates */
  getFillHandleBounds?: () => { x: number; y: number; width: number; height: number } | null;
  /** Callback to update scroll position through renderer-execution (single owner pattern) */
  setScrollPosition?: (position: Point) => void;
}

// =============================================================================
// INPUT COORDINATOR CLASS
// =============================================================================

/**
 * InputCoordinator - Central coordinator for input handling.
 *
 * Usage:
 * ```typescript
 * const inputCoordinator = new InputCoordinator();
 *
 * // Set dependencies when available
 * inputCoordinator.setDependencies({
 * hitTest: sheetView.hitTest,
 * viewport: sheetView.viewport,
 * geometry: sheetView.geometry,
 * commands: sheetView.commands,
 * forwardToSheet: (event) => sheetCoordinator.handleInput(event),
 * });
 *
 * // Attach event handlers
 * element.addEventListener('wheel', inputCoordinator.handleWheel);
 *
 * // Clean up
 * inputCoordinator.dispose();
 * ```
 */
export class InputCoordinator {
  // XState actor
  private inputActor: InputActor;

  // Physics engines
  private scrollPhysics: ScrollPhysics;
  private zoomPhysics: ZoomPhysics;

  // Configuration
  private config: InputCoordinatorConfig;

  // Dependencies (injected)
  private hitTestCapability: ISheetViewHitTest | null = null;
  private viewport: ISheetViewViewport | null = null;
  private geometry: ISheetViewGeometry | null = null;
  private commands: ISheetViewCommands | null = null;
  private forwardToSheet: ((event: SheetInputEvent) => void) | null = null;
  private requestRender: (() => void) | null = null;
  private requestFrame: (() => void) | null = null;
  private getFillHandleBounds:
    | (() => { x: number; y: number; width: number; height: number } | null)
    | null = null;
  private setScrollPosition: ((position: Point) => void) | null = null;

  // Animation frame loop
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private isAnimating: boolean = false;

  // Track momentum scroll vs programmatic animateTo for snap-to-cell logic
  // Cell snapping should only happen after momentum scroll, not animateTo
  private isMomentumScroll: boolean = false;

  // Keyboard state
  private isSpaceHeld: boolean = false;

  // Wheel gesture detection (for momentum)
  private lastWheelTime: number = 0;
  private wheelVelocityX: number = 0;
  private wheelVelocityY: number = 0;
  private wheelEndTimeout: ReturnType<typeof setTimeout> | null = null;

  // Input source discrimination: trackpad vs discrete mouse wheel.
  // macOS trackpad already sends inertial events — adding app momentum on top
  // causes double-momentum (floaty overshoot). We only apply app momentum for
  // discrete mouse wheel input where the OS provides no inertia.
  private isTrackpadInput: boolean = false;

  // Cached line height from system preferences for scroll normalization
  private systemLineHeight: number = getScrollLineHeight();

  // Pan velocity tracking
  private panHistory: Array<{ x: number; y: number; time: number }> = [];

  // Subscriptions
  private scrollCallbacks: Set<ScrollChangeCallback> = new Set();
  private zoomCallbacks: Set<ZoomChangeCallback> = new Set();
  private stateCallbacks: Set<() => void> = new Set();

  // Cleanup
  private cleanupFns: (() => void)[] = [];
  private isDisposed: boolean = false;

  constructor(config: Partial<InputCoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_INPUT_CONFIG, ...config };

    // Create physics engines
    this.scrollPhysics = new ScrollPhysics({
      decelerationRate: this.config.decelerationRate,
      minVelocity: this.config.minVelocity,
      maxVelocity: this.config.maxVelocity,
    });

    this.zoomPhysics = new ZoomPhysics({
      minZoom: this.config.minZoom,
      maxZoom: this.config.maxZoom,
      animationDuration: 200,
    });

    // Create and start input machine
    this.inputActor = createActor(inputMachine);
    this.inputActor.start();

    // Subscribe to machine state changes
    const subscription = this.inputActor.subscribe((state) => {
      this.onMachineStateChange(state);
    });
    this.cleanupFns.push(() => subscription.unsubscribe());
  }

  // ===========================================================================
  // DEPENDENCY INJECTION
  // ===========================================================================

  /**
   * Set dependencies after construction.
   * Call this when React hooks provide the necessary values.
   */
  setDependencies(deps: InputCoordinatorDependencies): void {
    this.assertNotDisposed();

    this.hitTestCapability = deps.hitTest;
    this.viewport = deps.viewport;
    this.geometry = deps.geometry;
    this.commands = deps.commands;
    this.forwardToSheet = deps.forwardToSheet;
    this.requestRender = deps.requestRender ?? null;
    this.requestFrame = deps.requestFrame ?? null;
    this.getFillHandleBounds = deps.getFillHandleBounds ?? null;
    this.setScrollPosition = deps.setScrollPosition ?? null;

    // NOTE: We intentionally do NOT call updateScrollBounds() here.
    // The React layer (ScrollContainer) is the sole authority on scroll bounds
    // via setContentScrollBounds(), which uses continuous expansion logic.
    // Calling updateScrollBounds() here would set bounds to the full 1M-row
    // coordinate system range, creating a race condition with the React layer.
  }

  /**
   * Update scroll bounds from coordinate system.
   * Call this when viewport size or content size changes.
   *
   * NOTE: Prefer setContentScrollBounds() from the React layer to keep
   * physics bounds aligned with the scrollbar UI (useScrollDimensions).
   * This method uses getScrollBounds() which scales to full sheet size (1M rows).
   */
  updateScrollBounds(): void {
    if (!this.viewport) return;

    const bounds = this.viewport.getScrollBounds();
    this.scrollPhysics.setBounds(0, bounds.maxScrollX, 0, bounds.maxScrollY);
  }

  /**
   * Set scroll bounds from content dimensions (used-range based).
   *
   * Called from the React layer with the same dimensions used by ScrollContainer,
   * ensuring the physics engine and scrollbar UI agree on scroll range.
   *
   * @param maxScrollX - Maximum horizontal scroll (contentWidth - viewportWidth)
   * @param maxScrollY - Maximum vertical scroll (contentHeight - viewportHeight)
   */
  setContentScrollBounds(maxScrollX: number, maxScrollY: number): void {
    const before = this.scrollPhysics.position;
    this.scrollPhysics.setBounds(0, Math.max(0, maxScrollX), 0, Math.max(0, maxScrollY));
    const after = this.scrollPhysics.position;
    if (before.x !== after.x || before.y !== after.y) {
      this.applyScrollPosition();
      this.notifyScrollCallbacks();
      this.requestScrollFrame();
    }
  }

  // ===========================================================================
  // EVENT HANDLERS (called from React component)
  // ===========================================================================

  /**
   * Handle wheel events (trackpad scroll, mouse wheel, Ctrl+wheel zoom).
   */
  handleWheel = (event: WheelEvent): void => {
    this.assertNotDisposed();
    event.preventDefault();

    // Zoom gesture: Ctrl/Cmd + wheel OR trackpad pinch (ctrlKey is true for pinch)
    if (event.ctrlKey || event.metaKey) {
      const delta = -event.deltaY * this.config.zoomSensitivity;
      this.inputActor.send({
        type: 'ZOOM',
        delta,
        centerX: event.clientX,
        centerY: event.clientY,
      });

      // Apply zoom immediately to physics
      this.zoomPhysics.applyZoom(delta, event.clientX, event.clientY);
      this.applyZoomToCoordinateSystem();
      this.notifyZoomCallbacks();
      this.requestRender?.();

      // Clear zoom after a delay
      this.scheduleZoomEnd();
      return;
    }

    // Scroll gesture — detect input source BEFORE normalization (raw event data)
    this.isTrackpadInput = this.detectTrackpadInput(event);

    const { deltaX, deltaY } = this.normalizeDelta(event);

    // Apply scroll immediately to physics
    this.scrollPhysics.applyDelta(deltaX, deltaY);
    this.applyScrollPosition();
    this.notifyScrollCallbacks();
    this.requestScrollFrame();

    // Track velocity for momentum (only useful for discrete wheel, but track anyway)
    const now = performance.now();
    const dt = now - this.lastWheelTime;
    if (dt > 0 && dt < 100) {
      // Exponential moving average
      this.wheelVelocityX = 0.8 * this.wheelVelocityX + 0.2 * ((deltaX / dt) * 1000);
      this.wheelVelocityY = 0.8 * this.wheelVelocityY + 0.2 * ((deltaY / dt) * 1000);
    } else {
      this.wheelVelocityX = (deltaX / 16) * 1000; // Assume 16ms frame
      this.wheelVelocityY = (deltaY / 16) * 1000;
    }
    this.lastWheelTime = now;

    this.inputActor.send({ type: 'WHEEL', deltaX, deltaY });

    // Detect scroll end for momentum
    if (this.wheelEndTimeout) {
      clearTimeout(this.wheelEndTimeout);
    }
    this.wheelEndTimeout = setTimeout(() => {
      // Only trigger app momentum for discrete wheel input.
      // Trackpad already provides OS-level inertia — adding app momentum
      // on top causes double-momentum (floaty overshoot).
      if (this.config.momentumEnabled && !this.isTrackpadInput) {
        this.inputActor.send({ type: 'SCROLL_END' });
      }
      this.wheelVelocityX = 0;
      this.wheelVelocityY = 0;
    }, 150);
  };

  /**
   * Handle touch start events.
   */
  handleTouchStart = (event: TouchEvent): void => {
    this.assertNotDisposed();

    // Don't prevent default here - may interfere with other interactions
    const touches = this.extractTouches(event.touches);

    // Stop any running momentum
    this.stopAllAnimations();

    this.inputActor.send({ type: 'TOUCH_START', touches });
  };

  /**
   * Handle touch move events.
   */
  handleTouchMove = (event: TouchEvent): void => {
    this.assertNotDisposed();
    event.preventDefault(); // Prevent page scroll

    const touches = this.extractTouches(event.touches);
    const state = this.inputActor.getSnapshot();

    // Handle touch-based scrolling manually for immediate response
    if (state.matches('panning') && touches.length === 1 && this.config.touchPanEnabled) {
      const prevContext = state.context;
      const touch = touches[0];
      const deltaX = prevContext.panStartX - touch.x;
      const deltaY = prevContext.panStartY - touch.y;

      this.scrollPhysics.applyDelta(deltaX, deltaY);
      this.applyScrollPosition();
      this.notifyScrollCallbacks();

      // Track velocity
      this.trackPanVelocity(touch.x, touch.y);
    }

    // Handle pinch zoom
    if (state.matches('pinching') && touches.length === 2 && this.config.pinchZoomEnabled) {
      const prevContext = state.context;
      const [touch1, touch2] = touches;
      const newDistance = this.getTouchDistance(touch1, touch2);

      if (prevContext.initialPinchDistance > 0) {
        const scale = newDistance / prevContext.initialPinchDistance;
        const delta = scale - 1; // Convert to delta
        const center = this.getTouchCenter(touch1, touch2);

        this.zoomPhysics.applyZoom(delta, center.x, center.y);
        this.applyZoomToCoordinateSystem();
        this.notifyZoomCallbacks();
      }
    }

    this.inputActor.send({ type: 'TOUCH_MOVE', touches });
  };

  /**
   * Handle touch end events.
   */
  handleTouchEnd = (event: TouchEvent): void => {
    this.assertNotDisposed();

    const touchIds = Array.from(event.changedTouches).map((t) => t.identifier);
    const state = this.inputActor.getSnapshot();

    // Calculate release velocity for momentum
    if (state.matches('panning') && this.config.momentumEnabled) {
      const velocity = this.calculatePanVelocity();
      if (Math.abs(velocity.x) > 50 || Math.abs(velocity.y) > 50) {
        this.isMomentumScroll = true; // Track momentum for snap-to-cell
        this.scrollPhysics.startMomentum(velocity.x, velocity.y);
        this.startAnimationLoop();
      }
    }

    this.inputActor.send({ type: 'TOUCH_END', touchIds });
    this.panHistory = [];
  };

  /**
   * Handle pointer down events (mouse clicks, middle-click pan, space+drag).
   */
  handlePointerDown = (event: PointerEvent): void => {
    this.assertNotDisposed();

    // Middle-click pan
    if (event.button === 1 && this.config.middleClickPanEnabled) {
      event.preventDefault();
      this.stopAllAnimations();
      this.inputActor.send({ type: 'PAN_START', x: event.clientX, y: event.clientY });
      this.panHistory = [{ x: event.clientX, y: event.clientY, time: performance.now() }];
      return;
    }

    // Space + left-click pan
    if (event.button === 0 && this.isSpaceHeld && this.config.spacebarPanEnabled) {
      event.preventDefault();
      this.stopAllAnimations();
      this.inputActor.send({ type: 'PAN_START', x: event.clientX, y: event.clientY });
      this.panHistory = [{ x: event.clientX, y: event.clientY, time: performance.now() }];
      return;
    }

    // Left-click: hit test and route to sheet
    if (event.button === 0) {
      const hit = this.hitTest(event.clientX, event.clientY);
      this.routePointerToSheet(hit, event);
    }
  };

  /**
   * Handle pointer move events.
   */
  handlePointerMove = (event: PointerEvent): void => {
    this.assertNotDisposed();

    const state = this.inputActor.getSnapshot();

    if (state.matches('panning')) {
      const prevContext = state.context;
      const deltaX = prevContext.panStartX - event.clientX;
      const deltaY = prevContext.panStartY - event.clientY;

      this.scrollPhysics.applyDelta(deltaX, deltaY);
      this.applyScrollPosition();
      this.notifyScrollCallbacks();

      // Track velocity
      this.trackPanVelocity(event.clientX, event.clientY);

      this.inputActor.send({ type: 'PAN_MOVE', x: event.clientX, y: event.clientY });
    } else {
      // Forward to sheet for selection drag, resize, etc.
      const hit = this.hitTest(event.clientX, event.clientY);
      if (hit.type === 'cell') {
        this.forwardToSheet?.({
          type: 'CELL_POINTER_MOVE',
          row: hit.row,
          col: hit.col,
          event,
        });
      }
    }
  };

  /**
   * Handle pointer up events.
   */
  handlePointerUp = (event: PointerEvent): void => {
    this.assertNotDisposed();

    const state = this.inputActor.getSnapshot();

    if (state.matches('panning')) {
      // Calculate release velocity for momentum
      const velocity = this.calculatePanVelocity();

      if (this.config.momentumEnabled && (Math.abs(velocity.x) > 50 || Math.abs(velocity.y) > 50)) {
        this.isMomentumScroll = true; // Track momentum for snap-to-cell
        this.scrollPhysics.startMomentum(velocity.x, velocity.y);
        this.startAnimationLoop();
      }

      this.inputActor.send({
        type: 'PAN_END',
        velocityX: velocity.x,
        velocityY: velocity.y,
      });
      this.panHistory = [];
    } else {
      this.forwardToSheet?.({ type: 'CELL_POINTER_UP', event });
    }
  };

  /**
   * Handle key down events (for space+drag pan).
   */
  handleKeyDown = (event: KeyboardEvent): void => {
    this.assertNotDisposed();

    if (event.code === 'Space' && !event.repeat) {
      this.isSpaceHeld = true;
    }
  };

  /**
   * Handle key up events.
   */
  handleKeyUp = (event: KeyboardEvent): void => {
    this.assertNotDisposed();

    if (event.code === 'Space') {
      this.isSpaceHeld = false;
    }
  };

  // ===========================================================================
  // HIT TESTING
  // ===========================================================================

  /**
   * Determine what was clicked at a given viewport position.
   * Maps from SheetView's SheetHitResult to the input system's HitTestResult.
   */
  private hitTest(clientX: number, clientY: number): HitTestResult {
    // Check fill handle first (highest priority) — still uses the callback
    if (this.getFillHandleBounds) {
      const fillHandle = this.getFillHandleBounds();
      if (fillHandle && this.isPointInRect({ x: clientX, y: clientY }, fillHandle)) {
        return { type: 'fillHandle' };
      }
    }

    if (!this.hitTestCapability) return { type: 'empty' };

    const result: SheetHitResult = this.hitTestCapability.atViewportPoint({
      x: clientX,
      y: clientY,
    });

    switch (result.type) {
      case 'cell':
      case 'merged-cell-anchor':
        return { type: 'cell', row: result.row, col: result.col };
      case 'column-header':
        return { type: 'columnHeader', col: result.col };
      case 'row-header':
        return { type: 'rowHeader', row: result.row };
      case 'column-resize-handle':
        return { type: 'columnResize', col: result.col };
      case 'row-resize-handle':
        return { type: 'rowResize', row: result.row };
      case 'fill-handle':
        return { type: 'fillHandle' };
      default:
        return { type: 'empty' };
    }
  }

  /**
   * Route a pointer event to the sheet coordinator.
   */
  private routePointerToSheet(hit: HitTestResult, event: PointerEvent): void {
    if (!this.forwardToSheet) return;

    switch (hit.type) {
      case 'cell':
        this.forwardToSheet({
          type: 'CELL_POINTER_DOWN',
          row: hit.row,
          col: hit.col,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey || event.metaKey,
          event,
        });
        break;
      case 'columnResize':
        this.forwardToSheet({ type: 'COLUMN_RESIZE_START', col: hit.col, event });
        break;
      case 'rowResize':
        this.forwardToSheet({ type: 'ROW_RESIZE_START', row: hit.row, event });
        break;
      case 'fillHandle':
        // Detect right-click for fill context menu
        // button 2 = right-click, button 0 = left-click
        if (event.button === 2) {
          this.forwardToSheet({ type: 'RIGHT_FILL_HANDLE_START', event });
        } else {
          this.forwardToSheet({ type: 'FILL_HANDLE_START', event });
        }
        break;
      case 'columnHeader':
        this.forwardToSheet({ type: 'HEADER_CLICK', col: hit.col, event });
        break;
      case 'rowHeader':
        this.forwardToSheet({ type: 'HEADER_CLICK', row: hit.row, event });
        break;
    }
  }

  // ===========================================================================
  // MACHINE STATE CHANGE HANDLER
  // ===========================================================================

  private onMachineStateChange(state: InputState): void {
    const snapshot = getInputSnapshot(state);

    // Notify state change subscribers (for useInputState hook)
    this.notifyStateCallbacks();

    // When entering momentum state from scrolling, start physics momentum.
    // Skip momentum if the user prefers reduced motion (accessibility).
    if (
      snapshot.isMomentum &&
      this.scrollPhysics.isAnimating === false &&
      !this.prefersReducedMotion()
    ) {
      const velocity = {
        x: this.wheelVelocityX || snapshot.velocityX,
        y: this.wheelVelocityY || snapshot.velocityY,
      };
      if (Math.abs(velocity.x) > 50 || Math.abs(velocity.y) > 50) {
        this.isMomentumScroll = true; // Track momentum for snap-to-cell
        this.scrollPhysics.startMomentum(velocity.x, velocity.y);
        this.startAnimationLoop();
      }
    }
  }

  private notifyStateCallbacks(): void {
    this.stateCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (error) {
        console.error('[InputCoordinator] State callback error:', error);
      }
    });
  }

  // ===========================================================================
  // ANIMATION LOOP (for physics updates)
  // ===========================================================================

  private startAnimationLoop(): void {
    if (this.isAnimating) return;

    this.isAnimating = true;
    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.animationTick);
  }

  private stopAnimationLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isAnimating = false;
  }

  private animationTick = (timestamp: number): void => {
    if (!this.isAnimating) return;

    const deltaTime = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // Update physics
    const wasScrollAnimating = this.scrollPhysics.isAnimating;
    const wasZoomAnimating = this.zoomPhysics.isAnimating;

    this.scrollPhysics.update(deltaTime);
    this.zoomPhysics.update(deltaTime);

    // Apply to coordinate system
    if (wasScrollAnimating) {
      this.applyScrollPosition();
      this.notifyScrollCallbacks();
    }

    if (wasZoomAnimating) {
      this.applyZoomToCoordinateSystem();
      this.notifyZoomCallbacks();
    }

    if (wasZoomAnimating) {
      this.requestRender?.();
    } else if (wasScrollAnimating) {
      this.requestScrollFrame();
    }

    // Notify machine when momentum completes
    if (wasScrollAnimating && !this.scrollPhysics.isAnimating) {
      this.inputActor.send({ type: 'MOMENTUM_COMPLETE' });

      // Snap to cell after momentum scroll completes
      // Only trigger snap if this was a momentum scroll (not programmatic animateTo)
      // and snap-to-cell is enabled in config
      if (this.isMomentumScroll && this.config.snapToCellEnabled && this.geometry) {
        this.isMomentumScroll = false; // Reset flag
        const dims = this.geometry.getPositionDimensions();
        if (dims) {
          const positionIndex = adaptPositionDimensions(dims);
          this.scrollPhysics.snapToCell(positionIndex, this.config.snapAnimationDuration);
          // If snap started an animation, keep the loop running
          if (this.scrollPhysics.isAnimating) {
            this.animationFrameId = requestAnimationFrame(this.animationTick);
            return; // Don't stop the loop yet
          }
        }
      }
      this.isMomentumScroll = false; // Reset flag even if snap wasn't triggered
    }

    if (wasZoomAnimating && !this.zoomPhysics.isAnimating) {
      this.inputActor.send({ type: 'ZOOM_COMPLETE' });
    }

    // Continue loop if still animating
    if (this.scrollPhysics.isAnimating || this.zoomPhysics.isAnimating) {
      this.animationFrameId = requestAnimationFrame(this.animationTick);
    } else {
      this.isAnimating = false;
      this.animationFrameId = null;
    }
  };

  // ===========================================================================
  // COORDINATE SYSTEM INTEGRATION
  // ===========================================================================

  private applyScrollPosition(): void {
    const pos = this.scrollPhysics.position;
    // Use callback to route through renderer-execution (single owner pattern)
    // This is critical for layout recomputation to happen on scroll changes
    // The callback is ALWAYS provided via sheet-coordinator.ts
    this.setScrollPosition?.({ x: pos.x, y: pos.y });
  }

  private requestScrollFrame(): void {
    (this.requestFrame ?? this.requestRender)?.();
  }

  private applyZoomToCoordinateSystem(): void {
    if (!this.commands) return;

    this.commands.dispatch({ type: 'set-zoom', zoom: this.zoomPhysics.currentLevel });
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Check if the user prefers reduced motion (accessibility setting).
   * When true, all app-driven momentum/animation should be disabled.
   */
  private prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  }

  /**
   * Detect whether a wheel event came from a trackpad or a discrete mouse wheel.
   *
   * Heuristic (applied to RAW event data before normalization):
   * - deltaMode !== 0 → discrete wheel (line/page mode; trackpads always send pixel mode)
   * - deltaMode === 0 + very large pixel delta → direct pixel scroll / trackpad-like
   * (programmatic pixel scrolls have already supplied the full distance,
   * so app-generated mouse-wheel momentum must not amplify them)
   * - deltaMode === 0 + fractional deltas → trackpad (discrete wheels produce integers)
   * - deltaMode === 0 + integer deltas + high frequency (dt < 50ms) → trackpad
   * (trackpads emit many small events at high frequency during inertia)
   * - Everything else → discrete wheel
   */
  detectTrackpadInput(event: WheelEvent): boolean {
    // Non-pixel deltaMode is always a discrete wheel
    if (event.deltaMode !== 0) return false;

    // Large pixel-mode deltas are direct scroll distances, not physical wheel ticks.
    if (Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) >= 1000) return true;

    // Fractional deltas are a strong trackpad signal — discrete wheels produce integers
    if (event.deltaX % 1 !== 0 || event.deltaY % 1 !== 0) return true;

    // High-frequency integer deltas in pixel mode → trackpad inertia
    const now = performance.now();
    const dt = now - this.lastWheelTime;
    if (dt > 0 && dt < 50) return true;

    return false;
  }

  private normalizeDelta(event: WheelEvent): { deltaX: number; deltaY: number } {
    let deltaX = event.deltaX;
    let deltaY = event.deltaY;

    // Handle deltaMode (0 = pixels, 1 = lines, 2 = pages)
    // Use system-detected line height for better cross-platform scrolling
    if (event.deltaMode === 1) {
      // Line mode - use system preferences for line height
      const lineHeight = this.systemLineHeight;
      deltaX *= lineHeight;
      deltaY *= lineHeight;
    } else if (event.deltaMode === 2) {
      // Page mode - scroll by 90% of viewport
      deltaX *= window.innerWidth * 0.9;
      deltaY *= window.innerHeight * 0.9;
    }

    // Shift+Wheel Horizontal Scroll
    // When Shift is held and there's only vertical scroll, swap to horizontal
    if (event.shiftKey && deltaY !== 0 && deltaX === 0) {
      return { deltaX: deltaY, deltaY: 0 };
    }

    return { deltaX, deltaY };
  }

  /**
   * Palm Rejection Threshold.
   * Touch radius in pixels above which a touch is considered a palm.
   * Typical fingertip touches have radius < 25px, while palm touches are > 40px.
   * This threshold may need tuning based on device testing.
   */
  private static readonly PALM_REJECTION_RADIUS_THRESHOLD = 35;

  /**
   * Extract and filter touches from a TouchList.
   * Implements palm rejection by filtering out touches
   * with large radius, which are likely palm touches rather than finger touches.
   *
   * @param touchList - Native TouchList from a TouchEvent
   * @returns Array of finger touches (palms filtered out)
   */
  private extractTouches(touchList: TouchList): Array<{ id: number; x: number; y: number }> {
    return Array.from(touchList)
      .filter((t) => {
        // Palm rejection
        // Filter out touches with large radius (likely palm touches)
        // Touch.radiusX/radiusY represent the ellipse radius of the touch area
        // We check if either radius is above the threshold
        const radius = Math.max(t.radiusX || 0, t.radiusY || 0);
        if (radius > InputCoordinator.PALM_REJECTION_RADIUS_THRESHOLD) {
          // This is likely a palm touch - reject it
          return false;
        }
        return true;
      })
      .map((t) => ({
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
      }));
  }

  private getTouchDistance(
    touch1: { x: number; y: number },
    touch2: { x: number; y: number },
  ): number {
    const dx = touch2.x - touch1.x;
    const dy = touch2.y - touch1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getTouchCenter(
    touch1: { x: number; y: number },
    touch2: { x: number; y: number },
  ): { x: number; y: number } {
    return {
      x: (touch1.x + touch2.x) / 2,
      y: (touch1.y + touch2.y) / 2,
    };
  }

  private isPointInRect(
    point: { x: number; y: number },
    rect: { x: number; y: number; width: number; height: number },
  ): boolean {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  private trackPanVelocity(x: number, y: number): void {
    const now = performance.now();
    this.panHistory.push({ x, y, time: now });

    // Keep only last 100ms of history
    const cutoff = now - 100;
    while (this.panHistory.length > 0 && this.panHistory[0].time < cutoff) {
      this.panHistory.shift();
    }
  }

  private calculatePanVelocity(): { x: number; y: number } {
    if (this.panHistory.length < 2) {
      return { x: 0, y: 0 };
    }

    const first = this.panHistory[0];
    const last = this.panHistory[this.panHistory.length - 1];
    const dt = (last.time - first.time) / 1000; // seconds

    if (dt <= 0) {
      return { x: 0, y: 0 };
    }

    // Velocity is in the opposite direction of movement (scroll direction)
    return {
      x: ((first.x - last.x) / dt) * 0.5, // Scale down for smoother momentum
      y: ((first.y - last.y) / dt) * 0.5,
    };
  }

  private stopAllAnimations(): void {
    this.scrollPhysics.stop();
    this.zoomPhysics.stop();
    this.stopAnimationLoop();

    if (this.wheelEndTimeout) {
      clearTimeout(this.wheelEndTimeout);
      this.wheelEndTimeout = null;
    }

    this.wheelVelocityX = 0;
    this.wheelVelocityY = 0;
  }

  private scheduleZoomEnd(): void {
    // Use a timeout to signal zoom end after inactivity
    setTimeout(() => {
      const state = this.inputActor.getSnapshot();
      if (state.matches('zooming')) {
        this.inputActor.send({ type: 'ZOOM_COMPLETE' });
      }
    }, 200);
  }

  // ===========================================================================
  // CALLBACKS
  // ===========================================================================

  private notifyScrollCallbacks(): void {
    const state = this.scrollPhysics.getState();
    this.scrollCallbacks.forEach((cb) => {
      try {
        cb(state);
      } catch (error) {
        console.error('[InputCoordinator] Scroll callback error:', error);
      }
    });
  }

  private notifyZoomCallbacks(): void {
    const state = this.zoomPhysics.getState();
    this.zoomCallbacks.forEach((cb) => {
      try {
        cb(state);
      } catch (error) {
        console.error('[InputCoordinator] Zoom callback error:', error);
      }
    });
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Get the input XState actor for React hooks.
   */
  getInputActor(): InputActor {
    this.assertNotDisposed();
    return this.inputActor;
  }

  /**
   * Get current scroll state.
   */
  getScrollState(): ScrollState {
    return this.scrollPhysics.getState();
  }

  /**
   * Get current zoom state.
   */
  getZoomState(): ZoomState {
    return this.zoomPhysics.getState();
  }

  /**
   * Get current machine state.
   */
  getMachineState(): InputMachineState {
    const state = this.inputActor.getSnapshot();
    return state.value as InputMachineState;
  }

  /**
   * Reset the internal scroll position without writing back to the renderer.
   *
   * Use this when an external system (e.g., renderer-execution) has already
   * set the scroll position and the physics engine needs to sync to it.
   * This avoids re-triggering the save path (onScrollPositionChanged) while
   * still publishing the adopted position to scroll subscribers such as the
   * scrollbar bounds bridge.
   *
   * Specifically used during sheet switch: renderer-execution restores scroll
   * via renderer.setScroll(), then calls this to sync the physics engine.
   *
   * @param x - New X scroll position
   * @param y - New Y scroll position
   */
  resetScrollPosition(x: number, y: number): void {
    this.assertNotDisposed();
    this.stopAllAnimations();
    const bounds = this.scrollPhysics.getBounds();
    const maxX = Math.max(bounds.maxX, x);
    const maxY = Math.max(bounds.maxY, y);
    if (maxX !== bounds.maxX || maxY !== bounds.maxY) {
      this.scrollPhysics.setBounds(bounds.minX, maxX, bounds.minY, maxY);
    }
    this.scrollPhysics.setPosition(x, y);
    this.notifyScrollCallbacks();
    // Intentionally does NOT call applyScrollPosition() or requestRender() —
    // the caller has already applied the position externally.
  }

  /**
   * Scroll to a specific position immediately (no animation).
   */
  scrollTo(x: number, y: number): void {
    this.assertNotDisposed();
    this.stopAllAnimations();
    this.scrollPhysics.setPosition(x, y);
    this.applyScrollPosition();
    this.notifyScrollCallbacks();
    this.requestScrollFrame();
  }

  /**
   * Animate scroll to a specific position.
   * Keyboard Navigation Animation Support
   *
   * @param x - Target X scroll position
   * @param y - Target Y scroll position
   * @param duration - Animation duration in milliseconds (default 150ms for keyboard nav)
   */
  animateScrollTo(x: number, y: number, duration: number = 150): void {
    this.assertNotDisposed();
    this.stopAllAnimations();
    this.isMomentumScroll = false; // This is programmatic, not momentum
    this.scrollPhysics.animateTo(x, y, duration);
    this.startAnimationLoop();
  }

  /**
   * Scroll by a delta amount.
   */
  scrollBy(deltaX: number, deltaY: number): void {
    this.assertNotDisposed();
    this.scrollPhysics.applyDelta(deltaX, deltaY);
    this.applyScrollPosition();
    this.notifyScrollCallbacks();
    this.requestScrollFrame();
  }

  /**
   * Animate to a target zoom level.
   */
  zoomTo(level: number, centerX?: number, centerY?: number): void {
    this.assertNotDisposed();
    const cx = centerX ?? window.innerWidth / 2;
    const cy = centerY ?? window.innerHeight / 2;

    this.zoomPhysics.zoomTo(level, cx, cy);
    this.startAnimationLoop();
  }

  /**
   * Set zoom level immediately (no animation).
   */
  setZoom(level: number): void {
    this.assertNotDisposed();
    this.zoomPhysics.setLevel(level);
    this.applyZoomToCoordinateSystem();
    this.notifyZoomCallbacks();
    this.requestRender?.();
  }

  /**
   * Subscribe to scroll state changes.
   */
  onScrollChange(callback: ScrollChangeCallback): () => void {
    this.scrollCallbacks.add(callback);
    return () => this.scrollCallbacks.delete(callback);
  }

  /**
   * Subscribe to zoom state changes.
   */
  onZoomChange(callback: ZoomChangeCallback): () => void {
    this.zoomCallbacks.add(callback);
    return () => this.zoomCallbacks.delete(callback);
  }

  /**
   * Subscribe to machine state changes (idle, panning, momentum, etc.).
   * Unlike onScrollChange which fires every frame, this only fires on
   * state transitions (e.g., start/end of pan gesture).
   *
   */
  onStateChange(callback: () => void): () => void {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  /**
   * Interrupt any active gesture (e.g., when focus changes).
   */
  interrupt(): void {
    this.assertNotDisposed();
    this.stopAllAnimations();
    this.inputActor.send({ type: 'INTERRUPT' });
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Check if the coordinator is disposed.
   */
  isActive(): boolean {
    return !this.isDisposed;
  }

  /**
   * Dispose the coordinator and clean up resources.
   */
  dispose(): void {
    if (this.isDisposed) return;

    // Stop animations
    this.stopAllAnimations();

    // Stop actor
    this.inputActor.stop();

    // Clear timeouts
    if (this.wheelEndTimeout) {
      clearTimeout(this.wheelEndTimeout);
    }

    // Run cleanup functions
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];

    // Clear callbacks
    this.scrollCallbacks.clear();
    this.zoomCallbacks.clear();
    this.stateCallbacks.clear();

    this.isDisposed = true;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private assertNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error('InputCoordinator has been disposed');
    }
  }
}

// =============================================================================
// ADAPTER: PositionDimensions → ViewportPositionIndexLike
// =============================================================================

/**
 * Adapt the public PositionDimensions interface to the ViewportPositionIndexLike
 * interface that ScrollPhysics.snapToCell() expects.
 *
 * PositionDimensions provides getRowTop/getRowHeight/getColLeft/getColWidth/totalRows/totalCols.
 * ViewportPositionIndexLike additionally requires hasData, findRowAtY, findColAtX,
 * isRowHidden, and isColHidden. This adapter adds the missing members via binary search.
 */
function adaptPositionDimensions(
  dims: import('@mog-sdk/sheet-view').PositionDimensions,
): ViewportPositionIndexLike {
  return {
    hasData: true,
    totalRows: dims.totalRows,
    totalCols: dims.totalCols,
    getRowTop: (row: number) => dims.getRowTop(row),
    getRowHeight: (row: number) => dims.getRowHeight(row),
    getColLeft: (col: number) => dims.getColLeft(col),
    getColWidth: (col: number) => dims.getColWidth(col),
    isRowHidden: () => false,
    isColHidden: () => false,
    findRowAtY(y: number): number | null {
      if (dims.totalRows === 0) return null;
      let lo = 0;
      let hi = dims.totalRows - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const top = dims.getRowTop(mid);
        const bottom = top + dims.getRowHeight(mid);
        if (y < top) {
          hi = mid - 1;
        } else if (y >= bottom) {
          lo = mid + 1;
        } else {
          return mid;
        }
      }
      return null;
    },
    findColAtX(x: number): number | null {
      if (dims.totalCols === 0) return null;
      let lo = 0;
      let hi = dims.totalCols - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const left = dims.getColLeft(mid);
        const right = left + dims.getColWidth(mid);
        if (x < left) {
          hi = mid - 1;
        } else if (x >= right) {
          lo = mid + 1;
        } else {
          return mid;
        }
      }
      return null;
    },
  };
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new InputCoordinator instance.
 */
export function createInputCoordinator(config?: Partial<InputCoordinatorConfig>): InputCoordinator {
  return new InputCoordinator(config);
}

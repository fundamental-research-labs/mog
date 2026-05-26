/**
 * InputCapture — Pointer & Wheel Event Handling
 *
 * Attaches pointer and wheel listeners to the container, normalizes
 * to CanvasInputEvent. Keyboard events are explicitly EXCLUDED.
 *
 * Key features:
 * - Automatic pointer capture on pointerdown (for drag operations)
 * - Hit test dispatch through registered providers (top-down by z-index)
 * - Cursor management (highest z-index layer's cursor wins)
 * - Pointer state tracking
 *
 * @module @mog/canvas-engine/input
 */

import type {
  CanvasInputEvent,
  CanvasPointerEvent,
  CanvasWheelEvent,
  HitResult,
  HitTestProvider,
  Modifiers,
  Point,
} from '../core/types';

// =============================================================================
// Types
// =============================================================================

export interface InputCaptureConfig {
  container: HTMLElement;
  /** Called with normalized input events */
  onInput?: (event: CanvasInputEvent) => void;
}

export interface RegisteredHitTestProvider {
  provider: HitTestProvider;
  zIndex: number;
}

// =============================================================================
// CursorManager
// =============================================================================

export class CursorManager {
  private container: HTMLElement;
  private cursors = new Map<string, { cursor: string; zIndex: number }>();
  private defaultCursor = 'default';

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Request a cursor for a layer. Highest zIndex wins. */
  setCursor(layerId: string, cursor: string, zIndex: number): void {
    this.cursors.set(layerId, { cursor, zIndex });
    this.applyTopCursor();
  }

  /** Clear cursor request for a layer */
  clearCursor(layerId: string): void {
    this.cursors.delete(layerId);
    this.applyTopCursor();
  }

  /** Set the default cursor when no layer requests one */
  setDefaultCursor(cursor: string): void {
    this.defaultCursor = cursor;
    this.applyTopCursor();
  }

  private applyTopCursor(): void {
    if (this.cursors.size === 0) {
      this.container.style.cursor = this.defaultCursor;
      return;
    }

    // Find highest zIndex cursor
    let topCursor = this.defaultCursor;
    let topZIndex = -Infinity;
    for (const { cursor, zIndex } of this.cursors.values()) {
      if (zIndex > topZIndex) {
        topZIndex = zIndex;
        topCursor = cursor;
      }
    }

    this.container.style.cursor = topCursor;
  }
}

// =============================================================================
// PointerTracker
// =============================================================================

export class PointerTracker {
  private _position: Point = { x: 0, y: 0 };
  private _buttons = 0;
  private _modifiers: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };
  private _isTouch = false;

  get position(): Point {
    return this._position;
  }

  get buttons(): number {
    return this._buttons;
  }

  get modifiers(): Modifiers {
    return this._modifiers;
  }

  get isTouch(): boolean {
    return this._isTouch;
  }

  get isDown(): boolean {
    return this._buttons !== 0;
  }

  update(event: PointerEvent): void {
    this._position = { x: event.offsetX, y: event.offsetY };
    this._buttons = event.buttons;
    this._isTouch = event.pointerType === 'touch';
    this._modifiers = {
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
    };
  }
}

// =============================================================================
// InputCapture
// =============================================================================

export class InputCapture {
  private container: HTMLElement;
  private onInput: ((event: CanvasInputEvent) => void) | null;
  private hitTestProviders: RegisteredHitTestProvider[] = [];
  readonly cursor: CursorManager;
  readonly pointer: PointerTracker;
  private disposed = false;

  // Bound handlers for removal
  private handlePointerDown: (e: PointerEvent) => void;
  private handlePointerMove: (e: PointerEvent) => void;
  private handlePointerUp: (e: PointerEvent) => void;
  private handlePointerEnter: (e: PointerEvent) => void;
  private handlePointerLeave: (e: PointerEvent) => void;
  private handleWheel: (e: WheelEvent) => void;

  constructor(config: InputCaptureConfig) {
    this.container = config.container;
    this.onInput = config.onInput ?? null;
    this.cursor = new CursorManager(config.container);
    this.pointer = new PointerTracker();

    // Set touch-action: none to prevent browser scroll during canvas interaction
    this.container.style.touchAction = 'none';

    // Bind handlers
    this.handlePointerDown = this.onPointerDown.bind(this);
    this.handlePointerMove = this.onPointerMove.bind(this);
    this.handlePointerUp = this.onPointerUp.bind(this);
    this.handlePointerEnter = this.onPointerEnter.bind(this);
    this.handlePointerLeave = this.onPointerLeave.bind(this);
    this.handleWheel = this.onWheel.bind(this);

    // Attach listeners
    this.container.addEventListener('pointerdown', this.handlePointerDown);
    this.container.addEventListener('pointermove', this.handlePointerMove);
    this.container.addEventListener('pointerup', this.handlePointerUp);
    this.container.addEventListener('pointerenter', this.handlePointerEnter);
    this.container.addEventListener('pointerleave', this.handlePointerLeave);
    this.container.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /** Register a hit test provider at a given z-index */
  registerHitTestProvider(provider: HitTestProvider, zIndex: number): void {
    this.hitTestProviders.push({ provider, zIndex });
    // Sort descending by zIndex (top-first for hit testing)
    this.hitTestProviders.sort((a, b) => b.zIndex - a.zIndex);
  }

  /** Unregister a hit test provider */
  unregisterHitTestProvider(provider: HitTestProvider): void {
    this.hitTestProviders = this.hitTestProviders.filter((r) => r.provider !== provider);
  }

  /**
   * Dispatch a hit test through all providers, top-down by z-index.
   * Returns the first non-null hit.
   */
  hitTest(screenPoint: Point): HitResult | null {
    for (const { provider } of this.hitTestProviders) {
      const result = provider.hitTest(screenPoint);
      if (result) return result;
    }
    return null;
  }

  setOnInput(callback: ((event: CanvasInputEvent) => void) | null): void {
    this.onInput = callback;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Remove all event listeners
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    this.container.removeEventListener('pointerup', this.handlePointerUp);
    this.container.removeEventListener('pointerenter', this.handlePointerEnter);
    this.container.removeEventListener('pointerleave', this.handlePointerLeave);
    this.container.removeEventListener('wheel', this.handleWheel);

    this.hitTestProviders = [];
    this.onInput = null;
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  private onPointerDown(e: PointerEvent): void {
    this.pointer.update(e);

    // Automatic pointer capture for drag operations
    try {
      this.container.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture may fail in test environments
    }

    this.emitPointerEvent(e, 'down');
  }

  private onPointerMove(e: PointerEvent): void {
    this.pointer.update(e);
    this.emitPointerEvent(e, 'move');
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointer.update(e);

    // Release pointer capture
    try {
      this.container.releasePointerCapture(e.pointerId);
    } catch {
      // releasePointerCapture may fail in test environments
    }

    this.emitPointerEvent(e, 'up');
  }

  private onPointerEnter(e: PointerEvent): void {
    this.pointer.update(e);
    this.emitPointerEvent(e, 'enter');
  }

  private onPointerLeave(e: PointerEvent): void {
    this.pointer.update(e);
    this.emitPointerEvent(e, 'leave');
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    const position: Point = { x: e.offsetX, y: e.offsetY };
    const modifiers: Modifiers = {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    };

    const deltaMode: CanvasWheelEvent['deltaMode'] =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 'line'
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? 'page'
          : 'pixel';

    const event: CanvasWheelEvent = {
      kind: 'wheel',
      position,
      worldPosition: position, // Caller must apply scroll/zoom transform
      modifiers,
      timestamp: e.timeStamp,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode,
    };

    this.onInput?.(event);
  }

  private emitPointerEvent(e: PointerEvent, action: CanvasPointerEvent['action']): void {
    const position: Point = { x: e.offsetX, y: e.offsetY };
    const modifiers: Modifiers = {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    };

    const event: CanvasPointerEvent = {
      kind: 'pointer',
      action,
      position,
      worldPosition: position, // Caller must apply scroll/zoom transform
      modifiers,
      timestamp: e.timeStamp,
      button: e.button,
      isTouch: e.pointerType === 'touch',
    };

    this.onInput?.(event);
  }
}

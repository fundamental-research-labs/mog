/**
 * Input Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - idle: No active gesture, waiting for input
 * - scrolling: Active wheel scrolling
 * - momentum: Inertial scrolling after wheel/pan ends
 * - panning: Pointer/touch drag to scroll
 * - pinching: Two-finger pinch to zoom
 * - zooming: Wheel-based zoom (Ctrl+wheel or trackpad pinch)
 *
 * @see state-machines/src/input-machine.ts
 */

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface InputState {
  context: {
    /** Current horizontal scroll position in pixels */
    scrollX: number;
    /** Current vertical scroll position in pixels */
    scrollY: number;
    /** Current horizontal velocity in px/s */
    velocityX: number;
    /** Current vertical velocity in px/s */
    velocityY: number;
    /** Current zoom level (1.0 = 100%) */
    zoomLevel: number;
    /** Zoom center X coordinate */
    zoomCenterX: number;
    /** Zoom center Y coordinate */
    zoomCenterY: number;
    /** Active touch points */
    activeTouches: Array<{ id: number; x: number; y: number }>;
    /** Initial pinch distance for zoom calculation */
    initialPinchDistance: number;
    /** Pan start X coordinate */
    panStartX: number;
    /** Pan start Y coordinate */
    panStartY: number;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
  value: string;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface InputAccessor {
  // Value accessors
  getScrollX(): number;
  getScrollY(): number;
  getVelocityX(): number;
  getVelocityY(): number;
  getZoomLevel(): number;
  getZoomCenterX(): number;
  getZoomCenterY(): number;
  getActiveTouches(): Array<{ id: number; x: number; y: number }>;
  getPanStartX(): number;
  getPanStartY(): number;

  // State matching accessors
  isIdle(): boolean;
  isScrolling(): boolean;
  isPanning(): boolean;
  isPinching(): boolean;
  isZooming(): boolean;
  isMomentum(): boolean;

  // Derived accessors
  isAnimating(): boolean;
  getMachineState(): string;
}

// =============================================================================
// COMMANDS INTERFACE
// =============================================================================

export interface InputCommands {
  // Wheel events
  wheel(deltaX: number, deltaY: number): void;
  scrollEnd(): void;

  // Zoom events
  zoom(delta: number, centerX: number, centerY: number): void;
  zoomComplete(): void;

  // Pan events
  panStart(x: number, y: number): void;
  panMove(x: number, y: number): void;
  panEnd(velocityX: number, velocityY: number): void;

  // Touch events
  touchStart(touches: Array<{ id: number; x: number; y: number }>): void;
  touchMove(touches: Array<{ id: number; x: number; y: number }>): void;
  touchEnd(touchIds: number[]): void;

  // Control events
  momentumComplete(): void;
  interrupt(): void;
}

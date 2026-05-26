/**
 * Input & Gesture System - Types & Contracts
 *
 * This file defines all interfaces for the input system.
 * No runtime code - just types for parallel development.
 */

// ─────────────────────────────────────────────────────────────
// Gesture Types
// ─────────────────────────────────────────────────────────────

export type GestureType = 'scroll' | 'zoom' | 'pan' | 'pinch';
export type GesturePhase = 'start' | 'change' | 'end' | 'cancel';

// ─────────────────────────────────────────────────────────────
// Hit Test Results
// ─────────────────────────────────────────────────────────────

import type {
  HitTestResult as ContractHitTestResult,
  ScrollPhysicsConfig as ContractScrollPhysicsConfig,
  ScrollState as ContractScrollState,
  ZoomPhysicsConfig as ContractZoomPhysicsConfig,
  ZoomState as ContractZoomState,
} from '@mog-sdk/contracts/rendering';

export type HitTestResult = ContractHitTestResult;
export type ScrollPhysicsConfig = ContractScrollPhysicsConfig;
export type ScrollState = ContractScrollState;
export type ZoomPhysicsConfig = ContractZoomPhysicsConfig;
export type ZoomState = ContractZoomState;

// ─────────────────────────────────────────────────────────────
// Events Forwarded to SheetCoordinator
// ─────────────────────────────────────────────────────────────

export type SheetInputEvent =
  | {
      type: 'CELL_POINTER_DOWN';
      row: number;
      col: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      event: PointerEvent;
    }
  | { type: 'CELL_POINTER_MOVE'; row: number; col: number; event: PointerEvent }
  | { type: 'CELL_POINTER_UP'; event: PointerEvent }
  | {
      type: 'CELL_DOUBLE_CLICK';
      row: number;
      col: number;
      event: PointerEvent;
    }
  | { type: 'COLUMN_RESIZE_START'; col: number; event: PointerEvent }
  | { type: 'ROW_RESIZE_START'; row: number; event: PointerEvent }
  | { type: 'FILL_HANDLE_START'; event: PointerEvent }
  // Right-click fill handle for context menu
  | { type: 'RIGHT_FILL_HANDLE_START'; event: PointerEvent }
  | { type: 'HEADER_CLICK'; col?: number; row?: number; event: PointerEvent };

// ─────────────────────────────────────────────────────────────
// Input Machine Context & Events
// ─────────────────────────────────────────────────────────────

export interface InputContext {
  // Scroll state
  scrollX: number;
  scrollY: number;
  velocityX: number;
  velocityY: number;

  // Zoom state
  zoomLevel: number;
  zoomCenterX: number;
  zoomCenterY: number;

  // Touch tracking
  activeTouches: Array<{ id: number; x: number; y: number }>;
  initialPinchDistance: number;

  // Pan tracking
  panStartX: number;
  panStartY: number;
}

export type InputEvent =
  | { type: 'WHEEL'; deltaX: number; deltaY: number }
  | { type: 'ZOOM'; delta: number; centerX: number; centerY: number }
  | { type: 'SCROLL_END' }
  | {
      type: 'TOUCH_START';
      touches: Array<{ id: number; x: number; y: number }>;
    }
  | {
      type: 'TOUCH_MOVE';
      touches: Array<{ id: number; x: number; y: number }>;
    }
  | { type: 'TOUCH_END'; touchIds: number[] }
  | { type: 'PAN_START'; x: number; y: number }
  | { type: 'PAN_MOVE'; x: number; y: number }
  | { type: 'PAN_END'; velocityX: number; velocityY: number }
  | { type: 'MOMENTUM_COMPLETE' }
  | { type: 'ZOOM_COMPLETE' }
  | { type: 'INTERRUPT' }; // Any new input during animation

// ─────────────────────────────────────────────────────────────
// Input Coordinator Configuration
// ─────────────────────────────────────────────────────────────

export interface InputCoordinatorConfig {
  // Scroll physics
  /** Enable momentum scrolling after wheel/pan */
  momentumEnabled: boolean;
  /** Time constant in ms (325 = iOS-like) */
  decelerationRate: number;
  /** Stop threshold (px/s) */
  minVelocity: number;
  /** Clamp maximum velocity (px/s) */
  maxVelocity: number;

  // Zoom
  /** Multiplier for wheel delta when zooming */
  zoomSensitivity: number;
  /** Minimum zoom level (e.g., 0.1) */
  minZoom: number;
  /** Maximum zoom level (e.g., 4.0) */
  maxZoom: number;

  // Touch
  /** Enable single-finger touch panning */
  touchPanEnabled: boolean;
  /** Enable two-finger pinch zooming */
  pinchZoomEnabled: boolean;

  // Pointer
  /** Enable middle-click panning */
  middleClickPanEnabled: boolean;
  /** Enable space+drag panning */
  spacebarPanEnabled: boolean;

  // Bounds behavior
  /** How to handle scroll at bounds: 'stop' or 'clamp' */
  scrollBoundsMode: 'stop' | 'clamp';

  // Cell snapping (Scroll Animation)
  /** Enable snapping to cell boundaries after momentum scroll ends */
  snapToCellEnabled: boolean;
  /** Duration of snap animation in milliseconds */
  snapAnimationDuration: number;

  // Keyboard navigation animation (Scroll Animation)
  /** Enable smooth animation for keyboard navigation scroll (Page Up/Down, Ctrl+Home/End) */
  animateKeyboardNavigation: boolean;
  /** Duration of keyboard navigation scroll animation in milliseconds */
  keyboardNavAnimationDuration: number;
}

// ─────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────

export const DEFAULT_INPUT_CONFIG: InputCoordinatorConfig = {
  // Scroll physics - iOS-like feel
  momentumEnabled: true,
  decelerationRate: 325,
  minVelocity: 0.5,
  maxVelocity: 8000,

  // Zoom
  zoomSensitivity: 0.01,
  minZoom: 0.1,
  maxZoom: 4.0,

  // Touch
  touchPanEnabled: true,
  pinchZoomEnabled: true,

  // Pointer
  middleClickPanEnabled: true,
  spacebarPanEnabled: true,

  // Bounds
  scrollBoundsMode: 'clamp',

  // Cell snapping (Scroll Animation)
  // Enabled by default for Excel parity - snaps to cell boundaries after momentum scroll
  // Implementation in scroll-physics.ts:308-390 is production-ready
  snapToCellEnabled: true,
  snapAnimationDuration: 100,

  // Keyboard navigation animation (Scroll Animation)
  // Enabled by default for smooth UX on Page Up/Down, Ctrl+Home/End
  animateKeyboardNavigation: true,
  keyboardNavAnimationDuration: 150,
};

// ─────────────────────────────────────────────────────────────
// Input Machine State Types (for type-safe state checks)
// ─────────────────────────────────────────────────────────────

export type InputMachineState =
  | 'idle'
  | 'scrolling'
  | 'momentum'
  | 'panning'
  | 'pinching'
  | 'zooming';

// ─────────────────────────────────────────────────────────────
// Callbacks & Subscriptions
// ─────────────────────────────────────────────────────────────

export type ScrollChangeCallback = (state: ScrollState) => void;
export type ZoomChangeCallback = (state: ZoomState) => void;
export type PhysicsUpdater = (deltaTimeMs: number) => void;

/**
 * InkSimulator - Headless test harness for the ink system.
 *
 * Creates a real InkSystem with mocked dependencies and provides
 * ergonomic helpers for driving ink state transitions in tests.
 * @module systems/ink/testing
 */

import type { InkPoint, StrokeId } from '@mog-sdk/contracts/ink';

import { createMockContainerElement, createMockCoordinateSystem } from '../../testing-foundation';
import type { SystemSimulator } from '../../testing-foundation/types';
import { InkSystem } from '../ink-system';
import type { IInkSystem } from '../types';

// =============================================================================
// OPTIONS & SNAPSHOT
// =============================================================================

export interface InkSimulatorOptions {
  /** Viewport dimensions for mock coordinate system (default: 1000x600) */
  viewport?: { width: number; height: number };
  /** User ID for stroke attribution (default: 'test-user') */
  userId?: string;
}

/**
 * Point-in-time snapshot of the ink system state.
 * Used for assertions in tests.
 */
export interface InkSnapshot {
  /** Whether ink mode is active (not idle) */
  isActive: boolean;
  /** Current XState state value (e.g., 'idle', 'drawing', 'stroking') */
  actorState: string;
  /** Number of times onActivate callback fired */
  activateCount: number;
  /** Number of times onDeactivate callback fired */
  deactivateCount: number;
}

// =============================================================================
// SIMULATOR INTERFACE
// =============================================================================

export interface InkSimulator extends SystemSimulator<IInkSystem, InkSnapshot> {
  // -- Mode control (delegates to system) --
  activate(drawingId?: string): void;
  deactivate(): void;

  // -- Stroke simulation (sends events to ink actor via commands) --
  startStroke(x: number, y: number, pressure?: number): void;
  continueStroke(x: number, y: number, pressure?: number): void;
  endStroke(): void;

  // -- Eraser simulation --
  startErase(x: number, y: number): void;
  continueErase(x: number, y: number): void;
  endErase(): void;

  // -- State queries --
  isActive(): boolean;
  actorState(): string;

  // -- Event tracking --
  readonly activateCount: number;
  readonly deactivateCount: number;
}

// =============================================================================
// HELPERS
// =============================================================================

let strokeCounter = 0;

/**
 * Generate a test stroke ID (branded string).
 * Produces unique IDs within a test run.
 */
function generateTestStrokeId(): StrokeId {
  return `test-stroke-${++strokeCounter}` as unknown as StrokeId;
}

/**
 * Create an InkPoint from x, y coordinates and optional pressure.
 */
function makePoint(x: number, y: number, pressure?: number): InkPoint {
  const point: InkPoint = { x, y };
  if (pressure !== undefined) {
    point.pressure = pressure;
  }
  return point;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create an InkSimulator for testing.
 *
 * Constructs a real InkSystem with mocked dependencies:
 * - getCanvas -> mock HTMLElement
 * - getCoordinateSystem -> mock CoordinateSystem
 * - getDrawingOffset -> { x: 0, y: 0 }
 * - userId -> from options or 'test-user'
 *
 * @example
 * const sim = createInkSimulator();
 * sim.start();
 * sim.activate('drawing-1');
 * expect(sim.isActive()).toBe(true);
 * expect(sim.actorState()).toBe('drawing');
 * sim.destroy();
 */
export function createInkSimulator(options?: InkSimulatorOptions): InkSimulator {
  const { viewport, userId } = options ?? {};
  const vw = viewport?.width ?? 1000;
  const vh = viewport?.height ?? 600;

  // Reset stroke counter for each simulator (avoids leaking between tests)
  strokeCounter = 0;

  // -- Assemble mocked dependencies --
  const mockContainer = createMockContainerElement(vw, vh);
  const mockCoordSystem = createMockCoordinateSystem({
    viewportWidth: vw,
    viewportHeight: vh,
  });

  const system = new InkSystem({
    getCanvas: () => mockContainer as unknown as HTMLElement,
    getGeometry: () => null,
    getDrawingOffset: () => ({ x: 0, y: 0 }),
    userId: userId ?? 'test-user',
  });

  // -- Event tracking --
  let _activateCount = 0;
  let _deactivateCount = 0;

  system.onActivate(() => {
    _activateCount++;
  });
  system.onDeactivate(() => {
    _deactivateCount++;
  });

  // -- State helpers --
  function getActorState(): string {
    const snap = system.access.actors.ink.getSnapshot();
    const value = snap.value;
    // XState v5 state value is a string for flat states
    if (typeof value === 'string') return value;
    // For nested states it would be an object, but ink machine is flat
    return String(value);
  }

  // -- Build simulator --
  const simulator: InkSimulator = {
    // SystemSimulator protocol
    start() {
      system.start();
    },

    async flush() {
      await Promise.resolve();
    },

    destroy() {
      system.dispose();
    },

    snapshot(): InkSnapshot {
      return {
        isActive: system.isActive(),
        actorState: getActorState(),
        activateCount: _activateCount,
        deactivateCount: _deactivateCount,
      };
    },

    get system() {
      return system;
    },

    endDrag() {
      system.dragTerminator.endDrag();
    },

    cancelDrag() {
      system.dragTerminator.cancelDrag();
    },

    // Mode control
    activate(drawingId?: string) {
      system.activate(drawingId ?? 'test-drawing');
    },

    deactivate() {
      system.deactivate();
    },

    // Stroke simulation -- uses commands layer for type-safe event dispatch
    startStroke(x: number, y: number, pressure?: number) {
      const point = makePoint(x, y, pressure);
      const strokeId = generateTestStrokeId();
      system.access.commands.ink.penDown(point, strokeId);
    },

    continueStroke(x: number, y: number, pressure?: number) {
      const point = makePoint(x, y, pressure);
      system.access.commands.ink.penMove(point);
    },

    endStroke() {
      system.access.commands.ink.penUp();
    },

    // Eraser simulation
    startErase(x: number, y: number) {
      const point = makePoint(x, y);
      system.access.commands.ink.eraserDown(point);
    },

    continueErase(x: number, y: number) {
      const point = makePoint(x, y);
      system.access.commands.ink.eraserMove(point);
    },

    endErase() {
      system.access.commands.ink.eraserUp();
    },

    // State queries
    isActive() {
      return system.isActive();
    },

    actorState() {
      return getActorState();
    },

    // Event tracking (read-only properties)
    get activateCount() {
      return _activateCount;
    },

    get deactivateCount() {
      return _deactivateCount;
    },
  };

  return simulator;
}

/**
 * Renderer System Simulator
 *
 * Wraps the real RenderSystem in a test-friendly harness that:
 * - Creates a RenderSystem with minimal mock dependencies
 * - Drives lifecycle transitions via real system methods
 * - Tracks invalidation calls via spy
 * - Provides snapshot for assertions
 *
 * The RenderSystem's internal actors (rendererMachine, pageBreakMachine) are real
 * XState actors. The execution layer (renderer-execution) needs setDependencies()
 * before it subscribes to state transitions. Without calling setDependencies(),
 * lifecycle state transitions happen purely in the XState machine without side effects
 * like DOM manipulation or renderer creation.
 *
 * @module systems/renderer/testing
 */

import type { TestSheetConfig } from '../../testing-foundation';
import { createMockContainerElement, type MockContainerElement } from '../../testing-foundation';
import type { SystemSimulator } from '../../testing-foundation/types';
import type { PageBreakHitResult } from '../features/page-break/page-break-coordination';
import { RenderSystem } from '../render-system';
import type { IRenderSystem, RenderSystemConfig } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface RendererSimulatorOptions {
  /** Sheet configuration for test context */
  sheet?: TestSheetConfig;
  /** Viewport dimensions (default: 800x600) */
  viewport?: { width: number; height: number };
  /** Initial frozen panes */
  frozenPanes?: { rows: number; cols: number };
  /** Auto-advance to ready state after start() (skip mount/layout/init steps) */
  autoReady?: boolean;
}

export interface RendererSimulatorSnapshot {
  /** Current lifecycle state of the renderer machine */
  lifecycleState: string;
  /** Whether a page break drag is in progress */
  isPageBreakDragging: boolean;
  /** All recorded invalidation reasons */
  invalidations: string[];
  /** Current sheet ID from renderer snapshot */
  currentSheetId: string | null;
  /** Whether the renderer is switching sheets */
  isSwitching: boolean;
}

export interface RendererSimulator extends SystemSimulator<
  IRenderSystem,
  RendererSimulatorSnapshot
> {
  // -- Lifecycle driving --
  mount(): void;
  layout(width: number, height: number): void;
  initSheet(sheetId: string): void;
  switchSheet(sheetId: string): void;
  suspend(): void;
  resume(): void;
  resize(width: number, height: number): void;

  // -- Viewport control --
  setScrollPosition(position: { x: number; y: number }): void;
  setFrozenPanes(panes: { rows: number; cols: number }): void;
  setZoom(level: number): void;

  // -- Page break drag --
  startPageBreakDrag(hitResult: PageBreakHitResult, x: number, y: number): void;
  updatePageBreakDrag(x: number, y: number): void;

  // -- Invalidation tracking --
  getInvalidations(): string[];
  clearInvalidations(): void;

  // -- State queries --
  lifecycleState(): string;
  isPageBreakDragging(): boolean;
  coordinateSystem(): unknown | null;
}

// =============================================================================
// Mock sheetSwitchDeps (zustand-like store API)
// =============================================================================

interface MockSheetSwitchState {
  activeSheetId: string;
  contextualTabs: { hasSparklineInActiveCell: boolean };
  setHasSparklineInActiveCell: () => void;
}

function createMockSheetSwitchDeps() {
  const state: MockSheetSwitchState = {
    activeSheetId: 'sheet-1',
    contextualTabs: { hasSparklineInActiveCell: false },
    setHasSparklineInActiveCell: () => {},
  };

  const listeners = new Set<(state: MockSheetSwitchState) => void>();

  return {
    uiStoreApi: {
      getState: () => state,
      getInitialState: () => state,
      setState: (partial: Partial<MockSheetSwitchState>) => {
        Object.assign(state, partial);
        listeners.forEach((fn) => fn(state));
      },
      subscribe: (fn: (state: MockSheetSwitchState) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      destroy: () => listeners.clear(),
    } as any,
  };
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a RendererSimulator that wraps the real RenderSystem.
 *
 * The simulator creates the RenderSystem with minimal mock dependencies,
 * allowing lifecycle state transitions to be driven and asserted.
 *
 * Note: Without calling setRendererDependencies(), the execution layer
 * won't create a real GridRenderer. This means viewport operations
 * (setScrollPosition, setFrozenPanes, setZoom) will be no-ops when
 * rendererExecution is null. The simulator primarily tests lifecycle
 * state machine transitions and page break drag state.
 */
export function createRendererSimulator(options: RendererSimulatorOptions = {}): RendererSimulator {
  const { viewport = { width: 800, height: 600 }, autoReady = false } = options;

  // Track invalidation calls
  const invalidations: string[] = [];

  // Create mock container
  const container: MockContainerElement = createMockContainerElement(
    viewport.width,
    viewport.height,
  );

  // Create the real RenderSystem with minimal config
  const config: RenderSystemConfig = {
    sheetSwitchDeps: createMockSheetSwitchDeps(),
  };

  const system = new RenderSystem(config);

  // Spy on invalidate() to track calls
  const originalInvalidate = system.invalidate.bind(system);
  system.invalidate = (reason?: string) => {
    invalidations.push(reason ?? '');
    originalInvalidate(reason);
  };

  // Default sheet ID for autoReady
  const defaultSheetId = options.sheet?.sheetId ?? 'sheet-1';

  // Helper to get lifecycle state from the renderer actor snapshot
  function getLifecycleState(): string {
    const snap = system.getRendererSnapshot();
    return snap.status;
  }

  // Build the simulator
  const simulator: RendererSimulator = {
    // -- SystemSimulator protocol --

    start() {
      system.start();

      if (autoReady) {
        system.mount(container as unknown as HTMLElement);
        system.layoutReady(viewport.width, viewport.height);
        system.rendererInitialized(defaultSheetId);
      }
    },

    async flush() {
      await Promise.resolve();
    },

    destroy() {
      system.dispose();
    },

    snapshot(): RendererSimulatorSnapshot {
      const rendererSnap = system.getRendererSnapshot();
      return {
        lifecycleState: rendererSnap.status,
        isPageBreakDragging: system.isPageBreakDragging(),
        invalidations: [...invalidations],
        currentSheetId: rendererSnap.currentSheetId,
        isSwitching: rendererSnap.isSwitching,
      };
    },

    get system(): IRenderSystem {
      return system;
    },

    endDrag() {
      system.pageBreakDragTerminator.endDrag();
    },

    cancelDrag() {
      system.pageBreakDragTerminator.cancelDrag();
    },

    // -- Lifecycle driving --

    mount() {
      system.mount(container as unknown as HTMLElement);
    },

    layout(width: number, height: number) {
      system.layoutReady(width, height);
    },

    initSheet(sheetId: string) {
      system.rendererInitialized(sheetId);
    },

    switchSheet(sheetId: string) {
      system.switchSheet(sheetId);
    },

    suspend() {
      system.suspend();
    },

    resume() {
      system.resume();
    },

    resize(width: number, height: number) {
      system.resize(width, height);
    },

    // -- Viewport control --

    setScrollPosition(position: { x: number; y: number }) {
      system.setScrollPosition(position);
    },

    setFrozenPanes(panes: { rows: number; cols: number }) {
      system.setFrozenPanes(panes);
    },

    setZoom(level: number) {
      system.setZoom(level);
    },

    // -- Page break drag --

    startPageBreakDrag(hitResult: PageBreakHitResult, x: number, y: number) {
      system.startPageBreakDrag(hitResult, x, y);
    },

    updatePageBreakDrag(x: number, y: number) {
      system.updatePageBreakDrag(x, y);
    },

    // -- Invalidation tracking --

    getInvalidations(): string[] {
      return [...invalidations];
    },

    clearInvalidations() {
      invalidations.length = 0;
    },

    // -- State queries --

    lifecycleState(): string {
      return getLifecycleState();
    },

    isPageBreakDragging(): boolean {
      return system.isPageBreakDragging();
    },

    coordinateSystem(): unknown | null {
      return null;
    },
  };

  return simulator;
}

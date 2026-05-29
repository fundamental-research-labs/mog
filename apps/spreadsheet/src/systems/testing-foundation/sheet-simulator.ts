/**
 * SheetSimulator - Cross-System Integration Test Harness
 *
 * Creates REAL system instances and wires them together, replicating
 * what SheetCoordinator does in production. Uses mock dependencies
 * for headless testing without DOM, Canvas, or React.
 * Key design decisions:
 * - Creates real systems (not per-system simulators) for maximum fidelity
 * - Cross-system wiring matches SheetCoordinator exactly (7 subscriptions)
 * - Renderer auto-readied after start() (mount + layoutReady + rendererInitialized)
 * - Focus actor shared between input system and simulator
 * - No high-level convenience methods -- tests call system methods directly
 *
 * @see coordinator/sheet-coordinator.ts - source of truth for system wiring
 * @see SYSTEM-TESTING-HARNESS.md
 * @module systems/testing-foundation
 */

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import { jest } from '@jest/globals';

import { GridEditingSystem } from '../grid-editing/grid-editing-system';
import type { IGridEditingSystem } from '../grid-editing/types';
import { InkSystem } from '../ink/ink-system';
import type { IInkSystem } from '../ink/types';
import { InputSystem } from '../input/input-system';
import type { IInputSystem } from '../input/types';
import { ObjectSystem } from '../objects/object-system';
import type { TestFloatingObject } from '../objects/testing/object-simulator';
import type { IObjectSystem } from '../objects/types';
import { RenderSystem } from '../renderer/render-system';
import type { IRenderSystem } from '../renderer/types';

import {
  dispatchPointerCancel,
  dispatchPointerUp,
  wireSystemsForTest,
} from './cross-system-wiring';
import { createMockCoordinateSystem } from './mock-coordinate-system';
import { createMockContainerElement, createMockHitTestService } from './mock-dependencies';
import { createMockFocusActor } from './mock-focus-actor';
import { createTestSheetContext, type TestSheetConfig } from './test-sheet-context';

// =============================================================================
// OPTIONS
// =============================================================================

export interface SheetSimulatorOptions {
  /** Sheet data configuration */
  sheet?: TestSheetConfig;
  /** Which systems to wire (default: grid + renderer) */
  systems?: {
    grid?: boolean; // default: true
    renderer?: boolean; // default: true
    objects?: boolean; // default: false
    input?: boolean; // default: false
    ink?: boolean; // default: false
  };
  /** Floating objects for objects system (requires objects: true) */
  objects?: TestFloatingObject[];
}

// =============================================================================
// INTERFACE
// =============================================================================

export interface SheetSimulator {
  /** Start all enabled systems and wire cross-system events */
  start(): void;
  /** Flush microtask queue for cross-actor coordination */
  flush(): Promise<void>;
  /** Dispose all systems and clean up wiring */
  destroy(): void;

  /** Grid editing system (always available) */
  readonly grid: IGridEditingSystem;
  /** Render system (if enabled) */
  readonly renderer?: IRenderSystem;
  /** Object system (if enabled) */
  readonly objects?: IObjectSystem;
  /** Input system (if enabled) */
  readonly input?: IInputSystem;
  /** Ink system (if enabled) */
  readonly ink?: IInkSystem;

  /** Dispatch pointer-up to all systems (replicates SheetCoordinator.handlePointerUp) */
  pointerUp(): void;
  /** Dispatch pointer-cancel to all systems (replicates SheetCoordinator.handlePointerCancel) */
  pointerCancel(): void;

  /** Get all recorded invalidation reasons from renderer.invalidate() spy */
  getInvalidations(): Array<{ reason: string }>;
  /** Clear recorded invalidations */
  clearInvalidations(): void;
}

// =============================================================================
// MOCK ZUSTAND STORE (for renderer and grid sheetSwitchDeps)
// =============================================================================

function createMockSheetSwitchDeps() {
  const state: Record<string, unknown> = {
    activeSheetId: 'sheet-1',
    contextualTabs: { hasSparklineInActiveCell: false },
    setHasSparklineInActiveCell: () => {},
    // GridEditingUIStore fields
    rangeSelectionMode: { active: false },
    updateRangeSelection: () => {},
    setActiveCellFormat: () => {},
    setToolbarRanges: () => {},
    tableDesign: { selectedTableId: null },
    setSelectedTable: () => {},
    pivot: { selectedPivotId: null, editingPivotId: null },
    selectPivot: (pivotId: string | null) => {
      state.pivot = { ...state.pivot, selectedPivotId: pivotId };
    },
    startEditingPivot: (pivotId: string) => {
      state.pivot = { selectedPivotId: pivotId, editingPivotId: pivotId };
    },
    stopEditingPivot: () => {
      state.pivot = { ...state.pivot, editingPivotId: null };
    },
    removeValidationCircle: () => {},
    flashFillPreview: { isShowingPreview: false, targetColumn: 0, previewValues: [] },
    showFlashFillPreview: () => {},
    hideFlashFillPreview: () => {},
    showAutofillOptionsButton: () => {},
    showFillContextMenu: () => {},
    // KeyboardUIStore fields (selection-mode fields
    // moved to selection actor, only paste-options helpers remain).
    shouldShowPasteOptionsOnCtrlUp: () => false,
    openPasteOptionsMenu: () => {},
  };

  const listeners = new Set<(state: Record<string, unknown>) => void>();

  return {
    uiStoreApi: {
      getState: () => state,
      getInitialState: () => state,
      setState: (partial: Partial<typeof state>) => {
        Object.assign(state, partial);
        listeners.forEach((fn) => fn(state));
      },
      subscribe: (fn: (state: Record<string, unknown>) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      destroy: () => listeners.clear(),
    } as any,
  };
}

// =============================================================================
// MOCK FLOATING OBJECT MANAGER (inline version for SheetSimulator)
// =============================================================================

function createInlineMockIFloatingObjectManager(
  objects: TestFloatingObject[] = [],
  defaultSheetId: string = 'sheet-1',
): IFloatingObjectManager {
  const objectMap = new Map<string, any>();

  for (const obj of objects) {
    objectMap.set(obj.id, {
      id: obj.id,
      type: obj.type === 'image' ? 'picture' : obj.type,
      sheetId: obj.sheetId ?? defaultSheetId,
      position: {
        anchorType: 'absolute' as const,
        from: { cellId: 'mock-cell-id', xOffset: 0, yOffset: 0 },
        x: obj.position.x,
        y: obj.position.y,
        width: obj.position.width,
        height: obj.position.height,
        rotation: obj.rotation ?? 0,
      },
      zIndex: 0,
      locked: obj.locked ?? false,
      printable: true,
    });
  }

  return {
    getObject: jest.fn((id: string) => objectMap.get(id)),
    computeObjectBounds: jest.fn((obj: any) => {
      if (!obj?.position) return null;
      return {
        x: obj.position.x ?? 0,
        y: obj.position.y ?? 0,
        width: obj.position.width ?? 100,
        height: obj.position.height ?? 100,
        rotation: obj.position.rotation ?? 0,
      };
    }),
    computeAllObjectBounds: jest.fn(async (_sheetId: string) => {
      const map = new Map();
      for (const [id, obj] of objectMap) {
        if ((obj as any)?.position) {
          const pos = (obj as any).position;
          map.set(id, {
            x: pos.x ?? 0,
            y: pos.y ?? 0,
            width: pos.width ?? 100,
            height: pos.height ?? 100,
            rotation: pos.rotation ?? 0,
          });
        }
      }
      return map;
    }),
    deleteObjects: jest.fn((ids: string[]) => {
      for (const id of ids) objectMap.delete(id);
    }),
    deleteObject: jest.fn((id: string) => {
      objectMap.delete(id);
    }),
    getObjectsInSheet: jest.fn((sheetId: string) =>
      Array.from(objectMap.values()).filter((o: any) => o.sheetId === sheetId),
    ),
    createPicture: jest.fn(),
    createTextBox: jest.fn(),
    createDrawing: jest.fn(),
    createEquation: jest.fn(),
    createDiagram: jest.fn(),
    updateObject: jest.fn(),
    getGroup: jest.fn(),
    getGroupsInSheet: jest.fn().mockReturnValue([]),
    groupObjects: jest.fn(),
    ungroupObjects: jest.fn(),
    bringToFront: jest.fn(),
    sendToBack: jest.fn(),
    bringForward: jest.fn(),
    sendBackward: jest.fn(),
    duplicateObject: jest.fn(),
    duplicateObjects: jest.fn(),
    moveObject: jest.fn(),
    moveObjectBy: jest.fn(),
    resizeObject: jest.fn(),
    rotateObject: jest.fn(),
    lockObject: jest.fn(),
    unlockObject: jest.fn(),
    getObjectCount: jest.fn().mockReturnValue(objectMap.size),
    hasObjects: jest.fn().mockReturnValue(objectMap.size > 0),
    setDocumentContext: jest.fn(),
    setPositionLookup: jest.fn(),
    on: jest.fn().mockReturnValue(() => {}),
    off: jest.fn(),
    emit: jest.fn(),
  } as unknown as IFloatingObjectManager;
}

function createInlineMockSheetViewObjects(objects: TestFloatingObject[] = []) {
  const boundsMap = new Map<
    string,
    { x: number; y: number; width: number; height: number; rotation: number }
  >();

  for (const obj of objects) {
    boundsMap.set(obj.id, {
      x: obj.position.x,
      y: obj.position.y,
      width: obj.position.width,
      height: obj.position.height,
      rotation: obj.rotation ?? 0,
    });
  }

  return {
    getBounds: jest.fn((objectId: string) => boundsMap.get(objectId) ?? null),
    updateTransientBounds: jest.fn(
      (
        objectId: string,
        bounds: { x: number; y: number; width: number; height: number; rotation: number },
      ) => {
        boundsMap.set(objectId, { ...bounds });
      },
    ),
    clearTransientBounds: jest.fn(),
    hitTest: jest.fn().mockReturnValue(null),
    getSceneObjectsByZOrder: jest.fn().mockReturnValue([]),
    getSceneObject: jest.fn().mockReturnValue(null),
    applyPatches: jest.fn(),
    resyncScene: jest.fn(),
    invalidate: jest.fn(),
  };
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a SheetSimulator that wires real system instances together.
 *
 * Mirrors SheetCoordinator construction but with mock dependencies
 * for headless testing. By default, creates grid + renderer systems.
 * Enable additional systems via the `systems` option.
 *
 * @example
 * const sim = createSheetSimulator({
 * systems: { grid: true, objects: true, renderer: true }
 * });
 * sim.start();
 *
 * // Grid selection deselects objects
 * sim.objects!.handleObjectMouseDown('obj-1', 'body', { x: 100, y: 100 }, false, false);
 * sim.objects!.handleObjectMouseUp({ x: 100, y: 100 });
 * expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toContain('obj-1');
 *
 * sim.grid.access.commands.selection.mouseDown({ row: 0, col: 0 }, false, false);
 * sim.grid.access.commands.selection.mouseUp();
 * expect(sim.objects!.getObjectInteractionSnapshot().selectedIds).toEqual([]);
 *
 * sim.destroy();
 */
export function createSheetSimulator(options?: SheetSimulatorOptions): SheetSimulator {
  const sheetConfig = options?.sheet ?? {};
  const sheetId = sheetConfig.sheetId ?? 'sheet-1';
  const systemFlags = {
    grid: options?.systems?.grid ?? true,
    renderer: options?.systems?.renderer ?? true,
    objects: options?.systems?.objects ?? false,
    input: options?.systems?.input ?? false,
    ink: options?.systems?.ink ?? false,
  };

  // -------------------------------------------------------------------------
  // 1. Shared infrastructure
  // -------------------------------------------------------------------------

  const { ctx } = createTestSheetContext(sheetConfig);
  const container = createMockContainerElement(800, 600);
  const coordSystem = createMockCoordinateSystem({ viewportWidth: 800, viewportHeight: 600 });
  const sheetSwitchDeps = createMockSheetSwitchDeps();

  // Invalidation spy
  const invalidations: Array<{ reason: string }> = [];

  // -------------------------------------------------------------------------
  // 2. Create systems conditionally
  // -------------------------------------------------------------------------

  let grid: IGridEditingSystem | undefined;
  let renderer: IRenderSystem | undefined;
  let objects: IObjectSystem | undefined;
  let input: IInputSystem | undefined;
  let ink: IInkSystem | undefined;

  // Grid (always created since it's the default)
  if (systemFlags.grid) {
    grid = new GridEditingSystem({
      initialSheetId: sheetId,
      getActiveSheetId: () => sheetId,
      workbook: ctx as any,
      uiStoreApi: sheetSwitchDeps.uiStoreApi,
    });
  }

  // Renderer
  if (systemFlags.renderer) {
    renderer = new RenderSystem({
      sheetSwitchDeps,
    });

    // Spy on invalidate() to track calls
    const origInvalidate = renderer.invalidate.bind(renderer);
    renderer.invalidate = (reason?: string) => {
      invalidations.push({ reason: reason ?? '' });
      origInvalidate(reason);
    };
  }

  // Objects
  if (systemFlags.objects) {
    const manager = createInlineMockIFloatingObjectManager(options?.objects ?? [], sheetId);
    const sheetViewObjects = createInlineMockSheetViewObjects(options?.objects ?? []);
    const hitTestService = createMockHitTestService();

    objects = new ObjectSystem({
      floatingObjects: manager as any,
      hitTestService,
      getCanvas: () => container as unknown as HTMLElement,
      getGeometry: () => null,
      getObjects: () => sheetViewObjects as any,
      getGridRenderer: () => null,
      mutations: {
        moveChart: jest.fn().mockReturnValue({ success: true }),
        resizeChart: jest.fn().mockReturnValue({ success: true }),
        moveObject: jest.fn().mockReturnValue({ success: true }),
        resizeObject: jest.fn().mockReturnValue({ success: true }),
        rotateObject: jest.fn().mockReturnValue({ success: true }),
      },
    });
  }

  // Input
  if (systemFlags.input) {
    input = new InputSystem({
      workbook: ctx as any,
      enableKeyboard: false, // keep keyboard coordination disabled for integration tests
      sheetSwitchDeps,
    });
  }

  // Ink
  if (systemFlags.ink) {
    ink = new InkSystem({
      getCanvas: () => container as unknown as HTMLElement,
      getGeometry: () => null,
      getDrawingOffset: () => ({ x: 0, y: 0 }),
      userId: 'test-user',
    });
  }

  // -------------------------------------------------------------------------
  // 3. Wiring state (initialized on start)
  // -------------------------------------------------------------------------

  let wiringCleanup: (() => void) | null = null;
  let focusActor: ReturnType<typeof createMockFocusActor> | null = null;
  let started = false;

  // -------------------------------------------------------------------------
  // 4. Build simulator
  // -------------------------------------------------------------------------

  const simulator: SheetSimulator = {
    start() {
      if (started) return;

      // Start systems in dependency order (mirrors SheetCoordinator)
      grid?.start();
      renderer?.start();
      objects?.start();

      // Focus actor for input system
      if (input) {
        focusActor = createMockFocusActor();
        input.setFocusActor(focusActor);
        input.start();
      }

      ink?.start();

      // Auto-ready renderer (mount + layoutReady + rendererInitialized)
      if (renderer) {
        renderer.mount(container as unknown as HTMLElement);
        renderer.layoutReady(800, 600);
        renderer.rendererInitialized(sheetId);
      }

      // Wire cross-system events (same as SheetCoordinator.wireCrossSystemEvents)
      const wiring = wireSystemsForTest({ grid, input, renderer, objects, ink });
      wiringCleanup = wiring.cleanup;

      started = true;
    },

    async flush() {
      await Promise.resolve();
    },

    destroy() {
      if (!started) return;

      // Clean up cross-system wiring
      wiringCleanup?.();
      wiringCleanup = null;

      // Stop focus actor
      focusActor?.stop();
      focusActor = null;

      // Dispose in reverse creation order (mirrors SheetCoordinator.dispose)
      ink?.dispose();
      input?.dispose();
      objects?.dispose();
      renderer?.dispose();
      grid?.dispose();

      started = false;
    },

    // System access (grid is guaranteed by default, others are optional)
    get grid(): IGridEditingSystem {
      if (!grid) throw new Error('Grid system not enabled in SheetSimulator options');
      return grid;
    },

    get renderer(): IRenderSystem | undefined {
      return renderer;
    },

    get objects(): IObjectSystem | undefined {
      return objects;
    },

    get input(): IInputSystem | undefined {
      return input;
    },

    get ink(): IInkSystem | undefined {
      return ink;
    },

    // Pointer dispatch
    pointerUp() {
      dispatchPointerUp({ grid, objects, renderer, ink, input });
    },

    pointerCancel() {
      dispatchPointerCancel({ grid, objects, renderer, ink, input });
    },

    // Invalidation tracking
    getInvalidations(): Array<{ reason: string }> {
      return [...invalidations];
    },

    clearInvalidations() {
      invalidations.length = 0;
    },
  };

  return simulator;
}

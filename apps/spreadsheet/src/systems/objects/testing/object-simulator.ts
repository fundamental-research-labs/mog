/**
 * Object System Simulator
 *
 * Wraps a real ObjectSystem with mocked dependencies and ergonomic helpers.
 * Implements the SystemSimulator protocol for consistent test lifecycle.
 *
 * Architecture:
 * - Creates a REAL ObjectSystem instance (not a mock)
 * - Injects mock dependencies for headless testing
 * - Ergonomic helpers delegate to real system methods (documented 1:1)
 * - MockFloatingObjectManager tracks mutations for assertions
 *
 * @see SYSTEM-TESTING-HARNESS.md
 * @module systems/objects/testing
 */

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type { ObjectHitRegion } from '@mog-sdk/contracts/floating-objects';
import type { ObjectBounds } from '@mog-sdk/contracts/rendering';
import type { Point } from '@mog-sdk/contracts/viewport';
import type { ISheetViewObjects, ObjectBounds as SheetViewObjectBounds } from '@mog-sdk/sheet-view';
import { jest } from '@jest/globals';
import { createMockCoordinateSystem } from '../../testing-foundation/mock-coordinate-system';
import {
  createMockContainerElement,
  createMockHitTestService,
} from '../../testing-foundation/mock-dependencies';
import {
  createTestSheetContext,
  type TestSheetConfig,
} from '../../testing-foundation/test-sheet-context';
import type { SystemSimulator } from '../../testing-foundation/types';
import type { ObjectHitResult } from '../coordination/object-coordination';
import { ObjectSystem } from '../object-system';
import type { EffectiveObjectState, IObjectSystem, ObjectInteractionSnapshot } from '../types';

// =============================================================================
// TEST FLOATING OBJECT DEFINITION
// =============================================================================

/**
 * Simplified floating object definition for tests.
 * The simulator builds full FloatingObject-compatible mock objects from these.
 */
export interface TestFloatingObject {
  id: string;
  type: 'chart' | 'image' | 'shape' | 'diagram';
  sheetId?: string;
  position: { x: number; y: number; width: number; height: number };
  rotation?: number;
  locked?: boolean;
}

// =============================================================================
// MUTATION LOG
// =============================================================================

/**
 * Recorded mutation from the MockFloatingObjectManager.
 */
export interface ObjectMutation {
  type: 'delete' | 'update';
  objectIds?: string[];
  objectId?: string;
  changes?: Record<string, unknown>;
}

// =============================================================================
// MOCK FLOATING OBJECT MANAGER
// =============================================================================

/**
 * Map-backed FloatingObjectManager mock.
 *
 * Implements the subset of FloatingObjectManager that ObjectSystem and
 * setupObjectCoordination actually call:
 * - getObject(id): return from internal map
 * - computeObjectBounds(obj): compute bounds from position (returns Promise)
 * - deleteObjects(ids): remove from map + log mutation
 *
 * All other methods are jest.fn() stubs that return sensible defaults.
 */
function createMockFloatingObjectManager(
  objects: TestFloatingObject[] = [],
  defaultSheetId: string = 'sheet-1',
): { manager: IFloatingObjectManager; mutations: ObjectMutation[]; clearMutations: () => void } {
  const mutations: ObjectMutation[] = [];
  const objectMap = new Map<string, any>();

  // Populate map with test objects converted to FloatingObject-compatible shapes
  for (const obj of objects) {
    const floatingObj = {
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
    };
    objectMap.set(obj.id, floatingObj);
  }

  // Build the mock manager. Only the methods actually called by ObjectSystem
  // and setupObjectCoordination have real implementations.
  const manager = {
    getObject: jest.fn((id: string) => objectMap.get(id)),

    computeObjectBounds: jest.fn(async (obj: any): Promise<ObjectBounds | null> => {
      if (!obj?.position) return null;
      return {
        x: obj.position.x ?? 0,
        y: obj.position.y ?? 0,
        width: obj.position.width ?? 100,
        height: obj.position.height ?? 100,
        rotation: obj.position.rotation ?? 0,
      };
    }),

    computeAllObjectBounds: jest.fn(
      async (_sheetId: string): Promise<Map<string, ObjectBounds>> => {
        const map = new Map<string, ObjectBounds>();
        for (const [id, obj] of objectMap) {
          if (obj?.position) {
            map.set(id, {
              x: obj.position.x ?? 0,
              y: obj.position.y ?? 0,
              width: obj.position.width ?? 100,
              height: obj.position.height ?? 100,
              rotation: obj.position.rotation ?? 0,
            });
          }
        }
        return map;
      },
    ),

    deleteObjects: jest.fn((ids: string[]) => {
      mutations.push({ type: 'delete', objectIds: [...ids] });
      for (const id of ids) {
        objectMap.delete(id);
      }
    }),

    deleteObject: jest.fn((id: string) => {
      mutations.push({ type: 'delete', objectIds: [id] });
      objectMap.delete(id);
    }),

    // Stubs for other methods that may be called but aren't critical for tests
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

  return {
    manager,
    mutations,
    clearMutations: () => {
      mutations.length = 0;
    },
  };
}

// =============================================================================
// SIMULATOR OPTIONS
// =============================================================================

export interface ObjectSimulatorOptions {
  /** Sheet configuration for test context */
  sheet?: TestSheetConfig;
  /** Initial floating objects to populate */
  objects?: TestFloatingObject[];
  /** Viewport dimensions (default: 800x600) */
  viewport?: { width: number; height: number };
  /** Optional grid renderer override (default: () => null) */
  getGridRenderer?: () => any;
  /** Optional SheetView object scene capability override */
  getObjects?: () => ISheetViewObjects | null;
}

function createMockSheetViewObjects(objects: TestFloatingObject[]): ISheetViewObjects {
  const boundsMap = new Map<string, SheetViewObjectBounds>();
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
    hitTest: jest.fn().mockReturnValue(null),
    getBounds: jest.fn((objectId: string) => boundsMap.get(objectId) ?? null),
    getSceneObjectsByZOrder: jest.fn().mockReturnValue([]),
    getSceneObject: jest.fn().mockReturnValue(null),
    applyPatches: jest.fn(),
    updateTransientBounds: jest.fn((objectId: string, bounds: SheetViewObjectBounds) => {
      boundsMap.set(objectId, { ...bounds });
    }),
    clearTransientBounds: jest.fn((objectId?: string) => {
      if (objectId) boundsMap.delete(objectId);
    }),
    resyncScene: jest.fn(),
    invalidate: jest.fn(),
  };
}

// =============================================================================
// SIMULATOR INTERFACE
// =============================================================================

export interface ObjectSimulator extends SystemSimulator<IObjectSystem, ObjectInteractionSnapshot> {
  // -- Ergonomic helpers (call real system methods underneath) --

  /** Click an object. Calls handleObjectMouseDown + handleObjectMouseUp. */
  clickObject(objectId: string, region?: ObjectHitRegion): void;

  /** Shift-click to add to selection. Calls handleObjectMouseDown(id, 'body', pos, true, false) + mouseUp. */
  shiftClickObject(objectId: string): void;

  /** Start drag. Calls handleObjectMouseDown then handleObjectMouseMove for first move. */
  startDrag(objectId: string, startPos: Point): void;

  /** Continue drag. Calls handleObjectMouseMove. */
  dragTo(pos: Point): void;

  /** Deselect all. Calls system.deselectAllObjects(). */
  deselectAll(): void;

  /** Delete selected. Calls system.deleteSelectedObjects(). */
  deleteSelected(): void;

  // -- Hit testing (delegates to system) --
  hitTestFloatingObject(sheetId: string, x: number, y: number): ObjectHitResult | null;

  // -- State queries (delegates to system) --

  /** Returns selectedIds from system.getObjectInteractionSnapshot(). */
  selectedObjectIds(): string[];

  /** Delegates to system.getEffectiveObjectState(objectId). */
  getEffectiveObjectState(objectId: string): Promise<EffectiveObjectState | null>;

  /** Delegates to system.isObjectInOperation(objectId). */
  isObjectInOperation(objectId: string): boolean;

  // -- Cross-system event helpers --

  /** Simulate grid selecting a cell (calls system.notifyExternalSelectionActive). */
  notifyGridSelectionActive(): void;

  // -- Mutation log (from MockFloatingObjectManager) --
  getMutationLog(): ObjectMutation[];
  clearMutationLog(): void;

  // -- Mock mutation functions access --
  readonly mockMutations: {
    moveChart: jest.Mock;
    resizeChart: jest.Mock;
    moveObject: jest.Mock;
    resizeObject: jest.Mock;
    rotateObject: jest.Mock;
  };
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create an ObjectSimulator wrapping a real ObjectSystem with mocked dependencies.
 *
 * Dependency assembly (owned by the simulator):
 * 1. createTestSheetContext() -> test context (from foundation)
 * 2. createMockCoordinateSystem() -> for getCoordinateSystem() getter (from foundation)
 * 3. createMockFloatingObjectManager(options.objects) -> object CRUD + mutation log
 * 4. createMockHitTestService() -> outline hit testing (from foundation)
 * 5. createMockContainerElement() -> for getCanvas() getter (from foundation)
 * 6. Mock mutations config (objects-specific)
 */
export function createObjectSimulator(options?: ObjectSimulatorOptions): ObjectSimulator {
  const sheetConfig = options?.sheet ?? {};
  const vpWidth = options?.viewport?.width ?? 800;
  const vpHeight = options?.viewport?.height ?? 600;
  const sheetId = sheetConfig.sheetId ?? 'sheet-1';

  // 1. Test sheet context
  createTestSheetContext(sheetConfig);

  // 2. Mock coordinate system
  const coordSystem = createMockCoordinateSystem({
    viewportWidth: vpWidth,
    viewportHeight: vpHeight,
  });

  // 3. Mock floating object manager
  const { manager, mutations, clearMutations } = createMockFloatingObjectManager(
    options?.objects ?? [],
    sheetId,
  );

  // 4. Mock hit test service
  const hitTestService = createMockHitTestService();

  // 5. Mock container element
  const container = createMockContainerElement(vpWidth, vpHeight);

  // 6. Mock mutation callbacks
  const mockMutations = {
    moveChart: jest.fn().mockReturnValue({ success: true }),
    resizeChart: jest.fn().mockReturnValue({ success: true }),
    moveObject: jest.fn().mockReturnValue({ success: true }),
    resizeObject: jest.fn().mockReturnValue({ success: true }),
    rotateObject: jest.fn().mockReturnValue({ success: true }),
  };
  const defaultSheetViewObjects = createMockSheetViewObjects(options?.objects ?? []);
  const getSheetViewObjects = options?.getObjects ?? (() => defaultSheetViewObjects);
  const charts = (options?.objects ?? [])
    .filter((obj) => obj.type === 'chart')
    .map((obj) => ({ id: obj.id }));
  const mockWorksheet = {
    sheetId,
    charts: {
      get: jest.fn().mockImplementation(async (id: string) => {
        return charts.find((chart) => chart.id === id) ?? null;
      }),
      list: jest.fn().mockResolvedValue(charts),
    },
  };

  // Build the real ObjectSystem
  const system = new ObjectSystem({
    floatingObjects: manager as any,
    hitTestService,
    getCanvas: () => container as unknown as HTMLElement,
    getGeometry: () => null,
    getObjects: getSheetViewObjects,
    getGridRenderer: options?.getGridRenderer ?? (() => null),
    mutations: mockMutations,
    workbook: {
      activeSheet: mockWorksheet,
      getSheetById: jest.fn().mockReturnValue(mockWorksheet),
    } as any,
  });

  let started = false;

  // Build the simulator
  const simulator: ObjectSimulator = {
    // -- SystemSimulator protocol --

    start(): void {
      if (started) return;
      system.start();
      started = true;
    },

    flush(): void {
      // XState v5 processes send() synchronously.
      // No async flush needed for single-system tests.
    },

    destroy(): void {
      system.dispose();
      started = false;
    },

    snapshot(): ObjectInteractionSnapshot {
      return system.getObjectInteractionSnapshot();
    },

    get system(): IObjectSystem {
      return system;
    },

    endDrag(): void {
      system.dragTerminator.endDrag();
    },

    cancelDrag(): void {
      system.dragTerminator.cancelDrag();
    },

    // -- Ergonomic helpers --

    clickObject(objectId: string, region: ObjectHitRegion = 'body'): void {
      const pos: Point = { x: 100, y: 100 };
      system.handleObjectMouseDown(objectId, region, pos, false, false);
      system.handleObjectMouseUp(pos);
    },

    shiftClickObject(objectId: string): void {
      const pos: Point = { x: 100, y: 100 };
      system.handleObjectMouseDown(objectId, 'body', pos, true, false);
      system.handleObjectMouseUp(pos);
    },

    startDrag(objectId: string, startPos: Point): void {
      system.handleObjectMouseDown(objectId, 'body', startPos, false, false);
      // First move to enter operating state
      system.handleObjectMouseMove({ x: startPos.x + 1, y: startPos.y + 1 }, false);
    },

    dragTo(pos: Point): void {
      system.handleObjectMouseMove(pos, false);
    },

    deselectAll(): void {
      system.deselectAllObjects();
    },

    deleteSelected(): void {
      system.deleteSelectedObjects();
    },

    // -- Hit testing --

    hitTestFloatingObject(sheetId: string, x: number, y: number): ObjectHitResult | null {
      return system.hitTestFloatingObject(sheetId, x, y);
    },

    // -- State queries --

    selectedObjectIds(): string[] {
      return system.getObjectInteractionSnapshot().selectedIds;
    },

    async getEffectiveObjectState(objectId: string): Promise<EffectiveObjectState | null> {
      return system.getEffectiveObjectState(objectId);
    },

    isObjectInOperation(objectId: string): boolean {
      return system.isObjectInOperation(objectId);
    },

    // -- Cross-system --

    notifyGridSelectionActive(): void {
      system.notifyExternalSelectionActive();
    },

    // -- Mutation log --

    getMutationLog(): ObjectMutation[] {
      return [...mutations];
    },

    clearMutationLog(): void {
      clearMutations();
    },

    // -- Mock mutations access --
    mockMutations,
  };

  return simulator;
}

/**
 * ObjectSystem
 *
 * Unified system for floating object interactions.
 * Owns object, chart, and Diagram actors and coordinates all object operations.
 *
 * Architecture:
 * - Creates and owns objectInteraction, chart, diagram actors internally
 * - Builds ObjectActorAccess from internal actors
 * - Wires ObjectCoordination for hit testing, mouse events, operations
 * - Wires EffectiveStateService for 60fps rendering during operations
 * - Implements FloatingObjectCoordinator interface (isInkActive)
 * - Implements DragTerminator for pointer-up coordination
 *
 * PHILOSOPHY: No slow migrations. Build the RIGHT solution.
 *
 */

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type {
  ChartAccessor,
  ChartCommands,
  ObjectAccessor,
  ObjectCommands,
  DiagramAccessor,
  DiagramCommands,
} from '@mog-sdk/contracts/actors';
import { chartSelectors, objectSelectors, diagramSelectors } from '../../selectors';
import type { Workbook } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ObjectHitRegion } from '@mog-sdk/contracts/floating-objects';
import type { GroupingData, OutlineHitTestResult } from '@mog-sdk/contracts/rendering';
import type { Point } from '@mog-sdk/contracts/viewport';
import { createActor, type InspectionEvent } from 'xstate';
import type { DragTerminator } from '../shared/drag-terminator';
import {
  createChartAccessor,
  createChartCommands,
  createObjectAccessor,
  createObjectCommands,
  createDiagramAccessor,
  createDiagramCommands,
} from './actor-access';
import type {
  EffectiveObjectState,
  EffectiveStateService,
} from './coordination/effective-state-service';
import { setupChartCoordination } from './coordination/chart-coordination';
import {
  setupObjectCoordination,
  type ObjectCoordinationResult,
  type ObjectHitResult,
} from './coordination/object-coordination';
import { chartMachine, getChartSnapshot, type ChartActor } from './machines/chart-machine';
import {
  getObjectInteractionSnapshot,
  objectInteractionMachine,
  type ObjectInteractionActor,
} from './machines/object-interaction-machine';
import { diagramMachine, type DiagramActor } from './machines/diagram-machine';
import type {
  ChartUISnapshot,
  IObjectSystem,
  ObjectActorAccess,
  ObjectInteractionSnapshot,
  ObjectSystemConfig,
} from './types';

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * ObjectSystem implementation.
 *
 * Owns floating object interactions, hit testing, and effective state during operations.
 * Creates and manages object/chart/Diagram actors internally.
 */
export class ObjectSystem implements IObjectSystem {
  // ---------------------------------------------------------------------------
  // Internal actors (owned by this system)
  // ---------------------------------------------------------------------------
  private readonly objectActor: ObjectInteractionActor;
  private readonly chartActor: ChartActor;
  private readonly diagramActor: DiagramActor;

  // ---------------------------------------------------------------------------
  // Internal accessors and commands (built from actors)
  // ---------------------------------------------------------------------------
  private readonly objectAccessor: ObjectAccessor;
  private readonly objectCommands: ObjectCommands;
  private readonly chartAccessor: ChartAccessor;
  private readonly chartCommands: ChartCommands;
  private readonly diagramAccessor: DiagramAccessor;
  private readonly diagramCommands: DiagramCommands;

  // ---------------------------------------------------------------------------
  // Internal coordination (wired from ObjectCoordination)
  // ---------------------------------------------------------------------------
  private coordination: ObjectCoordinationResult | null = null;
  private chartCoordinationCleanup: (() => void) | null = null;
  private effectiveState: EffectiveStateService | null = null;

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  private readonly config: ObjectSystemConfig;
  private readonly floatingObjects: IFloatingObjectManager | null;

  // ---------------------------------------------------------------------------
  // State tracking
  // ---------------------------------------------------------------------------
  private started = false;
  private disposed = false;
  private readonly subscriptions: Array<() => void> = [];
  private readonly stateChangeCallbacks: Set<() => void> = new Set();
  private readonly objectSelectionActiveCallbacks: Set<() => void> = new Set();

  // ===========================================================================
  // PUBLIC: Actor Access Layer
  // ===========================================================================

  readonly access: ObjectActorAccess;

  // ===========================================================================
  // PUBLIC: DragTerminator
  // ===========================================================================

  /**
   * DragTerminator for pointer-up coordination.
   *
   * Checks the object interaction actor state and sends the appropriate
   * completion/cancellation events. The coordinator calls this on pointer-up
   * without needing to know machine state details.
   */
  readonly dragTerminator: DragTerminator = {
    endDrag: () => {
      if (!this.started || this.disposed) return;
      const isOperating = this.objectAccessor.isOperating();
      if (isOperating) {
        this.objectCommands.completeOperation();
      }
    },
    cancelDrag: () => {
      if (!this.started || this.disposed) return;
      const isOperating = this.objectAccessor.isOperating();
      if (isOperating) {
        this.objectCommands.cancelOperation();
        return;
      }
      if (this.objectAccessor.isInserting()) {
        this.objectCommands.cancelInsert();
      }
    },
  };

  // ===========================================================================
  // CONSTRUCTOR
  // ===========================================================================

  constructor(config: ObjectSystemConfig) {
    this.config = config;
    this.floatingObjects = config.floatingObjects ?? null;

    // -------------------------------------------------------------------------
    // 1. Create actors (with devtools inspection so __dt.getMachineStates() sees them)
    // -------------------------------------------------------------------------
    const inspect = (evt: InspectionEvent) => {
      // Use actorRef.id (the logical name from { id: '...' } option) so that
      // getMachineStates() is keyed by 'chart'/'objectInteraction'/'diagram',
      // not by the auto-generated sessionId ('x:N').
      const actorRef = (evt as any).actorRef as { id?: string; sessionId?: string } | undefined;
      const actorId = actorRef?.id ?? actorRef?.sessionId;
      if (actorId) (window as any).__OS_DEVTOOLS__?.reportActor?.(actorId, evt);
    };
    this.objectActor = createActor(objectInteractionMachine, { id: 'objectInteraction', inspect });
    this.chartActor = createActor(chartMachine, { id: 'chart', inspect });
    this.diagramActor = createActor(diagramMachine, { id: 'diagram', inspect });

    // -------------------------------------------------------------------------
    // 2. Build accessors and commands from actors
    // -------------------------------------------------------------------------
    this.objectAccessor = createObjectAccessor(this.objectActor);
    this.objectCommands = createObjectCommands(this.objectActor);
    this.chartAccessor = createChartAccessor(this.chartActor);
    this.chartCommands = createChartCommands(this.chartActor);
    this.diagramAccessor = createDiagramAccessor(this.diagramActor);
    this.diagramCommands = createDiagramCommands(this.diagramActor);

    // -------------------------------------------------------------------------
    // 3. Build the public actor access layer
    // -------------------------------------------------------------------------
    this.access = {
      accessors: {
        object: this.objectAccessor,
        chart: this.chartAccessor,
        diagram: this.diagramAccessor,
      },
      commands: {
        object: this.objectCommands,
        chart: this.chartCommands,
        diagram: this.diagramCommands,
      },
      selectors: {
        object: objectSelectors,
        chart: chartSelectors,
        diagram: diagramSelectors,
      },
      actors: {
        object: this.objectActor,
        chart: this.chartActor,
        diagram: this.diagramActor,
      },
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  start(): void {
    if (this.disposed) {
      throw new Error('ObjectSystem: Cannot start after dispose. Create a new instance.');
    }
    if (this.started) return;

    // Start actors
    this.objectActor.start();
    this.chartActor.start();
    this.diagramActor.start();

    // Wire ObjectCoordination (needs actors to be started)
    this.coordination = setupObjectCoordination({
      objectInteractionActor: this.objectActor,
      selectionActor: null as never, // Selection coordination is handled externally
      floatingObjects: this.floatingObjects,
      getCanvas: this.config.getCanvas,
      getGeometry: this.config.getGeometry,
      getObjects: this.config.getObjects,
      getGridRenderer: this.config.getGridRenderer,
      hitTestService: this.config.hitTestService,
      accessors: this.objectAccessor,
      commands: this.objectCommands,
      getWorkbook: () => (this.config.workbook as Workbook) ?? null,
      mutations: this.config.mutations,
    });

    this.effectiveState = this.coordination.effectiveStateService;

    // Wire chart coordination: syncs objectInteraction selection → chartActor
    // so the chart machine receives SYNC_SELECTION when charts are selected.
    if (this.config.workbook) {
      const chartCoord = setupChartCoordination({
        chartActor: this.chartActor,
        selectionActor: null as never, // unused — kept for API stability
        objectInteractionActor: this.objectActor,
        workbook: this.config.workbook as Workbook,
      });
      this.chartCoordinationCleanup = chartCoord.cleanup;
    }

    // Subscribe to actor state changes for external notification
    const objectSub = this.objectActor.subscribe(() => {
      this.notifyStateChange();
    });
    this.subscriptions.push(() => objectSub.unsubscribe());

    const chartSub = this.chartActor.subscribe(() => {
      this.notifyStateChange();
    });
    this.subscriptions.push(() => chartSub.unsubscribe());

    const diagramSub = this.diagramActor.subscribe(() => {
      this.notifyStateChange();
    });
    this.subscriptions.push(() => diagramSub.unsubscribe());

    // Track object selection becoming active for cross-system coordination
    let prevHadSelection = false;
    const selectionTrackSub = this.objectActor.subscribe(() => {
      const hasSelection = this.objectAccessor.hasSelection();
      if (hasSelection && !prevHadSelection) {
        this.notifyObjectSelectionActive();
      }
      prevHadSelection = hasSelection;
    });
    this.subscriptions.push(() => selectionTrackSub.unsubscribe());

    this.started = true;
  }

  dispose(): void {
    if (this.disposed) return;

    // Clean up coordination
    this.coordination?.cleanup();
    this.coordination = null;
    this.chartCoordinationCleanup?.();
    this.chartCoordinationCleanup = null;
    this.effectiveState = null;

    // Unsubscribe all
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions.length = 0;

    // Clear callbacks
    this.stateChangeCallbacks.clear();
    this.objectSelectionActiveCallbacks.clear();

    // Stop actors in reverse order
    this.diagramActor.stop();
    this.chartActor.stop();
    this.objectActor.stop();

    this.disposed = true;
  }

  // ===========================================================================
  // HIT TESTING
  // ===========================================================================

  hitTestFloatingObject(sheetId: string, x: number, y: number): ObjectHitResult | null {
    return this.coordination?.hitTestFloatingObject(toSheetId(sheetId), x, y) ?? null;
  }

  hitTestOutline(x: number, y: number): OutlineHitTestResult | null {
    return this.coordination?.hitTestOutline(x, y) ?? null;
  }

  // ===========================================================================
  // OBJECT INTERACTION
  // ===========================================================================

  handleObjectMouseDown(
    objectId: string,
    region: ObjectHitRegion,
    pos: Point,
    shift: boolean,
    ctrl: boolean,
  ): void {
    this.coordination?.handleMouseDown(objectId, region, pos, shift, ctrl);
  }

  handleObjectMouseMove(pos: Point, shiftKey: boolean): void {
    this.coordination?.handleMouseMove(pos, shiftKey);
  }

  handleObjectMouseUp(pos: Point): void {
    this.coordination?.handleMouseUp(pos);
  }

  deleteSelectedObjects(): void {
    this.coordination?.deleteSelectedObjects();
  }

  deselectAllObjects(): void {
    this.coordination?.deselectAllObjects();
  }

  // ===========================================================================
  // EFFECTIVE STATE (60fps rendering during operations)
  // ===========================================================================

  async getEffectiveObjectState(objectId: string): Promise<EffectiveObjectState | null> {
    return (await this.effectiveState?.getEffectiveState(objectId)) ?? null;
  }

  async getAffectedEffectiveStates(): Promise<Map<string, EffectiveObjectState>> {
    return (await this.effectiveState?.getAffectedEffectiveStates()) ?? new Map();
  }

  isObjectInOperation(objectId: string): boolean {
    return this.effectiveState?.isObjectInOperation(objectId) ?? false;
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  setGroupingDataGetter(getter: () => GroupingData): void {
    this.coordination?.setGroupingDataGetter(getter);
  }

  // ===========================================================================
  // SNAPSHOTS (debugging and testing)
  // ===========================================================================

  getObjectInteractionSnapshot(): ObjectInteractionSnapshot {
    const snapshot = getObjectInteractionSnapshot(this.objectActor.getSnapshot());
    return {
      state: snapshot.interactionState,
      selectedIds: snapshot.selectedIds,
      isOperating: snapshot.isOperating,
      activeHandle: snapshot.activeHandle,
      shiftKey: snapshot.shiftKey,
      insertStartPosition: snapshot.insertStartPosition,
      insertCurrentPosition: snapshot.insertCurrentPosition,
    };
  }

  getChartUISnapshot(): ChartUISnapshot {
    const snapshot = getChartSnapshot(this.chartActor.getSnapshot());
    return {
      state: snapshot.state,
      selectedChartId: snapshot.selectedChartId,
      selectedElementType: snapshot.selectedElement,
      isEditing: snapshot.isEditing,
    };
  }

  // ===========================================================================
  // FLOATING OBJECT COORDINATOR INTERFACE
  // ===========================================================================

  isInkActive(): boolean {
    // ObjectSystem does not own ink mode - always returns false.
    // The ink system (when it exists) will manage its own state.
    return false;
  }

  // ===========================================================================
  // CROSS-SYSTEM COORDINATION
  // ===========================================================================

  notifyExternalSelectionActive(): void {
    // Deselect all objects when external selection becomes active
    if (this.objectAccessor.hasSelection()) {
      this.objectCommands.deselectAll();
    }
    // Also notify chart and Diagram
    this.chartCommands.deselectAll();
    this.diagramCommands.deselect();
  }

  onObjectSelectionActive(callback: () => void): () => void {
    this.objectSelectionActiveCallbacks.add(callback);
    return () => {
      this.objectSelectionActiveCallbacks.delete(callback);
    };
  }

  onStateChange(callback: () => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => {
      this.stateChangeCallbacks.delete(callback);
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private notifyStateChange(): void {
    for (const callback of this.stateChangeCallbacks) {
      callback();
    }
  }

  private notifyObjectSelectionActive(): void {
    for (const callback of this.objectSelectionActiveCallbacks) {
      callback();
    }
  }
}

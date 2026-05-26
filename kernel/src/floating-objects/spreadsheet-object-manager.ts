/**
 * Spreadsheet Object Manager
 *
 * Spreadsheet-specific floating object service. Delegates spatial operations
 * (move, resize, rotate, z-order, delete, duplicate) to SpreadsheetObjectMutator,
 * CRUD to ComputeBridgeObjectStore, and grouping to core/grouping functions.
 *
 * Also provides:
 * - Chart, Equation, Diagram, OLE object creation
 * - Viewport/range-based queries using cell coordinates via ComputeBridge
 *
 * @see ./spreadsheet-object-mutator.ts - Spatial operations via Rust
 * @see ./object-store.ts - IObjectStore<FloatingObject> backed by ComputeBridge
 * @see ./spreadsheet/ - Spreadsheet-specific managers
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type {
  CreateEquationOptions,
  CreateDiagramOptions,
  CreateTextBoxOptions,
  CreateTextEffectOptions,
  EquationObject,
  FloatingObject,
  FloatingObjectKind,
  ObjectPosition,
  PictureObject,
  DiagramObject,
  TextBoxObject,
} from '@mog-sdk/contracts/floating-objects';
import type {
  CanvasObjectPosition,
  ICanvasEventBus,
} from '@mog-sdk/contracts/objects/canvas-object';
import type { TextEffectConfig, TextEffectConfigUpdate } from '@mog-sdk/contracts/text-effects';

import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import type { DocumentContext } from '../context/types';
import { FloatingObjectError } from '../errors/floating-object';
import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';

import type { ObjectBounds } from './types';

import { getNextZIndex as getNextZIndexAsync, type ZOrderDeps } from './core/z-order';
import {
  groupObjects as coreGroupObjects,
  ungroupObjects as coreUngroupObjects,
  getGroup,
} from './core/grouping';
import { emitGroupCreated, emitGroupDeleted } from './core/events';
import { ComputeBridgeGroupStore, ComputeBridgeObjectStore } from './object-store';
import { SpreadsheetObjectMutator } from './spreadsheet-object-mutator';

import { computeObjectBounds as computeObjectBoundsStandalone } from './spreadsheet/cell-anchor-resolver';

// Type-specific creation managers
// Note: Drawing objects are properly deserialized by the floating-object-mapper
// (toDrawingObject converts Record→Map).
import { createPicture as createPictureOp } from './managers/picture-manager';
import {
  asTextBoxWithTextEffect,
  createTextBox as createTextBoxOp,
  type TextBoxDependencies,
} from './managers/textbox-manager';
import {
  asEquationObject,
  createEquation as createEquationOp,
  updateEquationOmml as updateEquationOmmlOp,
  updateEquation as updateEquationOp,
} from '../domain/equations/equation-manager';
import {
  createDiagram as createDiagramOp,
  deserializeDiagram,
} from '../domain/diagram/diagram-manager';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies for the SpreadsheetObjectManager.
 */
export interface SpreadsheetObjectManagerDeps {
  /** ComputeBridge for Rust/Yrs storage access */
  computeBridge: ComputeBridge;
  /** Event bus for emitting canvas object events */
  eventBus: ICanvasEventBus;
}

// =============================================================================
// HELPERS
// =============================================================================

let objectIdCounter = 0;

function generateObjectId(): string {
  return `obj-${Date.now()}-${++objectIdCounter}`;
}

// =============================================================================
// TYPE-SPECIFIC DESERIALIZATION
// =============================================================================

/**
 * Apply type-specific deserialization to a raw floating object from the store.
 *
 * Objects stored in Rust/Yrs are plain JSON. Some types (drawing, diagram,
 * equation, textbox) need runtime deserialization to reconstruct their full
 * typed representations. This function is the single source of truth for that
 * transformation — used by both getObject() and getObjectsInSheet().
 *
 * @returns The deserialized object, or null if it should be filtered out.
 */
function deserializeFloatingObject(raw: FloatingObject): FloatingObject | null {
  switch (raw.type) {
    case 'drawing':
      // Drawing objects are already properly deserialized by the mapper
      // (toDrawingObject in floating-object-mapper.ts converts Record→Map).
      return raw;
    case 'diagram':
      return deserializeDiagram(raw) ?? null;
    case 'equation':
      return asEquationObject(raw);
    case 'textbox':
      return asTextBoxWithTextEffect(raw);
    default:
      // Skip internal storage objects
      if ('_storageType' in raw) return null;
      return raw;
  }
}

// =============================================================================
// SPREADSHEET OBJECT MANAGER
// =============================================================================

/**
 * Spreadsheet-specific Object Manager.
 *
 * Delegates spatial operations to SpreadsheetObjectMutator, CRUD to
 * ComputeBridgeObjectStore, and grouping to core/grouping functions directly.
 */
export class SpreadsheetObjectManager implements IFloatingObjectManager {
  /** ComputeBridge for direct Rust/Yrs access */
  private computeBridge: ComputeBridge;

  /** Store context for accessing domain modules (Charts, etc.) */
  private documentContext: DocumentContext | null = null;

  /** Event bus reference */
  private eventBus: ICanvasEventBus;

  /** The underlying object store */
  private objectStore: ComputeBridgeObjectStore;

  /** The underlying group store */
  private groupStore: ComputeBridgeGroupStore;

  /** Kernel-internal mutator for spatial operations via ComputeBridge */
  private mutator: SpreadsheetObjectMutator;

  /** Counter for generating unique object names per type */
  private objectCounters: Map<FloatingObjectKind, number> = new Map();

  constructor(deps: SpreadsheetObjectManagerDeps) {
    this.computeBridge = deps.computeBridge;
    this.eventBus = deps.eventBus;

    // Create stores
    this.objectStore = new ComputeBridgeObjectStore(deps.computeBridge);
    this.groupStore = new ComputeBridgeGroupStore(deps.computeBridge);

    // Create the mutator for spatial operations
    this.mutator = new SpreadsheetObjectMutator(deps.computeBridge, this.objectStore);
  }

  /**
   * Generate a unique name for a new object of the given type.
   */
  private generateObjectName(type: FloatingObjectKind): string {
    const count = (this.objectCounters.get(type) ?? 0) + 1;
    this.objectCounters.set(type, count);
    return `${type} ${count}`;
  }

  // ===========================================================================
  // ASYNC READ OPERATIONS
  // ===========================================================================

  /**
   * Get a floating object by ID.
   * Reads from ComputeBridgeObjectStore, then applies type-specific deserialization.
   */
  async getObject(objectId: string): Promise<FloatingObject | undefined> {
    const result = await this.objectStore.read(objectId);
    const raw = result.object;
    if (!raw) return undefined;
    return deserializeFloatingObject(raw) ?? undefined;
  }

  /**
   * Get all floating objects in a sheet.
   * Returns objects sorted by zIndex, with type-specific deserialization applied.
   */
  async getObjectsInSheet(sheetId: SheetId): Promise<FloatingObject[]> {
    const rawObjects = await this.objectStore.readInDocument(sheetId);
    const objects: FloatingObject[] = [];

    for (const raw of rawObjects) {
      const deserialized = deserializeFloatingObject(raw as FloatingObject);
      if (deserialized) objects.push(deserialized);
    }

    return objects.sort((a, b) => a.zIndex - b.zIndex);
  }

  /**
   * Compute the pixel bounding box for a floating object.
   * Delegates to the standalone computeObjectBounds function.
   *
   * Async — uses ComputeBridge for dimension queries.
   */
  async computeObjectBounds(obj: FloatingObject): Promise<ObjectBounds | null> {
    return computeObjectBoundsStandalone({ computeBridge: this.computeBridge }, obj);
  }

  /**
   * Batch-compute pixel bounds for ALL floating objects on a sheet in a single
   * IPC call. Returns a Map<objectId, ObjectBounds>.
   *
   * Falls back to empty map if the bridge method is not available.
   */
  async computeAllObjectBounds(sheetId: SheetId): Promise<Map<string, ObjectBounds>> {
    const pairs = await this.computeBridge.computeAllObjectBounds(sheetId);
    const map = new Map<string, ObjectBounds>();
    for (const [id, bounds] of pairs) {
      map.set(id, bounds);
    }
    return map;
  }

  // ===========================================================================
  // ASYNC DELEGATED UNIVERSAL OPERATIONS
  // ===========================================================================

  /** Get all objects in a container (sheet). */
  async getObjectsInDocument(containerId: string): Promise<FloatingObject[]> {
    const objects = await this.objectStore.readInDocument(containerId);
    return (objects as FloatingObject[]).sort((a, b) => a.zIndex - b.zIndex);
  }

  /** Delete a single object. */
  async deleteObject(objectId: string): Promise<boolean> {
    return this.mutator.delete(objectId);
  }

  /** Delete multiple objects. */
  async deleteObjects(objectIds: string[]): Promise<number> {
    return this.mutator.deleteMany(objectIds);
  }

  /** Update an object with partial properties. */
  async updateObject(objectId: string, updates: Partial<FloatingObject>): Promise<boolean> {
    const result = await this.objectStore.update(objectId, updates);
    return result.success;
  }

  /** Move an object by pixel delta via compute bridge (bypasses TS anchor resolution). */
  async moveObject(objectId: string, dx: number, dy: number): Promise<boolean> {
    return this.mutator.move(objectId, dx, dy);
  }

  /** Resize an object to new pixel dimensions via compute bridge. */
  async resizeObject(objectId: string, width: number, height: number): Promise<boolean> {
    return this.mutator.resize(objectId, width, height);
  }

  /** Rotate an object via compute bridge. */
  async rotateObject(objectId: string, angle: number): Promise<boolean> {
    return this.mutator.rotate(objectId, angle);
  }

  /** Bring object to front. Accepts (containerId, objectId) or just (objectId). */
  async bringToFront(objectId: string): Promise<boolean>;
  async bringToFront(containerId: string, objectId: string): Promise<boolean>;
  async bringToFront(docOrObjId: string, objectId?: string): Promise<boolean> {
    const id = objectId !== undefined ? objectId : docOrObjId;
    return this.mutator.bringToFront(id);
  }

  /** Send object to back. Accepts (containerId, objectId) or just (objectId). */
  async sendToBack(objectId: string): Promise<boolean>;
  async sendToBack(containerId: string, objectId: string): Promise<boolean>;
  async sendToBack(docOrObjId: string, objectId?: string): Promise<boolean> {
    const id = objectId !== undefined ? objectId : docOrObjId;
    return this.mutator.sendToBack(id);
  }

  /** Bring object forward one step. Accepts (containerId, objectId) or just (objectId). */
  async bringForward(objectId: string): Promise<boolean>;
  async bringForward(containerId: string, objectId: string): Promise<boolean>;
  async bringForward(docOrObjId: string, objectId?: string): Promise<boolean> {
    const id = objectId !== undefined ? objectId : docOrObjId;
    return this.mutator.bringForward(id);
  }

  /** Send object backward one step. Accepts (containerId, objectId) or just (objectId). */
  async sendBackward(objectId: string): Promise<boolean>;
  async sendBackward(containerId: string, objectId: string): Promise<boolean>;
  async sendBackward(docOrObjId: string, objectId?: string): Promise<boolean> {
    const id = objectId !== undefined ? objectId : docOrObjId;
    return this.mutator.sendBackward(id);
  }

  /** Group objects. Accepts (containerId, objectIds) or just (objectIds). */
  async groupObjects(objectIds: string[]): Promise<string | null>;
  async groupObjects(containerId: string, objectIds: string[]): Promise<string | null>;
  async groupObjects(docOrIds: string | string[], objectIds?: string[]): Promise<string | null> {
    const ids = objectIds !== undefined ? objectIds : (docOrIds as string[]);
    const cId = objectIds !== undefined ? (docOrIds as string) : '';
    try {
      const groupId = await coreGroupObjects(
        { store: this.objectStore, groupStore: this.groupStore },
        ids,
      );
      emitGroupCreated({ eventBus: this.eventBus }, { containerId: cId, groupId, memberIds: ids });
      return groupId;
    } catch {
      return null;
    }
  }

  /** Ungroup a group. */
  async ungroupObjects(groupId: string): Promise<boolean> {
    const group = await getGroup({ store: this.objectStore, groupStore: this.groupStore }, groupId);
    if (!group) return false;
    const memberIds = await coreUngroupObjects(
      { store: this.objectStore, groupStore: this.groupStore },
      groupId,
    );
    if (memberIds.length > 0) {
      emitGroupDeleted(
        { eventBus: this.eventBus },
        { containerId: group.containerId, groupId, memberIds },
      );
    }
    return memberIds.length > 0;
  }

  /** Duplicate an object. */
  async duplicateObject(
    objectId: string,
    offset?: { dx: number; dy: number },
  ): Promise<FloatingObject | null> {
    const newId = await this.mutator.duplicate(objectId, offset?.dx ?? 20, offset?.dy ?? 20);
    if (!newId) return null;
    return (await this.getObject(newId)) ?? null;
  }

  /** Hit-test at (x, y). Canvas HitMap + spatial index handles this; method is a no-op. */
  async hitTest(_containerId: string, _x: number, _y: number): Promise<FloatingObject | null> {
    return null;
  }

  /** Resolve anchor to pixel position. Requires async IPC; use computeObjectBounds() instead. */
  resolvePosition(_containerId: string, _anchor: ObjectPosition): CanvasObjectPosition | null {
    return null;
  }

  // ===========================================================================
  // TYPE-SPECIFIC CREATION OPERATIONS
  // ===========================================================================

  /**
   * Create a picture object.
   */
  async createPicture(
    sheetId: SheetId,
    src: string,
    position: Partial<ObjectPosition>,
    options?: { name?: string; altText?: string },
  ): Promise<PictureObject> {
    const nextZIndex = await this.getNextZIndex(sheetId);

    const picture = createPictureOp({
      ctx: {
        computeBridge: this.computeBridge,
        resolver: null,
      },
      containerId: sheetId,
      src,
      position,
      options,
      getOrCreateMaps: () => ({
        floatingObjects: new Map(),
      }),
      getNextZIndex: () => nextZIndex,
      generateObjectId: () => generateObjectId(),
      generateObjectName: (type) => this.generateObjectName(type),
    });

    // No manual event emission — the store write goes through computeBridge,
    // which returns floatingObjectChanges. MutationResultHandler emits
    // floatingObject:updated automatically.

    return picture;
  }

  // ===========================================================================
  // Object creation
  // ===========================================================================

  /**
   * Create a text box object.
   */
  async createTextBox(
    sheetId: SheetId,
    content: string,
    position: Partial<ObjectPosition>,
    options?: CreateTextBoxOptions,
  ): Promise<TextBoxObject> {
    const deps: TextBoxDependencies = {
      store: this.objectStore,
      resolver: null,
      generateObjectId: () => generateObjectId(),
      generateObjectName: (type) => this.generateObjectName(type),
    };

    const textBox = await createTextBoxOp(
      { containerId: sheetId, content, position, options },
      deps,
    );

    return textBox;
  }

  /**
   * Create an equation object.
   */
  async createEquation(
    sheetId: SheetId,
    position: Partial<ObjectPosition>,
    options?: CreateEquationOptions,
  ): Promise<EquationObject> {
    const equation = await createEquationOp(this.objectStore, sheetId, position, options, () =>
      this.generateObjectName('equation'),
    );

    return equation;
  }

  /**
   * Update an equation's LaTeX content.
   */
  async updateEquation(objectId: string, latex: string): Promise<void> {
    await updateEquationOp(this.objectStore, objectId, latex);
  }

  /**
   * Update an equation's OMML directly.
   */
  async updateEquationOmml(objectId: string, omml: string): Promise<void> {
    await updateEquationOmmlOp(this.objectStore, objectId, omml);
  }

  /**
   * Create a Diagram object.
   */
  async createDiagram(
    sheetId: SheetId,
    position: Partial<ObjectPosition>,
    layoutId: string,
    options?: CreateDiagramOptions,
  ): Promise<DiagramObject> {
    const diagram = await createDiagramOp(
      this.objectStore,
      this.computeBridge,
      sheetId,
      layoutId,
      position,
      options,
      () => this.generateObjectName('diagram'),
    );

    return diagram;
  }

  /**
   * Create a TextEffect object (text box with TextEffect configuration).
   */
  async createTextEffect(
    sheetId: SheetId,
    content: string,
    position: Partial<ObjectPosition>,
    options: CreateTextEffectOptions,
  ): Promise<TextBoxObject> {
    return this.createTextBox(sheetId, content, position, {
      ...options,
    });
  }

  /**
   * Convert an existing text box to TextEffect.
   */
  async convertToTextEffect(objectId: string, config: TextEffectConfig): Promise<void> {
    const obj = await this.getObject(objectId);
    if (!obj || obj.type !== 'textbox') {
      throw new FloatingObjectError(
        'OBJ_INVALID_CONFIG',
        'textbox',
        `Object ${objectId} is not a textbox`,
      );
    }
    await this.updateObject(objectId, { textEffects: config } as Partial<TextBoxObject>);
  }

  /**
   * Remove TextEffect styling from a text box.
   */
  async removeTextEffectStyling(objectId: string): Promise<void> {
    const obj = await this.getObject(objectId);
    if (!obj || obj.type !== 'textbox') {
      throw new FloatingObjectError(
        'OBJ_INVALID_CONFIG',
        'textbox',
        `Object ${objectId} is not a textbox`,
      );
    }
    await this.updateObject(objectId, { textEffects: undefined } as Partial<TextBoxObject>);
  }

  /**
   * Update TextEffect configuration.
   */
  async updateTextEffect(objectId: string, updates: TextEffectConfigUpdate): Promise<void> {
    const obj = await this.getObject(objectId);
    if (!obj || obj.type !== 'textbox') {
      throw new FloatingObjectError(
        'OBJ_INVALID_CONFIG',
        'textbox',
        `Object ${objectId} is not a textbox`,
      );
    }
    const textbox = obj as TextBoxObject;
    if (!textbox.textEffects) {
      throw new FloatingObjectError(
        'OBJ_INVALID_CONFIG',
        'text-effects',
        `Object ${objectId} is not a TextEffect object`,
      );
    }
    const nextTextEffect: TextEffectConfig = { ...textbox.textEffects, ...updates };
    if ('warpAdjustments' in updates && updates.warpAdjustments === undefined) {
      delete nextTextEffect.warpAdjustments;
    }
    if ('outline' in updates && updates.outline === undefined) {
      delete nextTextEffect.outline;
    }
    if ('effects' in updates && updates.effects === undefined) {
      delete nextTextEffect.effects;
    }

    const updatedTextBox: TextBoxObject = { ...textbox, textEffects: nextTextEffect };
    await this.updateObject(objectId, updatedTextBox);
  }

  // ===========================================================================
  // SPREADSHEET-SPECIFIC QUERIES
  // ===========================================================================

  /**
   * Get objects visible within a viewport (cell range).
   */
  async getObjectsInViewport(containerId: string, viewport: CellRange): Promise<FloatingObject[]> {
    const objects = await this.getObjectsInDocument(containerId);

    const minRow = Math.min(viewport.startRow, viewport.endRow);
    const maxRow = Math.max(viewport.startRow, viewport.endRow);
    const minCol = Math.min(viewport.startCol, viewport.endCol);
    const maxCol = Math.max(viewport.startCol, viewport.endCol);

    // Collect all cellIds for batch resolution
    const objectsWithCellIds: { obj: FloatingObject; cellId: string }[] = [];
    for (const obj of objects) {
      const position = obj.position as ObjectPosition | undefined;
      if (!position?.from?.cellId) continue;
      objectsWithCellIds.push({ obj, cellId: position.from.cellId });
    }

    if (objectsWithCellIds.length === 0) return [];

    // Batch resolve all cellIds in a single IPC call
    const cellIds = objectsWithCellIds.map((entry) => entry.cellId);
    const positions = await this.computeBridge.resolveCellPositions(cellIds);

    const result: FloatingObject[] = [];
    for (let i = 0; i < objectsWithCellIds.length; i++) {
      const fromPos = positions[i];
      if (!fromPos) continue;

      if (
        fromPos.row >= minRow - 10 &&
        fromPos.row <= maxRow + 10 &&
        fromPos.col >= minCol - 10 &&
        fromPos.col <= maxCol + 10
      ) {
        result.push(objectsWithCellIds[i].obj);
      }
    }
    return result;
  }

  /**
   * Get objects whose anchor cells overlap a cell range.
   */
  async getObjectsOverlappingRange(
    containerId: string,
    range: CellRange,
  ): Promise<FloatingObject[]> {
    const objects = await this.getObjectsInDocument(containerId);

    const minRow = Math.min(range.startRow, range.endRow);
    const maxRow = Math.max(range.startRow, range.endRow);
    const minCol = Math.min(range.startCol, range.endCol);
    const maxCol = Math.max(range.startCol, range.endCol);

    // Collect all cellIds for batch resolution (from + to anchors)
    const allCellIds: string[] = [];
    const objectEntries: { obj: FloatingObject; fromIndex: number; toIndex: number }[] = [];

    for (const obj of objects) {
      const position = obj.position as ObjectPosition | undefined;
      if (!position?.from?.cellId) continue;

      const fromIndex = allCellIds.length;
      allCellIds.push(position.from.cellId);

      let toIndex = -1;
      if (position.to?.cellId) {
        toIndex = allCellIds.length;
        allCellIds.push(position.to.cellId);
      }

      objectEntries.push({ obj, fromIndex, toIndex });
    }

    if (allCellIds.length === 0) return [];

    // Batch resolve all cellIds in a single IPC call
    const positions = await this.computeBridge.resolveCellPositions(allCellIds);

    const result: FloatingObject[] = [];
    for (const { obj, fromIndex, toIndex } of objectEntries) {
      const fromPos = positions[fromIndex];
      if (fromPos) {
        if (
          fromPos.row >= minRow &&
          fromPos.row <= maxRow &&
          fromPos.col >= minCol &&
          fromPos.col <= maxCol
        ) {
          result.push(obj);
          continue;
        }
      }

      if (toIndex >= 0) {
        const toPos = positions[toIndex];
        if (toPos) {
          if (
            toPos.row >= minRow &&
            toPos.row <= maxRow &&
            toPos.col >= minCol &&
            toPos.col <= maxCol
          ) {
            result.push(obj);
            continue;
          }
        }
      }
    }
    return result;
  }

  // ===========================================================================
  // CONFIGURATION / LIFECYCLE
  // ===========================================================================

  setDocumentContext(context: DocumentContext): void {
    this.documentContext = context;
  }

  getComputeBridge(): ComputeBridge {
    return this.computeBridge;
  }

  dispose(): void {
    // No-op — reserved for future cleanup needs
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private async getNextZIndex(sheetId: SheetId): Promise<number> {
    const deps: ZOrderDeps = { store: this.objectStore };
    return getNextZIndexAsync(deps, sheetId);
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a SpreadsheetObjectManager instance.
 *
 * @param deps - Manager dependencies
 * @returns A new SpreadsheetObjectManager
 */
export function createSpreadsheetObjectManager(
  deps: SpreadsheetObjectManagerDeps,
): SpreadsheetObjectManager {
  return new SpreadsheetObjectManager(deps);
}

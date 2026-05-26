/**
 * Floating Object Manager Interface
 *
 * App-facing contract for the floating object management system.
 * The kernel provides the implementation (SpreadsheetObjectManager);
 * apps and shell program against this interface only.
 *
 * Lifecycle/wiring methods (setPositionLookup,
 * setDocumentContext, dispose) are intentionally excluded — those are
 * kernel-internal concerns that only the document lifecycle system calls.
 */

import type { SheetId } from '@mog/types-core/core';
import type {
  CreateEquationOptions,
  CreateDiagramOptions,
  CreateTextBoxOptions,
  CreateTextEffectOptions,
  EquationObject,
  FloatingObject,
  ObjectPosition,
  PictureObject,
  DiagramObject,
  TextBoxObject,
} from './floating-objects';
import type { TextEffectConfig, TextEffectConfigUpdate } from '../text-effects/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Computed bounding box for a floating object in pixel coordinates.
 * Canonical definition promoted to @mog/types-viewport/rendering/bounds
 * during Phase C; re-exported here for ergonomic import alongside the
 * IFloatingObjectManager interface.
 */
export type { ObjectBounds } from '@mog/types-viewport/rendering/bounds';
import type { ObjectBounds } from '@mog/types-viewport/rendering/bounds';

// =============================================================================
// Interface
// =============================================================================

export interface IFloatingObjectManager {
  // ---------------------------------------------------------------------------
  // Read / Query
  // ---------------------------------------------------------------------------

  /** Get a floating object by ID. */
  getObject(objectId: string): Promise<FloatingObject | undefined>;

  /** Get all floating objects in a sheet, sorted by zIndex. */
  getObjectsInSheet(sheetId: SheetId): Promise<FloatingObject[]>;

  /** Compute the pixel bounding box for a floating object (async — uses ComputeBridge). */
  computeObjectBounds(obj: FloatingObject): Promise<ObjectBounds | null>;

  /** Batch-compute pixel bounds for all floating objects on a sheet (single IPC call). */
  computeAllObjectBounds(sheetId: SheetId): Promise<Map<string, ObjectBounds>>;

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  createPicture(
    sheetId: SheetId,
    src: string,
    position: Partial<ObjectPosition>,
    options?: { name?: string; altText?: string },
  ): Promise<PictureObject>;

  createTextBox(
    sheetId: SheetId,
    content: string,
    position: Partial<ObjectPosition>,
    options?: CreateTextBoxOptions,
  ): Promise<TextBoxObject>;

  createEquation(
    sheetId: SheetId,
    position: Partial<ObjectPosition>,
    options?: CreateEquationOptions,
  ): Promise<EquationObject>;

  createDiagram(
    sheetId: SheetId,
    position: Partial<ObjectPosition>,
    layoutId: string,
    options?: CreateDiagramOptions,
  ): Promise<DiagramObject>;

  createTextEffect(
    sheetId: SheetId,
    content: string,
    position: Partial<ObjectPosition>,
    options: CreateTextEffectOptions,
  ): Promise<TextBoxObject>;

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  deleteObject(objectId: string): Promise<boolean>;
  deleteObjects(objectIds: string[]): Promise<number>;

  // ---------------------------------------------------------------------------
  // Transform
  // ---------------------------------------------------------------------------

  moveObject(objectId: string, dx: number, dy: number): Promise<boolean>;
  resizeObject(objectId: string, width: number, height: number): Promise<boolean>;
  rotateObject(objectId: string, angle: number): Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  updateObject(objectId: string, updates: Partial<FloatingObject>): Promise<boolean>;
  updateTextEffect(objectId: string, updates: TextEffectConfigUpdate): Promise<void>;
  updateEquation(objectId: string, latex: string): Promise<void>;
  updateEquationOmml(objectId: string, omml: string): Promise<void>;
  convertToTextEffect(objectId: string, config: TextEffectConfig): Promise<void>;
  removeTextEffectStyling(objectId: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // Ordering
  // ---------------------------------------------------------------------------

  bringToFront(objectId: string): Promise<boolean>;
  bringToFront(containerId: string, objectId: string): Promise<boolean>;

  sendToBack(objectId: string): Promise<boolean>;
  sendToBack(containerId: string, objectId: string): Promise<boolean>;

  bringForward(objectId: string): Promise<boolean>;
  bringForward(containerId: string, objectId: string): Promise<boolean>;

  sendBackward(objectId: string): Promise<boolean>;
  sendBackward(containerId: string, objectId: string): Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Grouping
  // ---------------------------------------------------------------------------

  groupObjects(objectIds: string[]): Promise<string | null>;
  groupObjects(containerId: string, objectIds: string[]): Promise<string | null>;

  ungroupObjects(groupId: string): Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Duplicate
  // ---------------------------------------------------------------------------

  duplicateObject(
    objectId: string,
    offset?: { dx: number; dy: number },
  ): Promise<FloatingObject | null>;
}

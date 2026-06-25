/**
 * Floating Object Operations Module
 *
 * Generic operations that work on ANY floating object type (shapes, pictures,
 * textboxes, equations, text-effects, diagram, charts, connectors, drawings).
 *
 * Also includes type-specific creation for pictures and text boxes.
 *
 * All functions take ctx: DocumentContext and sheetId: SheetId as the first two
 * params, calling ctx.computeBridge directly (no SpreadsheetObjectManager).
 *
 * Functions throw KernelError on failure instead of returning OperationResult.
 */

import type {
  FloatingObjectType,
  FloatingObjectRemoveReceipt,
  FloatingObjectInfo,
  FloatingObjectMutationReceipt,
  PictureConfig,
  TextBoxConfig,
} from '@mog-sdk/contracts/api';
import type { FloatingObject, PictureObject } from '@mog-sdk/contracts/floating-objects';

import type { ObjectBounds } from '@mog-sdk/contracts/kernel';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';
import type {
  FloatingObjectAnchor,
  FloatingObjectChange,
  FloatingObject as WireFloatingObject,
} from '../../../bridges/compute/compute-types.gen';
import {
  toFloatingObject,
  createMinimalFloatingObject,
} from '../../../bridges/compute/floating-object-mapper';
import { objectNotFound, operationFailed } from '../../../errors/api';
import type { MutationAdmissionOptions } from '../../../bridges/compute';
import type { ComputeBridge } from '../../../bridges/compute/compute-bridge';
import { createVersionOperationContext } from '../../internal/version-operation-context';
import {
  withFloatingObjectMutationReceiptBase,
  withFloatingObjectRemoveReceiptBase,
} from '../objects-receipts';

import type { DocumentContext } from './shared';

// =============================================================================
// Private Helpers
// =============================================================================

/** Known API floating object types for boundary validation. */
const API_FLOATING_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'shape',
  'picture',
  'textbox',
  'equation',
  'text-effects',
  'diagram',
  'chart',
  'drawing',
  'connector',
  'formControl',
  'slicer',
]);

type FloatingObjectMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

const FLOATING_OBJECT_ANCHOR_DOMAIN_IDS = ['floating-objects.anchors'] as const;

function uniqueSheetIds(sheetIds: SheetId | readonly SheetId[]): SheetId[] {
  const ids = Array.isArray(sheetIds) ? sheetIds : [sheetIds];
  return [...new Set(ids)];
}

function createFloatingObjectMutationOptions(
  ctx: DocumentContext,
  operationIdPrefix: string,
  sheetIds: SheetId | readonly SheetId[],
  groupId?: string,
  options?: MutationAdmissionOptions,
): FloatingObjectMutationOptions {
  return {
    ...options,
    operationContext: createVersionOperationContext(ctx, {
      operationIdPrefix,
      sheetIds: uniqueSheetIds(sheetIds),
      domainIds: FLOATING_OBJECT_ANCHOR_DOMAIN_IDS,
      ...(groupId ? { groupId } : {}),
    }),
  };
}

function floatingObjectOptions(
  ctx: DocumentContext,
  operationIdPrefix: string,
  sheetIds: SheetId | readonly SheetId[],
  options?: MutationAdmissionOptions,
): FloatingObjectMutationOptions {
  return createFloatingObjectMutationOptions(ctx, operationIdPrefix, sheetIds, undefined, options);
}

function createGroupedFloatingObjectMutationOptions(
  ctx: DocumentContext,
  operationIdPrefix: string,
  sheetIds: SheetId | readonly SheetId[],
  options?: MutationAdmissionOptions,
): () => FloatingObjectMutationOptions {
  let groupId: string | undefined = options?.operationContext?.groupId;
  return () => {
    const mutationOptions = createFloatingObjectMutationOptions(
      ctx,
      operationIdPrefix,
      sheetIds,
      groupId,
      options,
    );
    groupId =
      mutationOptions.operationContext.groupId ?? mutationOptions.operationContext.operationId;
    return {
      ...mutationOptions,
      operationContext: {
        ...mutationOptions.operationContext,
        groupId,
      },
    };
  };
}

/**
 * Convert an internal FloatingObject to the API FloatingObjectInfo format.
 * Maps internal-only types (e.g. 'oleObject') to 'shape' for the API boundary.
 */
function objectToInfo(obj: FloatingObject): FloatingObjectInfo {
  let apiType: FloatingObjectType;
  if (obj.type === 'textbox' && obj.textEffects) {
    apiType = 'text-effects';
  } else {
    apiType = API_FLOATING_OBJECT_TYPES.has(obj.type) ? (obj.type as FloatingObjectType) : 'shape';
  }
  return {
    id: obj.id,
    type: apiType,
    name: obj.name,
    x: obj.position?.x ?? obj.position?.from?.xOffset ?? 0,
    y: obj.position?.y ?? obj.position?.from?.yOffset ?? 0,
    width: obj.position?.width ?? 0,
    height: obj.position?.height ?? 0,
    rotation: obj.position?.rotation,
    flipH: obj.position?.flipH,
    flipV: obj.position?.flipV,
    zIndex: obj.zIndex,
    visible: 'visible' in obj ? (obj.visible as boolean | undefined) : undefined,
    groupId: 'groupId' in obj ? (obj.groupId as string | undefined) : undefined,
    anchorType: obj.position?.anchorType,
    altText: obj.altText,
  };
}

/**
 * Read a floating object from the bridge, returning the domain-typed object.
 * Returns undefined if not found.
 */
async function readObject(
  bridge: ComputeBridge,
  sheetId: SheetId,
  objectId: string,
): Promise<FloatingObject | undefined> {
  const wire = await bridge.getFloatingObjectTyped(sheetId, objectId);
  if (!wire) return undefined;
  return toFloatingObject(wire);
}

/**
 * Read a floating object, throwing if not found.
 */
async function requireObject(
  bridge: ComputeBridge,
  sheetId: SheetId,
  objectId: string,
): Promise<FloatingObject> {
  const obj = await readObject(bridge, sheetId, objectId);
  if (!obj) {
    throw objectNotFound(objectId);
  }
  return obj;
}

/**
 * Build a FloatingObjectMutationReceipt by re-reading from the bridge.
 */
async function buildMutationReceipt(
  bridge: ComputeBridge,
  sheetId: SheetId,
  objectId: string,
  action: 'create' | 'update',
): Promise<FloatingObjectMutationReceipt> {
  const obj = await readObject(bridge, sheetId, objectId);
  // Compute bounds for the specific object from the batch call
  let bounds = { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
  if (obj) {
    const allBounds = await bridge.computeAllObjectBounds(sheetId);
    for (const [id, b] of allBounds) {
      if (id === objectId) {
        bounds = b;
        break;
      }
    }
  }
  return withFloatingObjectMutationReceiptBase(
    {
      domain: 'floatingObject',
      action,
      id: objectId,
      object: (obj ?? { id: objectId }) as FloatingObject,
      bounds,
    },
    sheetId,
  );
}

// =============================================================================
// Generic Operations (work on ANY floating object)
// =============================================================================

/**
 * Delete a floating object from a sheet.
 * Throws KernelError if the object does not exist.
 *
 * @returns A delete receipt for the removed object
 */
export async function deleteFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectRemoveReceipt> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.delete', sheetId, admissionOptions);
  await ctx.computeBridge.deleteFloatingObject(sheetId, objectId, options);
  return withFloatingObjectRemoveReceiptBase(
    { domain: 'floatingObject', action: 'remove', id: objectId },
    sheetId,
  );
}

/**
 * Move a floating object to a new position.
 * Throws KernelError if the object does not exist.
 *
 * @returns A mutation receipt for the moved object
 */
export async function moveFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  x: number,
  y: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.move', sheetId, admissionOptions);
  await ctx.computeBridge.moveFloatingObjectTyped(
    sheetId,
    objectId,
    { type: 'delta', dx: x, dy: y },
    options,
  );
  return buildMutationReceipt(ctx.computeBridge, sheetId, objectId, 'update');
}

/**
 * Resize a floating object.
 * Throws KernelError if the object does not exist.
 *
 * @returns A mutation receipt for the resized object
 */
export async function resizeFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  width: number,
  height: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.resize', sheetId, admissionOptions);
  await ctx.computeBridge.resizeFloatingObjectTyped(sheetId, objectId, { width, height }, options);
  return buildMutationReceipt(ctx.computeBridge, sheetId, objectId, 'update');
}

/**
 * Rotate a floating object.
 * Throws KernelError if the object does not exist.
 */
export async function rotateFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  angle: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.rotate', sheetId, admissionOptions);
  await ctx.computeBridge.rotateFloatingObjectTyped(sheetId, objectId, angle, options);
}

/**
 * Flip a floating object horizontally or vertically.
 * Throws KernelError if the object does not exist.
 */
export async function flipFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  direction: 'horizontal' | 'vertical',
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.flip', sheetId, admissionOptions);
  await ctx.computeBridge.flipFloatingObjectTyped(sheetId, objectId, direction, options);
}

/**
 * Duplicate a floating object.
 * Throws KernelError if the object does not exist or duplication fails.
 *
 * @returns A mutation receipt for the duplicated object
 */
export async function duplicateFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(
    ctx,
    'floatingObjects.duplicate',
    sheetId,
    admissionOptions,
  );
  const result = await ctx.computeBridge.duplicateFloatingObjectTyped(
    sheetId,
    objectId,
    20,
    20,
    options,
  );
  // The mutation result contains the new object ID in the floating object changes
  const newId = result.floatingObjectChanges?.[0]?.objectId;
  if (!newId) {
    throw operationFailed('duplicateFloatingObject', 'duplicate returned no new object');
  }
  return buildMutationReceipt(ctx.computeBridge, sheetId, newId, 'create');
}

/**
 * List all floating objects on a sheet.
 */
export async function listFloatingObjects(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<FloatingObjectInfo[]> {
  try {
    const wireObjects = await ctx.computeBridge.getAllFloatingObjectsTyped(sheetId);
    return wireObjects.map((wire) => objectToInfo(toFloatingObject(wire)));
  } catch {
    return [];
  }
}

/**
 * Get a single floating object by ID and return its API info.
 * Returns null if the object does not exist or does not belong to the given sheet.
 */
export async function getFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
): Promise<FloatingObjectInfo | null> {
  const obj = await readObject(ctx.computeBridge, sheetId, objectId);
  if (!obj) return null;
  return objectToInfo(obj);
}

/**
 * Update arbitrary properties of a floating object.
 * Throws KernelError if the object does not exist.
 */
export async function updateFloatingObject(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  updates: Record<string, unknown>,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(sheetId, objectId, updates, options);
}

/**
 * Delete multiple floating objects.
 * Returns the count of successfully deleted objects.
 */
export async function deleteManyFloatingObjects(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectIds: string[],
  admissionOptions?: MutationAdmissionOptions,
): Promise<number> {
  let count = 0;
  const nextMutationOptions = createGroupedFloatingObjectMutationOptions(
    ctx,
    'floatingObjects.delete',
    sheetId,
    admissionOptions,
  );
  for (const id of objectIds) {
    try {
      await ctx.computeBridge.deleteFloatingObject(sheetId, id, nextMutationOptions());
      count++;
    } catch {
      // Object may not exist; count only successful deletes
    }
  }
  return count;
}

// =============================================================================
// Z-Order Operations
// =============================================================================

/**
 * Bring a floating object to the front (highest z-index).
 * Throws KernelError if the object does not exist.
 */
export async function bringToFront(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.zOrder', sheetId, admissionOptions);
  await ctx.computeBridge.bringFloatingObjectToFront(sheetId, objectId, options);
}

/**
 * Send a floating object to the back (lowest z-index).
 * Throws KernelError if the object does not exist.
 */
export async function sendToBack(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.zOrder', sheetId, admissionOptions);
  await ctx.computeBridge.sendFloatingObjectToBack(sheetId, objectId, options);
}

/**
 * Bring a floating object one step forward in z-order.
 * Throws KernelError if the object does not exist.
 */
export async function bringForward(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.zOrder', sheetId, admissionOptions);
  await ctx.computeBridge.bringFloatingObjectForward(sheetId, objectId, options);
}

/**
 * Send a floating object one step backward in z-order.
 * Throws KernelError if the object does not exist.
 */
export async function sendBackward(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, objectId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.zOrder', sheetId, admissionOptions);
  await ctx.computeBridge.sendFloatingObjectBackward(sheetId, objectId, options);
}

// =============================================================================
// Grouping Operations
// =============================================================================

/**
 * Group multiple floating objects together.
 * Throws KernelError if grouping fails.
 *
 * @returns The new group ID
 */
export async function groupFloatingObjects(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectIds: string[],
  admissionOptions?: MutationAdmissionOptions,
): Promise<string> {
  const options = floatingObjectOptions(ctx, 'floatingObjects.group', sheetId, admissionOptions);
  const result = await ctx.computeBridge.createFloatingObjectGroup(
    sheetId,
    { memberIds: objectIds },
    options,
  );
  const groupId = result.floatingObjectGroupChanges?.[0]?.objectId;
  if (!groupId) {
    throw operationFailed('groupFloatingObjects', 'grouping returned no group ID');
  }
  return groupId;
}

/**
 * Ungroup a floating object group.
 * Throws KernelError if ungrouping fails.
 */
export async function ungroupFloatingObjects(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  const options = floatingObjectOptions(ctx, 'floatingObjects.ungroup', sheetId, admissionOptions);
  await ctx.computeBridge.deleteFloatingObjectGroup(sheetId, groupId, options);
}

// =============================================================================
// Picture Operations
// =============================================================================

/**
 * Add a picture to a sheet.
 * Throws KernelError if creation fails.
 *
 * @returns A mutation receipt for the created picture
 */
/**
 * EMU (English Metric Units) per pixel. OOXML stores anchor offsets and
 * extents in EMU; Rust's `FloatingObjectAnchor` schema is EMU-native.
 */
const EMU_PER_PX = 9525;

function emuToPx(emu: number): number {
  return emu / EMU_PER_PX;
}

interface LegacyAnchorOffsetFields {
  anchorColOffset: number;
  anchorRowOffset: number;
}

type AnchorOffsetSource = Pick<FloatingObjectAnchor, 'anchorColOffsetEmu' | 'anchorRowOffsetEmu'> &
  Partial<LegacyAnchorOffsetFields>;

function anchorOffsetPx(anchor: AnchorOffsetSource, axis: 'x' | 'y'): number {
  if (axis === 'x') return emuToPx(anchor.anchorColOffsetEmu ?? anchor.anchorColOffset ?? 0);
  return emuToPx(anchor.anchorRowOffsetEmu ?? anchor.anchorRowOffset ?? 0);
}

export async function addPicture(
  ctx: DocumentContext,
  sheetId: SheetId,
  config: PictureConfig,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  const anchor = config.anchorCell ?? { row: 0, col: 0 };
  const xPx = config.x ?? config.position?.x ?? config.position?.from?.xOffset ?? 0;
  const yPx = config.y ?? config.position?.y ?? config.position?.from?.yOffset ?? 0;
  const widthPx = config.width ?? config.position?.width ?? 200;
  const heightPx = config.height ?? config.position?.height ?? 150;
  // The Rust side parses the wire payload into `FloatingObjectCommon` with a
  // flat `anchor: FloatingObjectAnchor` (EMU-based). Sending nested
  // `position.from.cellId` doesn't match that schema and silently defaults
  // anchor/width/height to 0 — pictures land off-screen and the renderer
  // skips them for missing bounds. Build the schema-correct payload here.
  const pictureConfig = {
    type: 'picture' as const,
    src: config.src,
    anchor: {
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      anchorRowOffsetEmu: Math.round(yPx * EMU_PER_PX),
      anchorColOffsetEmu: Math.round(xPx * EMU_PER_PX),
      anchorMode: config.position?.anchorType ?? 'oneCell',
      extentCxEmu: Math.round(widthPx * EMU_PER_PX),
      extentCyEmu: Math.round(heightPx * EMU_PER_PX),
    },
    width: widthPx,
    height: heightPx,
    name: config.name,
    altText: config.altText,
    crop: config.crop,
    adjustments: config.adjustments,
    border: config.border,
    rotation: config.position?.rotation,
    flipH: config.position?.flipH,
    flipV: config.position?.flipV,
    locked: config.locked,
    printable: config.printable,
  };

  const options = floatingObjectOptions(ctx, 'floatingObjects.create', sheetId, admissionOptions);
  const result = await ctx.computeBridge.createFloatingObject(sheetId, pictureConfig, options);
  const newId = result.floatingObjectChanges?.[0]?.objectId;
  if (!newId) {
    throw operationFailed('addPicture', 'creation returned no object ID');
  }
  return buildMutationReceipt(ctx.computeBridge, sheetId, newId, 'create');
}

/**
 * Update a picture's properties.
 * Throws KernelError if the picture does not exist.
 */
export async function updatePicture(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  updates: Partial<PictureConfig>,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  const wire = await ctx.computeBridge.getFloatingObjectTyped(sheetId, objectId);
  if (!wire) {
    throw objectNotFound(objectId);
  }
  const current = toFloatingObject(wire);
  if (current.type !== 'picture') {
    throw operationFailed('updatePicture', `object ${objectId} is ${current.type}, not picture`);
  }

  const nextMutationOptions = createGroupedFloatingObjectMutationOptions(
    ctx,
    'floatingObjects.update',
    sheetId,
    admissionOptions,
  );
  const objectUpdates: Record<string, unknown> = {};

  if (updates.name !== undefined) {
    objectUpdates.name = updates.name;
  }
  if (updates.src !== undefined) {
    objectUpdates.src = updates.src;
  }

  // altText is an API-level property that may be stored as an extension field
  // on the underlying object. Merge it into the update via Object.assign.
  if (updates.altText !== undefined) {
    objectUpdates.altText = updates.altText;
  }
  if (updates.crop !== undefined) {
    objectUpdates.crop = updates.crop;
  }
  if (updates.adjustments !== undefined) {
    objectUpdates.adjustments = updates.adjustments;
  }
  if (updates.border !== undefined) {
    objectUpdates.border = updates.border;
  }
  if (updates.locked !== undefined) {
    objectUpdates.locked = updates.locked;
  }
  if (updates.printable !== undefined) {
    objectUpdates.printable = updates.printable;
  }
  if (updates.position?.rotation !== undefined) {
    objectUpdates.rotation = updates.position.rotation;
  }
  if (updates.position?.flipH !== undefined) {
    objectUpdates.flipH = updates.position.flipH;
  }
  if (updates.position?.flipV !== undefined) {
    objectUpdates.flipV = updates.position.flipV;
  }
  if (updates.position?.anchorType !== undefined) {
    objectUpdates.anchor = { anchorMode: updates.position.anchorType };
  }

  if (Object.keys(objectUpdates).length > 0) {
    await ctx.computeBridge.updateFloatingObject(
      sheetId,
      objectId,
      objectUpdates,
      nextMutationOptions(),
    );
  }

  const nextWidth = updates.width ?? updates.position?.width;
  const nextHeight = updates.height ?? updates.position?.height;
  if (nextWidth !== undefined || nextHeight !== undefined) {
    await ctx.computeBridge.resizeFloatingObjectTyped(
      sheetId,
      objectId,
      {
        width: nextWidth ?? current.position.width ?? wire.width,
        height: nextHeight ?? current.position.height ?? wire.height,
      },
      nextMutationOptions(),
    );
  }

  const nextX = updates.x ?? updates.position?.x ?? updates.position?.from?.xOffset;
  const nextY = updates.y ?? updates.position?.y ?? updates.position?.from?.yOffset;
  const anchorChanged = updates.anchorCell !== undefined;
  if (anchorChanged || nextX !== undefined || nextY !== undefined) {
    await ctx.computeBridge.moveFloatingObjectTyped(
      sheetId,
      objectId,
      {
        type: 'absolute',
        anchorRow: updates.anchorCell?.row ?? wire.anchor.anchorRow,
        anchorCol: updates.anchorCell?.col ?? wire.anchor.anchorCol,
        xOffset: nextX ?? anchorOffsetPx(wire.anchor, 'x'),
        yOffset: nextY ?? anchorOffsetPx(wire.anchor, 'y'),
      },
      nextMutationOptions(),
    );
  }
}

// =============================================================================
// Text Box Operations
// =============================================================================

/**
 * Add a text box to a sheet.
 * Throws KernelError if creation fails.
 *
 * @returns A mutation receipt for the created text box
 */
export async function addTextBox(
  ctx: DocumentContext,
  sheetId: SheetId,
  config: TextBoxConfig,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  const anchor = config.anchorCell ?? { row: 0, col: 0 };
  const xPx = config.x ?? 0;
  const yPx = config.y ?? 0;
  const widthPx = config.width ?? 200;
  const heightPx = config.height ?? 100;

  // `TextBoxConfig.text` is a `ShapeText` (shared model with shape):
  // it already carries content, formatting, margins, and verticalAlign as
  // nested fields. Rust's floating object storage expects canonical top-level
  // geometry (`anchor`, `width`, `height`), not the domain `position` object.
  const textBoxConfig = {
    type: 'textbox' as const,
    text: config.text,
    anchor: {
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      anchorRowOffsetEmu: Math.round(yPx * EMU_PER_PX),
      anchorColOffsetEmu: Math.round(xPx * EMU_PER_PX),
      anchorMode: 'oneCell',
      extentCxEmu: Math.round(widthPx * EMU_PER_PX),
      extentCyEmu: Math.round(heightPx * EMU_PER_PX),
    },
    width: widthPx,
    height: heightPx,
    name: config.name,
  };

  const options = floatingObjectOptions(ctx, 'floatingObjects.create', sheetId, admissionOptions);
  const result = await ctx.computeBridge.createFloatingObject(sheetId, textBoxConfig, options);
  const newId = result.floatingObjectChanges?.[0]?.objectId;
  if (!newId) {
    throw operationFailed('addTextBox', 'creation returned no object ID');
  }
  return buildMutationReceipt(ctx.computeBridge, sheetId, newId, 'create');
}

// =============================================================================
// Connector Connection Operations
// =============================================================================

/**
 * Connect the start of a connector to a target shape at a specific connection site.
 * Throws KernelError if the connector or target shape does not exist.
 */
export async function connectBeginShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  connectorId: string,
  targetShapeId: string,
  siteIndex: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, connectorId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(
    sheetId,
    connectorId,
    { startConnection: { shapeId: targetShapeId, siteIndex } },
    options,
  );
}

/**
 * Connect the end of a connector to a target shape at a specific connection site.
 * Throws KernelError if the connector does not exist.
 */
export async function connectEndShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  connectorId: string,
  targetShapeId: string,
  siteIndex: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, connectorId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(
    sheetId,
    connectorId,
    { endConnection: { shapeId: targetShapeId, siteIndex } },
    options,
  );
}

/**
 * Disconnect the start of a connector from its connected shape.
 */
export async function disconnectBeginShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  connectorId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, connectorId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(
    sheetId,
    connectorId,
    { startConnection: null },
    options,
  );
}

/**
 * Disconnect the end of a connector from its connected shape.
 */
export async function disconnectEndShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  connectorId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, connectorId);
  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(
    sheetId,
    connectorId,
    { endConnection: null },
    options,
  );
}

/**
 * Get the connector object data (including connection info) for a connector.
 * Returns null if not found or not a connector type.
 */
export async function getConnectorData(
  ctx: DocumentContext,
  sheetId: SheetId,
  connectorId: string,
): Promise<{
  startConnection?: { shapeId: string; siteIndex: number };
  endConnection?: { shapeId: string; siteIndex: number };
} | null> {
  const obj = await readObject(ctx.computeBridge, sheetId, connectorId);
  if (!obj || obj.type !== 'connector') return null;
  const connector = obj as FloatingObject & {
    startConnection?: { shapeId: string; siteIndex: number };
    endConnection?: { shapeId: string; siteIndex: number };
  };
  return {
    startConnection: connector.startConnection,
    endConnection: connector.endConnection,
  };
}

// =============================================================================
// Group Member Enumeration
// =============================================================================

/**
 * Get the member (child) object IDs of a floating object group.
 * Returns the list of object IDs in the group, or empty array if group not found.
 */
export async function getGroupMembers(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
): Promise<string[]> {
  const wireObjects = await ctx.computeBridge.getAllFloatingObjectsTyped(sheetId);
  return wireObjects
    .map((wire) => toFloatingObject(wire))
    .filter((obj) => 'groupId' in obj && obj.groupId === groupId)
    .map((obj) => obj.id);
}

// =============================================================================
// Image Format Query
// =============================================================================

/**
 * Derive image format from a picture's src data URL.
 * Returns format string like 'png', 'jpeg', 'gif', 'bmp', 'svg', or 'unknown'.
 */
export function deriveImageFormat(src: string): string {
  // Data URL format: data:<mime>;base64,...
  const dataUrlMatch = src.match(/^data:image\/([^;,]+)/);
  if (dataUrlMatch) {
    const mime = dataUrlMatch[1].toLowerCase();
    if (mime === 'svg+xml') return 'svg';
    return mime; // png, jpeg, gif, bmp, webp, etc.
  }
  // File extension fallback
  const extMatch = src.match(/\.(\w+)(?:\?|$)/);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    if (ext === 'jpg') return 'jpeg';
    return ext;
  }
  return 'unknown';
}

/**
 * Get the image format for a picture object.
 * Returns null if not found or not a picture.
 */
export async function getImageFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
): Promise<string | null> {
  const obj = await readObject(ctx.computeBridge, sheetId, objectId);
  if (!obj || obj.type !== 'picture') return null;
  const picture = obj as FloatingObject & { src?: string };
  if (!picture.src) return null;
  return deriveImageFormat(picture.src);
}

// =============================================================================
// Connection Site Count
// =============================================================================

/**
 * Default connection site count for standard shapes.
 * Most OOXML preset shapes have 4 connection sites (top, right, bottom, left centers).
 * Connectors themselves have 2 (start and end).
 */
const CONNECTOR_TYPES = new Set([
  'straightConnector1',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
]);

/**
 * Get the number of connection sites on a shape.
 * Standard shapes have 4 connection sites. Connectors have 2.
 * Returns 0 if the object is not found or is not a shape/connector.
 */
export async function getConnectionSiteCount(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
): Promise<number> {
  const obj = await readObject(ctx.computeBridge, sheetId, objectId);
  if (!obj) return 0;
  if (obj.type === 'connector') return 2;
  if (obj.type === 'shape') {
    const shape = obj as FloatingObject & { shapeType?: string };
    if (shape.shapeType && CONNECTOR_TYPES.has(shape.shapeType)) return 2;
    return 4; // Standard OOXML default
  }
  return 0;
}

// =============================================================================
// Convenience Methods (OfficeJS audit gap closures)
// =============================================================================

/**
 * Build a FloatingObjectMutationReceipt from a bridge FloatingObjectChange.
 */
function buildBridgeMutationReceipt(
  change: FloatingObjectChange | undefined,
  action: 'create' | 'update',
  fallbackId: string,
  fallbackSheetId: SheetId,
  fallbackType: 'shape' | 'connector' | 'picture' = 'shape',
): FloatingObjectMutationReceipt {
  const objectId = change?.objectId ?? fallbackId;
  if (!objectId) {
    throw operationFailed('floatingObjectMutation', 'mutation returned no object ID');
  }
  const bounds: ObjectBounds = change?.bounds
    ? {
        x: change.bounds.x,
        y: change.bounds.y,
        width: change.bounds.width,
        height: change.bounds.height,
        rotation: change.bounds.rotation,
      }
    : { x: 0, y: 0, width: 0, height: 0, rotation: 0 };

  return withFloatingObjectMutationReceiptBase(
    {
      domain: 'floatingObject',
      action,
      id: objectId,
      object: change?.data
        ? toFloatingObject(change.data as WireFloatingObject)
        : createMinimalFloatingObject(fallbackType, objectId, fallbackSheetId),
      bounds,
    },
    fallbackSheetId,
  );
}

/**
 * Create a line/connector between two points.
 * P1: addLine(startLeft, startTop, endLeft, endTop) from OfficeJS audit.
 */
export async function addLine(
  ctx: DocumentContext,
  sheetId: SheetId,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  connectorType?: 'straight' | 'elbow' | 'curve',
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  // Compute bounding box from start/end points
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX) || 1;
  const height = Math.abs(endY - startY) || 1;

  // Map connector type to OOXML shape type
  let shapeType: string;
  switch (connectorType) {
    case 'elbow':
      shapeType = 'bentConnector3';
      break;
    case 'curve':
      shapeType = 'curvedConnector3';
      break;
    case 'straight':
    default:
      shapeType = 'straightConnector1';
      break;
  }

  const config = {
    shapeType,
    anchorRow: 0,
    anchorCol: 0,
    xOffset: 0,
    yOffset: 0,
    width,
    height,
    pixelX: x,
    pixelY: y,
  };

  const options = floatingObjectOptions(ctx, 'floatingObjects.create', sheetId, admissionOptions);
  const result = await ctx.computeBridge.createShape(sheetId, config as any, options);
  const change = result.floatingObjectChanges?.[0];
  return buildBridgeMutationReceipt(change, 'create', '', sheetId, 'connector');
}

/**
 * Get the nesting depth of an object within groups.
 * M4: level (group nesting depth) from OfficeJS audit.
 * Returns 0 for ungrouped objects, 1 for direct group members, etc.
 */
export async function getGroupNestingLevel(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
): Promise<number> {
  let level = 0;
  let currentId = objectId;

  // Walk up the groupId chain
  for (let i = 0; i < 100; i++) {
    // safety limit
    const obj = await readObject(ctx.computeBridge, sheetId, currentId);
    if (!obj || !('groupId' in obj) || !obj.groupId) break;
    level++;
    currentId = obj.groupId as string;
  }

  return level;
}

/**
 * Increment a floating object's left position by a delta.
 * P5: incrementLeft(increment) from OfficeJS audit.
 */
export async function incrementLeft(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  delta: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  const options = floatingObjectOptions(ctx, 'floatingObjects.move', sheetId, admissionOptions);
  const result = await ctx.computeBridge.moveFloatingObjectTyped(
    sheetId,
    objectId,
    { type: 'delta', dx: delta, dy: 0 },
    options,
  );
  const change = result.floatingObjectChanges?.[0];
  return buildBridgeMutationReceipt(change, 'update', objectId, sheetId);
}

/**
 * Increment a floating object's top position by a delta.
 * P5: incrementTop(increment) from OfficeJS audit.
 */
export async function incrementTop(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  delta: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  const options = floatingObjectOptions(ctx, 'floatingObjects.move', sheetId, admissionOptions);
  const result = await ctx.computeBridge.moveFloatingObjectTyped(
    sheetId,
    objectId,
    { type: 'delta', dx: 0, dy: delta },
    options,
  );
  const change = result.floatingObjectChanges?.[0];
  return buildBridgeMutationReceipt(change, 'update', objectId, sheetId);
}

/**
 * Increment a picture's brightness by a delta value.
 * P10: incrementBrightness(increment) from OfficeJS audit.
 */
export async function incrementBrightness(
  ctx: DocumentContext,
  sheetId: SheetId,
  pictureId: string,
  delta: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  const obj = await requireObject(ctx.computeBridge, sheetId, pictureId);
  const picture = obj as PictureObject;
  const currentBrightness = picture.adjustments?.brightness ?? 0;
  const newBrightness = Math.max(-100, Math.min(100, currentBrightness + delta));
  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(
    sheetId,
    pictureId,
    { adjustments: { ...picture.adjustments, brightness: newBrightness } },
    options,
  );
}

/**
 * Increment a picture's contrast by a delta value.
 * P10: incrementContrast(increment) from OfficeJS audit.
 */
export async function incrementContrast(
  ctx: DocumentContext,
  sheetId: SheetId,
  pictureId: string,
  delta: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  const obj = await requireObject(ctx.computeBridge, sheetId, pictureId);
  const picture = obj as PictureObject;
  const currentContrast = picture.adjustments?.contrast ?? 0;
  const newContrast = Math.max(-100, Math.min(100, currentContrast + delta));
  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(
    sheetId,
    pictureId,
    { adjustments: { ...picture.adjustments, contrast: newContrast } },
    options,
  );
}

// =============================================================================
// Cross-Sheet Copy (P4)
// =============================================================================

/**
 * Copy a floating object to another sheet.
 * P4: copyTo(destinationSheet) from OfficeJS audit.
 */
export async function copyToSheet(
  ctx: DocumentContext,
  sourceSheetId: SheetId,
  objectId: string,
  targetSheetId: SheetId,
  admissionOptions?: MutationAdmissionOptions,
): Promise<FloatingObjectMutationReceipt> {
  await requireObject(ctx.computeBridge, sourceSheetId, objectId);
  const nextMutationOptions = createGroupedFloatingObjectMutationOptions(
    ctx,
    'floatingObjects.duplicate',
    [sourceSheetId, targetSheetId],
    admissionOptions,
  );

  const result = await ctx.computeBridge.duplicateFloatingObjectTyped(
    sourceSheetId,
    objectId,
    0,
    0,
    nextMutationOptions(),
  );
  const change = result.floatingObjectChanges?.[0];
  if (!change) {
    throw operationFailed('copyToSheet', 'duplicate returned no floating object change');
  }

  if (sourceSheetId !== targetSheetId) {
    await ctx.computeBridge.updateFloatingObject(
      sourceSheetId,
      change.objectId,
      {
        sheetId: targetSheetId,
      },
      nextMutationOptions(),
    );
  }

  // After a potential sheet move, the object now lives on `targetSheetId`.
  return buildMutationReceipt(ctx.computeBridge, targetSheetId, change.objectId, 'create');
}

// =============================================================================
// Connector Type Mutation (P12)
// =============================================================================

/**
 * Change a connector's type (straight, elbow, curve).
 * P12: connectorType mutable property from OfficeJS audit.
 */
export async function setConnectorType(
  ctx: DocumentContext,
  sheetId: SheetId,
  connectorId: string,
  connectorType: 'straight' | 'elbow' | 'curve',
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  await requireObject(ctx.computeBridge, sheetId, connectorId);

  let shapeType: string;
  switch (connectorType) {
    case 'elbow':
      shapeType = 'bentConnector3';
      break;
    case 'curve':
      shapeType = 'curvedConnector3';
      break;
    case 'straight':
    default:
      shapeType = 'straightConnector1';
      break;
  }

  const options = floatingObjectOptions(ctx, 'floatingObjects.update', sheetId, admissionOptions);
  await ctx.computeBridge.updateFloatingObject(sheetId, connectorId, { shapeType }, options);
}

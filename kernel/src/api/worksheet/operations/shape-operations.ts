/**
 * Shape Operations Module
 *
 * Extracted from SheetAPI - standalone functions for shape manipulation.
 * Mutation functions take (ctx: DocumentContext, sheetId: SheetId, ...).
 * Read-only functions (getShape, getShapes) also take manager: SpreadsheetObjectManager.
 *
 * Functions throw KernelError on failure instead of returning OperationResult.
 */

import type {
  FloatingObjectRemoveReceipt,
  FloatingObjectMutationReceipt,
  Shape,
  ShapeConfig,
} from '@mog-sdk/contracts/api';
import type { ObjectBounds } from '@mog-sdk/contracts/kernel';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { FloatingObject, ShapeObject, ShapeText } from '@mog-sdk/contracts/floating-objects';

import type {
  CreateShapeConfig,
  FloatingObjectChange,
  ShapeStyleUpdate,
  FloatingObject as WireFloatingObject,
} from '../../../bridges/compute/compute-types.gen';
import {
  toFloatingObject,
  createMinimalFloatingObject,
} from '../../../bridges/compute/floating-object-mapper';
import { invalidShapeConfig } from '../../../errors/api';
import type { SpreadsheetObjectManager } from '../../../floating-objects';
import {
  withFloatingObjectMutationReceiptBase,
  withFloatingObjectRemoveReceiptBase,
} from '../objects-receipts';

import type { CellFormat } from '@mog-sdk/contracts/core';
import type { DocumentContext } from './shared';

// =============================================================================
// Private Helpers
// =============================================================================

/**
 * Convert internal ShapeObject to API Shape.
 *
 * This is now a thin projection: extract simple position fields from the
 * CellId-based ObjectPosition and pass through rich types (fill, outline,
 * text, shadow) without information loss.
 */
function shapeObjectToShape(shape: ShapeObject, sheetId: SheetId): Shape {
  return {
    id: shape.id,
    sheetId,
    type: shape.shapeType,
    // Position: project from CellId-based ObjectPosition to simple integers
    anchorRow: 0, // CellId-based — resolved at render time; API returns 0 as placeholder
    anchorCol: 0,
    xOffset: shape.position.from?.xOffset ?? 0,
    yOffset: shape.position.from?.yOffset ?? 0,
    width: shape.position.width ?? 100,
    height: shape.position.height ?? 100,
    // Pass through rich types without information loss
    name: shape.name,
    fill: shape.fill,
    outline: shape.outline,
    text: shape.text,
    shadow: shape.shadow,
    rotation: shape.position.rotation ?? 0,
    locked: shape.locked,
    adjustments: shape.adjustments,
    zIndex: shape.zIndex,
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
    lockAspectRatio: shape.lockAspectRatio,
    altTextTitle: shape.altTextTitle,
    displayName: shape.displayName,
  };
}

/**
 * Build a FloatingObjectMutationReceipt from a FloatingObjectChange.
 */
function buildMutationReceipt(
  change: FloatingObjectChange,
  action: 'create' | 'update',
  sheetId: SheetId,
): FloatingObjectMutationReceipt {
  const bounds: ObjectBounds = change.bounds
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
      id: change.objectId,
      object: change.data
        ? toFloatingObject(change.data as WireFloatingObject)
        : createMinimalFloatingObject('shape', change.objectId, sheetId),
      bounds,
    },
    sheetId,
  );
}

function buildFallbackMutationReceipt(
  sheetId: SheetId,
  action: 'create' | 'update',
  id: string,
  bounds: ObjectBounds,
): FloatingObjectMutationReceipt {
  return withFloatingObjectMutationReceiptBase(
    {
      domain: 'floatingObject',
      action,
      id,
      object: createMinimalFloatingObject('shape', id, sheetId),
      bounds,
    },
    sheetId,
  );
}

// =============================================================================
// Shape Operations
// =============================================================================

/**
 * Create a new shape on a sheet.
 * Throws KernelError if config is invalid or creation fails.
 *
 * @returns A mutation receipt for the created shape
 */
export async function createShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  config: ShapeConfig,
): Promise<FloatingObjectMutationReceipt> {
  if (!config.type) {
    throw invalidShapeConfig('type is required');
  }

  const bridgeConfig: CreateShapeConfig = {
    shapeType: config.type,
    anchorRow: config.anchorRow ?? 0,
    anchorCol: config.anchorCol ?? 0,
    xOffset: config.xOffset ?? 0,
    yOffset: config.yOffset ?? 0,
    width: config.width ?? 200,
    height: config.height ?? 200,
    fill: config.fill as CreateShapeConfig['fill'],
    outline: config.outline as CreateShapeConfig['outline'],
    text: config.text as CreateShapeConfig['text'],
    shadow: config.shadow as CreateShapeConfig['shadow'],
    rotation: config.rotation,
    name: config.name,
    adjustments: config.adjustments,
    pixelX: config.pixelX,
    pixelY: config.pixelY,
    lockAspectRatio: config.lockAspectRatio,
  } as CreateShapeConfig;

  const result = await ctx.computeBridge.createShape(sheetId, bridgeConfig);

  const change = result.floatingObjectChanges?.[0];
  if (change?.data) {
    return buildMutationReceipt(change, 'create', sheetId);
  }

  // Fallback: construct minimal receipt from config
  return buildFallbackMutationReceipt(
    sheetId,
    'create',
    '',
    {
      x: 0,
      y: 0,
      width: config.width ?? 200,
      height: config.height ?? 200,
      rotation: config.rotation ?? 0,
    },
  );
}

/**
 * Get a shape by ID.
 *
 * @returns The shape, or undefined if not found
 */
export async function getShape(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
): Promise<Shape | undefined> {
  void ctx;

  try {
    const obj = await manager.getObject(shapeId);
    if (!obj || obj.type !== 'shape') return undefined;
    return shapeObjectToShape(obj as ShapeObject, sheetId);
  } catch {
    return undefined;
  }
}

/**
 * Get all shapes on a sheet.
 *
 * @returns Array of shapes
 */
export async function getShapes(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<Shape[]> {
  void ctx;

  try {
    const objects = await manager.getObjectsInSheet(sheetId);
    return objects
      .filter((obj): obj is ShapeObject => obj.type === 'shape')
      .map((shape) => shapeObjectToShape(shape, sheetId));
  } catch {
    return [];
  }
}

/**
 * Update a shape's properties.
 * Throws KernelError if the shape does not exist.
 *
 * @returns A mutation receipt for the updated shape
 */
export async function updateShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  updates: Partial<ShapeConfig>,
): Promise<FloatingObjectMutationReceipt> {
  // Collect style updates for the typed bridge API
  const styleUpdate: ShapeStyleUpdate = {};
  let hasStyleUpdate = false;
  let lastResult: { floatingObjectChanges?: FloatingObjectChange[] } | undefined;

  if (updates.fill !== undefined) {
    styleUpdate.fill = updates.fill as ShapeStyleUpdate['fill'];
    hasStyleUpdate = true;
  }
  if (updates.outline !== undefined) {
    styleUpdate.outline = updates.outline as ShapeStyleUpdate['outline'];
    hasStyleUpdate = true;
  }
  if (updates.text !== undefined) {
    styleUpdate.text = updates.text as ShapeStyleUpdate['text'];
    hasStyleUpdate = true;
  }
  if (updates.shadow !== undefined) {
    styleUpdate.shadow = updates.shadow as ShapeStyleUpdate['shadow'];
    hasStyleUpdate = true;
  }
  if (updates.adjustments !== undefined) {
    styleUpdate.adjustments = updates.adjustments;
    hasStyleUpdate = true;
  }
  if (updates.locked !== undefined) {
    styleUpdate.locked = updates.locked;
    hasStyleUpdate = true;
  }

  if (hasStyleUpdate) {
    lastResult = await ctx.computeBridge.updateShapeStyle(sheetId, shapeId, styleUpdate);
  }

  // Handle visibility, anchor mode, and metadata via generic update path
  if (
    updates.visible !== undefined ||
    updates.anchorMode !== undefined ||
    updates.name !== undefined ||
    updates.lockAspectRatio !== undefined ||
    updates.altTextTitle !== undefined ||
    updates.displayName !== undefined
  ) {
    const genericUpdates: Record<string, unknown> = {};
    if (updates.visible !== undefined) genericUpdates.visible = updates.visible;
    if (updates.name !== undefined) genericUpdates.name = updates.name;
    if (updates.anchorMode !== undefined) {
      genericUpdates.anchor = { anchorMode: updates.anchorMode };
    }
    if (updates.lockAspectRatio !== undefined)
      genericUpdates.lockAspectRatio = updates.lockAspectRatio;
    if (updates.altTextTitle !== undefined) genericUpdates.altTextTitle = updates.altTextTitle;
    if (updates.displayName !== undefined) genericUpdates.displayName = updates.displayName;
    lastResult = await ctx.computeBridge.updateFloatingObject(sheetId, shapeId, genericUpdates);
  }

  // Handle position updates separately
  if (updates.width !== undefined && updates.height !== undefined) {
    lastResult = await ctx.computeBridge.resizeFloatingObjectTyped(sheetId, shapeId, {
      width: updates.width,
      height: updates.height,
    });
  }
  if (updates.rotation !== undefined) {
    lastResult = await ctx.computeBridge.rotateFloatingObjectTyped(
      sheetId,
      shapeId,
      updates.rotation,
    );
  }

  const change = lastResult?.floatingObjectChanges?.[0];
  if (change?.data) {
    return buildMutationReceipt(change, 'update', sheetId);
  }

  return buildFallbackMutationReceipt(sheetId, 'update', shapeId, {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
  });
}

/**
 * Delete a shape from a sheet.
 *
 * @returns A delete receipt for the removed shape
 */
export async function deleteShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
): Promise<FloatingObjectRemoveReceipt> {
  await ctx.computeBridge.deleteFloatingObject(sheetId, shapeId);
  return withFloatingObjectRemoveReceiptBase(
    { domain: 'floatingObject', action: 'remove', id: shapeId },
    sheetId,
  );
}

/**
 * Move a shape to a new position.
 * Throws KernelError if the shape does not exist.
 *
 * @returns A mutation receipt for the moved shape
 */
export async function moveShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  x: number,
  y: number,
): Promise<FloatingObjectMutationReceipt> {
  const result = await ctx.computeBridge.moveFloatingObjectTyped(sheetId, shapeId, {
    type: 'delta',
    dx: x,
    dy: y,
  });

  const change = result.floatingObjectChanges?.[0];
  if (change?.data) {
    return buildMutationReceipt(change, 'update', sheetId);
  }

  return buildFallbackMutationReceipt(sheetId, 'update', shapeId, {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
  });
}

/**
 * Resize a shape.
 * Throws KernelError if the shape does not exist.
 *
 * @returns A mutation receipt for the resized shape
 */
export async function resizeShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  width: number,
  height: number,
): Promise<FloatingObjectMutationReceipt> {
  const result = await ctx.computeBridge.resizeFloatingObjectTyped(sheetId, shapeId, {
    width,
    height,
  });

  const change = result.floatingObjectChanges?.[0];
  if (change?.data) {
    return buildMutationReceipt(change, 'update', sheetId);
  }

  return buildFallbackMutationReceipt(sheetId, 'update', shapeId, {
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
  });
}

/**
 * Rotate a shape.
 * Throws KernelError if the shape does not exist.
 */
export async function rotateShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  angle: number,
): Promise<void> {
  await ctx.computeBridge.rotateFloatingObjectTyped(sheetId, shapeId, angle);
}

/**
 * Flip a shape horizontally or vertically.
 * Throws KernelError if the shape does not exist.
 */
export async function flipShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  direction: 'horizontal' | 'vertical',
): Promise<void> {
  await ctx.computeBridge.flipFloatingObjectTyped(sheetId, shapeId, direction);
}

/**
 * Duplicate a shape.
 *
 * @returns A mutation receipt for the duplicated shape
 */
export async function duplicateShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  offsetX?: number,
  offsetY?: number,
): Promise<FloatingObjectMutationReceipt> {
  const result = await ctx.computeBridge.duplicateFloatingObjectTyped(
    sheetId,
    shapeId,
    offsetX ?? 20,
    offsetY ?? 20,
  );
  const change = result.floatingObjectChanges?.[0];
  if (change?.data) {
    return buildMutationReceipt(change, 'create', sheetId);
  }

  return buildFallbackMutationReceipt(sheetId, 'create', '', {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
  });
}

/**
 * Bring a shape to the front (highest z-index).
 */
export async function bringShapeToFront(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
): Promise<void> {
  await ctx.computeBridge.bringFloatingObjectToFront(sheetId, shapeId);
}

/**
 * Send a shape to the back (lowest z-index).
 */
export async function sendShapeToBack(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
): Promise<void> {
  await ctx.computeBridge.sendFloatingObjectToBack(sheetId, shapeId);
}

// =============================================================================
// Convenience Methods (OfficeJS audit gap closures)
// =============================================================================

/**
 * Increment a shape's rotation by a delta angle.
 * M5: incrementRotation(delta) from OfficeJS audit.
 */
export async function incrementRotation(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  delta: number,
): Promise<void> {
  // Read current rotation, add delta, set new rotation
  const result = await ctx.computeBridge.getFloatingObjectTyped(sheetId, shapeId);
  const currentRotation = result?.rotation ?? 0;
  await ctx.computeBridge.rotateFloatingObjectTyped(sheetId, shapeId, currentRotation + delta);
}

/**
 * Scale a shape's dimensions by width and height factors.
 * P6: scaleHeight/Width(factor) from OfficeJS audit.
 */
export async function scaleShape(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  factorW: number,
  factorH: number,
): Promise<FloatingObjectMutationReceipt> {
  const result = await ctx.computeBridge.getFloatingObjectTyped(sheetId, shapeId);
  const currentWidth = result?.width ?? 100;
  const currentHeight = result?.height ?? 100;
  return resizeShape(ctx, sheetId, shapeId, currentWidth * factorW, currentHeight * factorH);
}

/**
 * Check whether a shape has text content.
 * P17: hasText property from OfficeJS audit.
 */
export function hasText(text: ShapeText | undefined | null): boolean {
  return !!text?.content;
}

/**
 * Delete all text content from a shape.
 * P18: deleteText() from OfficeJS audit.
 */
export async function deleteText(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
): Promise<FloatingObjectMutationReceipt> {
  return updateShape(ctx, sheetId, shapeId, { text: { content: '' } });
}

// =============================================================================
// Text Range Operations
// =============================================================================

/**
 * Get a substring of shape text with its formatting.
 * M16: getSubstring(start, length?) from OfficeJS audit.
 * Extracts from runs if present, else slices content.
 */
export function getSubstring(
  text: ShapeText | undefined | null,
  start: number,
  length?: number,
): { text: string; format?: CellFormat } {
  if (!text) return { text: '' };

  const end = length != null ? start + length : undefined;

  if (text.runs && text.runs.length > 0) {
    let pos = 0;
    const result: { text: string; format?: CellFormat }[] = [];
    for (const run of text.runs) {
      const runStart = pos;
      const runEnd = pos + run.text.length;
      pos = runEnd;
      const overlapStart = Math.max(runStart, start);
      const overlapEnd = end != null ? Math.min(runEnd, end) : runEnd;
      if (overlapStart < overlapEnd) {
        result.push({
          text: run.text.slice(overlapStart - runStart, overlapEnd - runStart),
          format: run.format,
        });
      }
      if (end != null && pos >= end) break;
    }
    if (result.length === 0) return { text: '' };
    if (result.length === 1) return result[0];
    return {
      text: result.map((r) => r.text).join(''),
      format: result[0].format,
    };
  }

  const sliced = text.content.slice(start, end);
  return { text: sliced, format: text.format };
}

/**
 * Set rich text runs on a shape, auto-updating content.
 */
export async function setTextRuns(
  ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  runs: Array<{ text: string; format?: CellFormat }>,
): Promise<FloatingObjectMutationReceipt> {
  const content = runs.map((r) => r.text).join('');
  return updateShape(ctx, sheetId, shapeId, {
    text: { content, runs } as any,
  });
}

/**
 * Get text runs from a shape, synthesizing a single run if runs aren't set.
 */
export function getTextRuns(
  text: ShapeText | undefined | null,
): Array<{ text: string; format?: CellFormat }> {
  if (!text) return [];
  if (text.runs && text.runs.length > 0) return text.runs;
  return text.content ? [{ text: text.content, format: text.format }] : [];
}

// =============================================================================
// Shape Export
// =============================================================================

/**
 * Export a shape as an image.
 * M6: getAsImage(format) from OfficeJS audit.
 * Returns null in environments without OffscreenCanvas support.
 */
export async function getAsImage(
  manager: SpreadsheetObjectManager,
  _ctx: DocumentContext,
  sheetId: SheetId,
  shapeId: string,
  format: 'png' | 'svg' = 'png',
): Promise<Blob | null> {
  void sheetId;

  if (typeof OffscreenCanvas === 'undefined') {
    return null;
  }

  const obj = await manager.getObject(shapeId);
  if (!obj) return null;

  const width = obj.position?.width ?? 200;
  const height = obj.position?.height ?? 200;

  if (format === 'svg') {
    const fill = obj.type === 'shape' ? ((obj as any).fill?.color ?? '#ccc') : '#ccc';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}" /></svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return null;

  if (obj.type === 'shape') {
    const fill = (obj as any).fill?.color ?? '#cccccc';
    ctx2d.fillStyle = fill;
    ctx2d.fillRect(0, 0, width, height);
  }

  return canvas.convertToBlob({ type: 'image/png' });
}

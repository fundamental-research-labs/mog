/**
 * Drawing / Ink Operations Module
 *
 * Extracted from coordinator mutations - standalone functions for drawing
 * floating object operations. All functions take manager: SpreadsheetObjectManager,
 * ctx: DocumentContext, and sheetId: SheetId as the first three params, following
 * the same pattern as equation-operations.ts.
 *
 * Key difference from equation-operations: these operations do NOT emit
 * EventBus events for stroke mutations (drawing:strokeAdded etc. have zero
 * subscribers). The floatingObject:created event is emitted by the caller,
 * not by the drawing manager.
 *
 * Functions throw KernelError on failure instead of returning OperationResult.
 */

import type { StrokeTransformParams } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type {
  CreateDrawingOptions,
  DrawingObject,
  InkStroke,
  StrokeId,
} from '@mog-sdk/contracts/ink';

import type { SpreadsheetObjectManager } from '../../../floating-objects';
import {
  addStrokeToDrawing,
  clearDrawingStrokes as clearDrawingStrokesHelper,
  createDrawing as createDrawingInternal,
  eraseStrokesFromDrawing,
  serializeRecognitionsMap,
  serializeStrokesMap,
} from '../../../domain/drawing/drawing-manager';
import {
  findStrokesAtPoint as coreFindStrokesAtPoint,
  invalidateSpatialIndex,
} from '../../../domain/drawing/drawing-operations';
import { drawingNotFound } from '../../../errors/api';
import { createObjectStore } from '../../../floating-objects/object-store';

import type { DocumentContext } from './shared';

/**
 * Retrieve a drawing object by ID.
 * Returns null if the object does not exist or is not a drawing.
 *
 * Drawing objects are already properly deserialized by the mapper
 * (toDrawingObject in floating-object-mapper.ts converts Record→Map),
 * so no additional conversion is needed.
 */
async function getDrawingObject(
  manager: SpreadsheetObjectManager,
  drawingId: string,
): Promise<DrawingObject | null> {
  const obj = await manager.getObject(drawingId);
  if (!obj || obj.type !== 'drawing') return null;
  return obj as DrawingObject;
}

/**
 * Get a drawing object by ID, throwing if not found.
 */
async function requireDrawing(
  manager: SpreadsheetObjectManager,
  drawingId: string,
): Promise<DrawingObject> {
  const drawing = await getDrawingObject(manager, drawingId);
  if (!drawing) {
    throw drawingNotFound(drawingId);
  }
  return drawing;
}

/**
 * Serialize a DrawingObject (with Map fields) and persist it via ComputeBridge.
 */
async function persistDrawing(ctx: DocumentContext, drawing: DrawingObject): Promise<void> {
  // The serialized form has Record instead of Map, so we pass as unknown
  // to computeBridge.setFloatingObject which accepts unknown.
  const storageObj = {
    ...drawing,
    strokes: serializeStrokesMap(drawing.strokes),
    recognitions: serializeRecognitionsMap(drawing.recognitions),
  };

  await ctx.computeBridge.setFloatingObject(drawing.sheetId, drawing.id, storageObj);
}

// =============================================================================
// Drawing Operations
// =============================================================================

/**
 * Create a new drawing object on a sheet.
 * Throws KernelError if creation fails.
 *
 * @returns The created drawing's ID
 */
export async function createDrawing(
  _manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  position: Partial<ObjectPosition>,
  options?: CreateDrawingOptions,
): Promise<string> {
  const drawing = await createDrawingInternal(
    createObjectStore(ctx.computeBridge),
    ctx.computeBridge,
    sheetId,
    position,
    options,
    undefined,
    null, // Resolver not needed when position.from is provided by caller
  );

  return drawing.id;
}

/**
 * Add a stroke to an existing drawing.
 * Throws KernelError if the drawing does not exist.
 */
export async function addDrawingStroke(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  drawingId: string,
  stroke: InkStroke,
): Promise<void> {
  const drawing = await requireDrawing(manager, drawingId);
  const updatedDrawing = addStrokeToDrawing(drawing, stroke);
  await persistDrawing(ctx, updatedDrawing);
}

/**
 * Erase strokes from a drawing by their IDs.
 * Throws KernelError if the drawing does not exist.
 */
export async function eraseDrawingStrokes(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  drawingId: string,
  strokeIds: StrokeId[],
): Promise<void> {
  const drawing = await requireDrawing(manager, drawingId);
  const updatedDrawing = eraseStrokesFromDrawing(drawing, strokeIds);
  await persistDrawing(ctx, updatedDrawing);
}

/**
 * Clear all strokes from a drawing.
 * Throws KernelError if the drawing does not exist.
 */
export async function clearDrawingStrokes(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  drawingId: string,
): Promise<void> {
  const drawing = await requireDrawing(manager, drawingId);
  const updatedDrawing = clearDrawingStrokesHelper(drawing);
  await persistDrawing(ctx, updatedDrawing);
}

/**
 * Move strokes within a drawing by a delta offset.
 * Throws KernelError if the drawing does not exist.
 */
export async function moveDrawingStrokes(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  drawingId: string,
  strokeIds: StrokeId[],
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const drawing = await requireDrawing(manager, drawingId);

  const updatedStrokes = new Map(drawing.strokes);
  for (const strokeId of strokeIds) {
    const stroke = updatedStrokes.get(strokeId);
    if (stroke) {
      const updatedPoints = stroke.points.map((point) => ({
        ...point,
        x: point.x + deltaX,
        y: point.y + deltaY,
      }));
      updatedStrokes.set(strokeId, { ...stroke, points: updatedPoints });
    }
  }
  const updatedDrawing = { ...drawing, strokes: updatedStrokes };

  await persistDrawing(ctx, updatedDrawing);
  invalidateSpatialIndex(drawingId);
}

/**
 * Apply a geometric transform (rotate, scale, flip) to strokes in a drawing.
 * Throws KernelError if the drawing does not exist.
 */
export async function transformDrawingStrokes(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  _sheetId: SheetId,
  drawingId: string,
  strokeIds: StrokeId[],
  transform: StrokeTransformParams,
): Promise<void> {
  const drawing = await requireDrawing(manager, drawingId);

  // Calculate center from bounding box if not provided
  let centerX = transform.centerX;
  let centerY = transform.centerY;

  if (centerX === undefined || centerY === undefined) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const strokeId of strokeIds) {
      const stroke = drawing.strokes.get(strokeId);
      if (stroke) {
        for (const point of stroke.points) {
          if (point.x < minX) minX = point.x;
          if (point.y < minY) minY = point.y;
          if (point.x > maxX) maxX = point.x;
          if (point.y > maxY) maxY = point.y;
        }
      }
    }

    centerX = centerX ?? (minX + maxX) / 2;
    centerY = centerY ?? (minY + maxY) / 2;
  }

  const updatedStrokes = new Map(drawing.strokes);

  for (const strokeId of strokeIds) {
    const stroke = updatedStrokes.get(strokeId);
    if (!stroke) continue;

    const updatedPoints = stroke.points.map((point) => {
      let x = point.x;
      let y = point.y;

      switch (transform.type) {
        case 'rotate': {
          const angle = transform.angle ?? 0;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const dx = x - centerX!;
          const dy = y - centerY!;
          x = centerX! + dx * cos - dy * sin;
          y = centerY! + dx * sin + dy * cos;
          break;
        }
        case 'scale': {
          const sx = transform.scaleX ?? 1;
          const sy = transform.scaleY ?? 1;
          x = centerX! + (x - centerX!) * sx;
          y = centerY! + (y - centerY!) * sy;
          break;
        }
        case 'flip-horizontal': {
          x = 2 * centerX! - x;
          break;
        }
        case 'flip-vertical': {
          y = 2 * centerY! - y;
          break;
        }
      }

      return { ...point, x, y };
    });

    updatedStrokes.set(strokeId, { ...stroke, points: updatedPoints });
  }

  const updatedDrawing = { ...drawing, strokes: updatedStrokes };

  await persistDrawing(ctx, updatedDrawing);
  invalidateSpatialIndex(drawingId);
}

// =============================================================================
// Query Operations
// =============================================================================

/**
 * Retrieve and deserialize a drawing object by ID (public query).
 * Returns null if the object does not exist or is not a drawing.
 */
export async function queryDrawingObject(
  manager: SpreadsheetObjectManager,
  drawingId: string,
): Promise<DrawingObject | null> {
  return getDrawingObject(manager, drawingId);
}

/**
 * Find strokes at a given point within a drawing using spatial index.
 * Throws KernelError if the drawing does not exist.
 *
 * @returns Array of StrokeIds at the given point
 */
export async function queryStrokesAtPoint(
  manager: SpreadsheetObjectManager,
  drawingId: string,
  x: number,
  y: number,
  tolerance?: number,
): Promise<StrokeId[]> {
  const drawing = await requireDrawing(manager, drawingId);
  return coreFindStrokesAtPoint(drawing, x, y, tolerance);
}

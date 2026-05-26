/**
 * Drawing Manager
 *
 * Standalone functions for drawing-specific operations.
 * Handles creating drawings, adding/erasing strokes, and serialization.
 *
 * Architecture Notes:
 * - Functions accept IObjectStore + ComputeBridge for storage access
 * - Schema-driven initialization using DRAWING_OBJECT_SCHEMA
 * - Uses IPositionResolver for anchor resolution (app-agnostic)
 * - Strokes stored as Map<StrokeId, InkStroke> for CRDT safety
 * - Calls invalidateSpatialIndex on all stroke mutations
 *
 * @see floating-object-manager.ts - Main manager class that integrates these functions
 * @see contracts/src/ink/types.ts - Type contracts for drawing objects
 * @see contracts/src/store/ink-schema.ts - Schema definitions
 */

import type { FloatingObject, ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type {
  CreateDrawingOptions,
  DrawingObject,
  InkStroke,
  InkTool,
  InkToolSettings,
  InkToolState,
  RecognitionResult,
  SerializedStroke,
  StrokeId,
} from '@mog-sdk/contracts/ink';
import { serializeStroke } from '@mog/spreadsheet-utils/ink/types';
import type { IObjectStore, IPositionResolver } from '@mog-sdk/contracts/objects/canvas-object';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import { getAllDefaultToolSettings } from './ink/ink-tool-defaults';

type ObjectPositionResolver = IPositionResolver<ObjectPosition>;

import { invalidateSpatialIndex } from './drawing-operations';

// =============================================================================
// Constants
// =============================================================================

/** Default drawing dimensions */
const DEFAULT_DRAWING_WIDTH = 400;
const DEFAULT_DRAWING_HEIGHT = 300;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique object ID.
 */
function generateObjectId(): string {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get the next z-index for a document (highest current + 1).
 */
async function getNextZIndex(
  store: IObjectStore<FloatingObject>,
  containerId: SheetId,
): Promise<number> {
  const objects = await store.readInDocument(containerId);
  let maxZ = 0;
  for (const obj of objects) {
    if (obj.zIndex > maxZ) {
      maxZ = obj.zIndex;
    }
  }
  return maxZ + 1;
}

/**
 * Normalize a partial position configuration to a full ObjectPosition
 * using the generic IPositionResolver.
 */
function normalizePosition(
  containerId: SheetId,
  partial: Partial<ObjectPosition>,
  defaultWidth: number,
  defaultHeight: number,
  resolver: ObjectPositionResolver | null,
): ObjectPosition {
  const anchorType = partial.anchorType ?? 'oneCell';

  // If the caller already provided a `from` anchor, use it as-is.
  // Otherwise, ask the resolver to create a default anchor at origin.
  let from = partial.from;
  if (!from) {
    if (resolver) {
      const resolvedPosition = resolver.fromPixels(
        containerId,
        10,
        10,
        defaultWidth,
        defaultHeight,
      );
      from = resolvedPosition.from ?? {
        cellId: toCellId('__placeholder__'),
        xOffset: 10,
        yOffset: 10,
      };
    } else {
      // Fallback - shouldn't happen in normal flow
      from = { cellId: toCellId('__placeholder__'), xOffset: 10, yOffset: 10 };
      console.warn('[drawing-manager] resolver not set, using placeholder anchor');
    }
  }

  return {
    anchorType,
    from: from!,
    to: partial.to,
    x: partial.x,
    y: partial.y,
    width: partial.width ?? defaultWidth,
    height: partial.height ?? defaultHeight,
    rotation: partial.rotation ?? 0,
    flipH: partial.flipH,
    flipV: partial.flipV,
  };
}

/**
 * Create default tool state using schema defaults.
 */
function createDefaultToolState(overrides?: Partial<InkToolState>): InkToolState {
  const defaults = getAllDefaultToolSettings();
  return {
    activeTool: overrides?.activeTool ?? 'pen',
    toolSettings: overrides?.toolSettings ?? defaults,
  };
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/**
 * Serialize a strokes Map to a plain object for storage.
 *
 * @param strokes - Map of stroke IDs to strokes
 * @returns Plain object suitable for storage
 */
export function serializeStrokesMap(
  strokes: Map<StrokeId, InkStroke>,
): Record<string, SerializedStroke> {
  const result: Record<string, SerializedStroke> = {};
  for (const [id, stroke] of strokes) {
    result[id] = serializeStroke(stroke);
  }
  return result;
}

/**
 * Serialize recognitions Map to plain object.
 */
export function serializeRecognitionsMap(
  recognitions: Map<string, RecognitionResult>,
): Record<string, RecognitionResult> {
  const result: Record<string, RecognitionResult> = {};
  for (const [id, recognition] of recognitions) {
    result[id] = recognition;
  }
  return result;
}

// =============================================================================
// Drawing Creation
// =============================================================================

/**
 * Create a new drawing object with schema-driven defaults.
 *
 * @param store - Object store for floating objects
 * @param computeBridge - ComputeBridge for persistence
 * @param containerId - Container (sheet/page) to create the drawing in
 * @param position - Initial position configuration (partial)
 * @param options - Optional drawing configuration
 * @param nameGenerator - Function to generate unique drawing names
 * @param resolver - Position resolver for anchor creation
 * @returns The created drawing object
 *
 * @example
 * ```typescript
 * const drawing = await createDrawing(store, computeBridge, 'sheet-1', {
 *   from: { cellId: 'abc-123', xOffset: 10, yOffset: 10 },
 *   width: 400,
 *   height: 300
 * }, {
 *   name: 'My Drawing',
 *   backgroundColor: '#ffffff'
 * }, undefined, resolver);
 * ```
 */
export async function createDrawing(
  store: IObjectStore<FloatingObject>,
  computeBridge: ComputeBridge,
  containerId: SheetId,
  position: Partial<ObjectPosition>,
  options?: CreateDrawingOptions,
  nameGenerator?: () => string,
  resolver?: ObjectPositionResolver | null,
): Promise<DrawingObject> {
  const id = generateObjectId();
  const now = Date.now();

  // Pre-compute position
  const normalizedPosition = normalizePosition(
    containerId,
    position,
    DEFAULT_DRAWING_WIDTH,
    DEFAULT_DRAWING_HEIGHT,
    resolver ?? null,
  );

  // Create tool state with defaults
  const toolState = createDefaultToolState(options?.toolState);

  // Get z-index from existing objects
  const zIndex = await getNextZIndex(store, containerId);

  const drawingObj: DrawingObject = {
    id,
    type: 'drawing',
    sheetId: containerId,
    containerId,
    anchor: normalizedPosition,
    position: normalizedPosition,
    zIndex,
    locked: options?.locked ?? false,
    printable: options?.printable ?? true,
    name: options?.name ?? nameGenerator?.() ?? `Drawing ${id.slice(-4)}`,
    altText: options?.altText,
    createdAt: now,
    updatedAt: now,
    // Drawing-specific fields
    strokes: new Map<StrokeId, InkStroke>(),
    toolState,
    recognitions: new Map<string, RecognitionResult>(),
    backgroundColor: options?.backgroundColor,
  };

  // For storage, serialize the Maps to plain objects.
  // The serialized form differs from DrawingObject (Record vs Map), so we
  // persist via computeBridge.setFloatingObject directly (accepts unknown).
  const storageObj = {
    ...drawingObj,
    strokes: serializeStrokesMap(drawingObj.strokes),
    recognitions: serializeRecognitionsMap(drawingObj.recognitions),
  };

  await computeBridge.setFloatingObject(containerId, drawingObj.id, storageObj);

  return drawingObj;
}

// =============================================================================
// Stroke Operations
// =============================================================================

/**
 * Add a stroke to a drawing (Map-based).
 *
 * @param drawing - The drawing object to modify
 * @param stroke - The stroke to add
 * @returns Updated drawing object with the new stroke
 */
export function addStrokeToDrawing(drawing: DrawingObject, stroke: InkStroke): DrawingObject {
  // Create new Map with existing strokes plus new one
  const newStrokes = new Map(drawing.strokes);
  newStrokes.set(stroke.id, stroke);

  // Invalidate spatial index for this drawing
  invalidateSpatialIndex(drawing.id);

  return {
    ...drawing,
    strokes: newStrokes,
    updatedAt: Date.now(),
  };
}

/**
 * Erase strokes from a drawing (Map-based).
 *
 * @param drawing - The drawing object to modify
 * @param strokeIds - Array of stroke IDs to erase
 * @returns Updated drawing object with strokes removed
 */
export function eraseStrokesFromDrawing(
  drawing: DrawingObject,
  strokeIds: StrokeId[],
): DrawingObject {
  if (strokeIds.length === 0) return drawing;

  // Create new Map without the erased strokes
  const newStrokes = new Map(drawing.strokes);
  for (const id of strokeIds) {
    newStrokes.delete(id);
  }

  // Invalidate spatial index for this drawing
  invalidateSpatialIndex(drawing.id);

  return {
    ...drawing,
    strokes: newStrokes,
    updatedAt: Date.now(),
  };
}

/**
 * Clear all strokes from a drawing.
 *
 * @param drawing - The drawing object to clear
 * @returns Updated drawing object with no strokes
 */
export function clearDrawingStrokes(drawing: DrawingObject): DrawingObject {
  // Invalidate spatial index for this drawing
  invalidateSpatialIndex(drawing.id);

  return {
    ...drawing,
    strokes: new Map<StrokeId, InkStroke>(),
    updatedAt: Date.now(),
  };
}

// =============================================================================
// Tool State Operations
// =============================================================================

/**
 * Update tool state for a drawing.
 *
 * @param drawing - The drawing object to modify
 * @param updates - Partial tool state updates
 * @returns Updated drawing object with new tool state
 */
export function updateDrawingToolState(
  drawing: DrawingObject,
  updates: Partial<InkToolState>,
): DrawingObject {
  return {
    ...drawing,
    toolState: {
      ...drawing.toolState,
      ...updates,
    },
    updatedAt: Date.now(),
  };
}

/**
 * Set the active tool for a drawing.
 *
 * @param drawing - The drawing object
 * @param tool - The tool to set as active
 * @returns Updated drawing object
 */
export function setActiveTool(drawing: DrawingObject, tool: InkTool): DrawingObject {
  return updateDrawingToolState(drawing, { activeTool: tool });
}

/**
 * Update settings for a specific tool.
 *
 * @param drawing - The drawing object
 * @param tool - The tool to update
 * @param settings - Partial settings to merge
 * @returns Updated drawing object
 */
export function updateToolSettings(
  drawing: DrawingObject,
  tool: InkTool,
  settings: Partial<InkToolSettings>,
): DrawingObject {
  const currentSettings = drawing.toolState.toolSettings[tool];
  return updateDrawingToolState(drawing, {
    toolSettings: {
      ...drawing.toolState.toolSettings,
      [tool]: {
        ...currentSettings,
        ...settings,
      },
    },
  });
}

// =============================================================================
// Recognition Operations
// =============================================================================

/**
 * Add a recognition result to a drawing.
 *
 * @param drawing - The drawing object
 * @param recognitionId - Unique ID for this recognition
 * @param result - The recognition result
 * @returns Updated drawing object
 */
export function addRecognitionToDrawing(
  drawing: DrawingObject,
  recognitionId: string,
  result: RecognitionResult,
): DrawingObject {
  const newRecognitions = new Map(drawing.recognitions);
  newRecognitions.set(recognitionId, result);

  return {
    ...drawing,
    recognitions: newRecognitions,
    updatedAt: Date.now(),
  };
}

/**
 * Remove a recognition result from a drawing.
 *
 * @param drawing - The drawing object
 * @param recognitionId - ID of the recognition to remove
 * @returns Updated drawing object
 */
export function removeRecognitionFromDrawing(
  drawing: DrawingObject,
  recognitionId: string,
): DrawingObject {
  const newRecognitions = new Map(drawing.recognitions);
  newRecognitions.delete(recognitionId);

  return {
    ...drawing,
    recognitions: newRecognitions,
    updatedAt: Date.now(),
  };
}

// =============================================================================
// Type Guard
// =============================================================================

/**
 * Check if a floating object is a drawing.
 *
 * @param obj - The floating object to check
 * @returns True if the object is a drawing
 */
export function isDrawing(obj: FloatingObject): obj is DrawingObject {
  return obj.type === 'drawing';
}

// TODO: Migrate WorksheetObjects to use containerId-aware canvas object types.

/**
 * WorksheetObjects — Sub-API Interface for Floating Object Operations
 *
 * Generic floating object operations (move, resize, rotate, flip, z-order,
 * grouping), plus type-specific creation/update for shapes, pictures,
 * text boxes, equations, TextEffect, Diagram, and drawings (ink).
 */
import type {
  CreateDrawingOptions,
  DrawingObject,
  InkStroke,
  StrokeId,
} from '@mog/types-objects/ink';
import type { ObjectBounds } from '@mog/types-objects/objects/floating-object-manager';
import type { ObjectPosition } from '@mog/types-objects/objects/floating-objects';
import type { TextWarpPreset } from '@mog/types-objects/text-effects';
import type {
  FloatingObjectRemoveReceipt,
  FloatingObjectMutationReceipt,
} from '../mutation-receipt';
import type {
  EquationConfig,
  EquationUpdates,
  FloatingObjectInfo,
  PictureConfig,
  CreateTextEffectInput,
  Shape,
  ShapeConfig,
  StrokeTransformParams,
  TextBoxConfig,
  TextEffectUpdates,
} from '../types';

export interface WorksheetObjects {
  // ===========================================================================
  // Generic floating object operations
  // ===========================================================================

  /** Remove any floating object by ID. */
  remove(id: string): Promise<FloatingObjectRemoveReceipt>;

  /** Move any floating object to a new position. */
  move(id: string, x: number, y: number): Promise<FloatingObjectMutationReceipt>;

  /** Resize any floating object. */
  resize(id: string, width: number, height: number): Promise<FloatingObjectMutationReceipt>;

  /** Rotate any floating object to the given angle (degrees). */
  rotate(id: string, angle: number): Promise<void>;

  /** Flip any floating object horizontally or vertically. */
  flip(id: string, direction: 'horizontal' | 'vertical'): Promise<void>;

  /** Duplicate any floating object. Returns a receipt with the new object. */
  duplicate(id: string): Promise<FloatingObjectMutationReceipt>;

  /** List all floating objects on the sheet. */
  list(): Promise<FloatingObjectInfo[]>;

  /** Get a floating object by ID. Returns null if not found on this sheet. */
  get(objectId: string): Promise<FloatingObjectInfo | null>;

  /** Check if a floating object exists by ID. */
  has(objectId: string): Promise<boolean>;

  /** Get the total number of floating objects on this sheet. */
  getCount(): Promise<number>;

  /** Remove all floating objects from the sheet. */
  clear(): Promise<void>;

  /** Compute pixel bounding box for a floating object (async — uses ComputeBridge). */
  computeObjectBounds(objectId: string): Promise<ObjectBounds | null>;

  /** Batch-compute pixel bounds for all floating objects on this sheet. */
  computeAllObjectBounds(): Promise<Map<string, ObjectBounds>>;

  /** Update arbitrary properties of a floating object. */
  update(
    objectId: string,
    updates: Record<string, unknown>,
  ): Promise<FloatingObjectMutationReceipt>;

  /** Remove multiple floating objects. Returns count of successfully removed objects. */
  removeMany(objectIds: string[]): Promise<number>;

  // ===========================================================================
  // Z-order
  // ===========================================================================

  /** Bring a floating object to the front (highest z-order). */
  bringToFront(id: string): Promise<void>;

  /** Send a floating object to the back (lowest z-order). */
  sendToBack(id: string): Promise<void>;

  /** Bring a floating object forward by one layer. */
  bringForward(id: string): Promise<void>;

  /** Send a floating object backward by one layer. */
  sendBackward(id: string): Promise<void>;

  // ===========================================================================
  // Grouping
  // ===========================================================================

  /** Group multiple floating objects. Returns the group ID. */
  group(ids: string[]): Promise<string>;

  /** Ungroup a floating object group. */
  ungroup(groupId: string): Promise<void>;

  // ===========================================================================
  // Shapes
  // ===========================================================================

  /** Add a shape to the sheet. Returns a receipt with the new shape. */
  addShape(config: ShapeConfig): Promise<FloatingObjectMutationReceipt>;

  /** Get a shape by ID, or null if not found. */
  getShape(shapeId: string): Promise<Shape | null>;

  /** Update a shape's configuration. */
  updateShape(
    shapeId: string,
    updates: Partial<ShapeConfig>,
  ): Promise<FloatingObjectMutationReceipt>;

  /** List all shapes in the sheet. */
  listShapes(): Promise<Shape[]>;

  // ===========================================================================
  // Pictures
  // ===========================================================================

  /** Add a picture to the sheet. Returns a receipt with the new picture. */
  addPicture(config: PictureConfig): Promise<FloatingObjectMutationReceipt>;

  /** Update a picture's properties. */
  updatePicture(
    id: string,
    updates: Partial<PictureConfig>,
  ): Promise<FloatingObjectMutationReceipt>;

  // ===========================================================================
  // Text boxes
  // ===========================================================================

  /** Add a text box to the sheet. Returns a receipt with the new text box. */
  addTextBox(config: TextBoxConfig): Promise<FloatingObjectMutationReceipt>;

  // ===========================================================================
  // Equations
  // ===========================================================================

  /** Add an equation to the sheet. Returns a receipt with the new equation ID. */
  addEquation(config: EquationConfig): Promise<FloatingObjectMutationReceipt>;

  /** Update an existing equation. */
  updateEquation(id: string, updates: EquationUpdates): Promise<FloatingObjectMutationReceipt>;

  // ===========================================================================
  // TextEffect
  // ===========================================================================

  /** Add TextEffect to the sheet. Returns a receipt with the new TextEffect ID. */
  addTextEffect(config: CreateTextEffectInput): Promise<FloatingObjectMutationReceipt>;

  /** Update existing TextEffect. */
  updateTextEffect(id: string, updates: TextEffectUpdates): Promise<FloatingObjectMutationReceipt>;

  /** Convert a regular text box to TextEffect by applying TextEffect styling. */
  convertToTextEffect(objectId: string, warpPreset?: TextWarpPreset): Promise<void>;

  /** Convert decorative text back to a regular text box by removing text-effect styling. */
  convertToTextBox(objectId: string): Promise<void>;

  // ===========================================================================
  // Drawings (ink)
  // ===========================================================================

  /** Create a new drawing object. Returns a receipt with the new drawing ID. */
  createDrawing(
    position: Partial<ObjectPosition>,
    options?: CreateDrawingOptions,
  ): Promise<FloatingObjectMutationReceipt>;

  /** Add a completed stroke to a drawing. */
  addDrawingStroke(drawingId: string, stroke: InkStroke): Promise<void>;

  /** Erase strokes from a drawing by their IDs. */
  eraseDrawingStrokes(drawingId: string, strokeIds: StrokeId[]): Promise<void>;

  /** Clear all strokes from a drawing. */
  clearDrawingStrokes(drawingId: string): Promise<void>;

  /** Move strokes by a delta offset. */
  moveDrawingStrokes(
    drawingId: string,
    strokeIds: StrokeId[],
    deltaX: number,
    deltaY: number,
  ): Promise<void>;

  /** Transform strokes (rotate, scale, flip). */
  transformDrawingStrokes(
    drawingId: string,
    strokeIds: StrokeId[],
    transform: StrokeTransformParams,
  ): Promise<void>;

  /** Get a drawing object by ID, with deserialized Maps. Returns null if not found. */
  getDrawing(drawingId: string): Promise<DrawingObject | null>;

  /** Find strokes at a point using spatial index. Returns stroke IDs. */
  findStrokesAtPoint(
    drawingId: string,
    x: number,
    y: number,
    tolerance?: number,
  ): Promise<StrokeId[]>;

  // ===========================================================================
  // Connector Connections
  // ===========================================================================

  /** Connect the start of a connector to a target shape at a connection site. */
  connectBeginShape(connectorId: string, targetShapeId: string, siteIndex: number): Promise<void>;

  /** Connect the end of a connector to a target shape at a connection site. */
  connectEndShape(connectorId: string, targetShapeId: string, siteIndex: number): Promise<void>;

  /** Disconnect the start of a connector from its connected shape. */
  disconnectBeginShape(connectorId: string): Promise<void>;

  /** Disconnect the end of a connector from its connected shape. */
  disconnectEndShape(connectorId: string): Promise<void>;

  /** Get connection data for a connector (which shapes it connects to). */
  getConnectorData(connectorId: string): Promise<{
    startConnection?: { shapeId: string; siteIndex: number };
    endConnection?: { shapeId: string; siteIndex: number };
  } | null>;

  // ===========================================================================
  // Group Queries
  // ===========================================================================

  /** Get the member object IDs of a floating object group. */
  getGroupMembers(groupId: string): Promise<string[]>;

  // ===========================================================================
  // Image Queries
  // ===========================================================================

  /** Get the image format (png, jpeg, gif, etc.) for a picture object. */
  getImageFormat(objectId: string): Promise<string | null>;

  /**
   * Get the number of connection sites on a shape.
   * Most standard shapes have 4 connection sites (top, right, bottom, left).
   * Returns 0 if the object is not found.
   */
  getConnectionSiteCount(objectId: string): Promise<number>;
}

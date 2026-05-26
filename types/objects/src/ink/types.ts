/**
 * Ink Data Model Types
 *
 * Core type definitions for the ink/drawing engine. This module provides
 * the foundational data structures for pen-based drawing, handwriting
 * recognition, and shape detection.
 *
 * ARCHITECTURE NOTES:
 * - Schema-Driven Initialization: All structures defined by schemas (see ink-schema.ts)
 * - CRDT-Safe Design: Uses Map<StrokeId, InkStroke> instead of arrays to avoid ordering conflicts
 * - Cell Identity Model: DrawingObject uses CellId for anchors (survives row/col insert/delete)
 * - Contracts-First: All types in contracts/, no implementation logic
 *
 * SYNC NOTE: The Rust source of truth for wire types is in compute-core. The bridge
 * codegen produces matching types in kernel/bridges/compute/compute-types.gen.ts
 * (DrawingData, InkStroke, InkPoint, InkTool, InkToolState, InkToolSettings,
 * RecognitionResult, RecognitionBounds, ShapeRecognitionParams, TextAlternative).
 * These domain types intentionally differ from the wire types:
 * - StrokeId is a branded string type (wire uses plain string)
 * - InkToolState.toolSettings uses Record<InkTool, ...> (wire uses Record<string, ...>)
 * - DrawingObject uses Map<> fields (wire uses Record<>)
 * When updating these types, ensure the wire types stay compatible.
 *
 */

import type { FloatingObjectBase, ObjectPosition } from '../objects/floating-object-types';

// =============================================================================
// Branded Types for Type Safety
// =============================================================================

/**
 * Unique identifier for a stroke within a drawing.
 *
 * Branded type provides type safety - prevents accidentally using
 * string IDs where StrokeId is expected (and vice versa).
 *
 * Uses UUID v7 (time-sortable) for:
 * - Uniqueness across clients (no coordination needed)
 * - Time-sortability for undo/redo ordering
 * - Compact string representation
 */
export type StrokeId = string & { readonly __brand: 'StrokeId' };

// =============================================================================
// Core Ink Types
// =============================================================================

/**
 * A single point in a stroke with pressure and tilt support.
 *
 * Coordinates are in local drawing object space (pixels relative to
 * drawing object bounds). Transform to sheet coordinates happens at render time.
 *
 * Pressure and tilt are normalized to [0, 1] ranges for consistent
 * rendering regardless of input device.
 */
export interface InkPoint {
  /** X coordinate in drawing object local space (pixels) */
  x: number;
  /** Y coordinate in drawing object local space (pixels) */
  y: number;
  /**
   * Pen pressure normalized to [0, 1].
   * - 0 = minimum pressure (or mouse with no pressure support)
   * - 1 = maximum pressure
   * - undefined = no pressure data (mouse, touch without pressure)
   *
   * Used for variable stroke width rendering.
   */
  pressure?: number;
  /**
   * Tilt angle in radians [0, PI/2].
   * - 0 = perpendicular to surface
   * - PI/2 = parallel to surface
   * - undefined = no tilt data
   *
   * Used for brush shape and texture effects.
   */
  tilt?: number;
  /**
   * Timestamp when this point was captured (ms since stroke start).
   * Used for velocity calculations and replay animations.
   * - undefined = no timing data
   */
  timestamp?: number;
}

/**
 * Available ink tools for drawing.
 *
 * Each tool has different rendering characteristics:
 * - pen: Solid line, pressure-sensitive width
 * - pencil: Textured line, slight transparency
 * - highlighter: Wide, semi-transparent, blends with background
 * - marker: Bold, opaque, consistent width
 * - brush: Artistic brush effects, pressure-sensitive
 * - eraser: Removes strokes (not a drawing tool, but handled similarly)
 */
export type InkTool = 'pen' | 'pencil' | 'highlighter' | 'marker' | 'brush' | 'eraser';

/**
 * Selection mode for selecting strokes within a drawing.
 *
 * Note: Selection is triggered via modifier key (e.g., holding Shift),
 * not as a separate tool. This matches common drawing app UX patterns.
 *
 * - 'lasso': Free-form selection boundary
 * - 'rectangle': Rectangular selection box
 */
export type SelectionMode = 'lasso' | 'rectangle';

/**
 * A complete ink stroke with all rendering properties.
 *
 * Strokes are immutable once created - modifications create new strokes
 * with the same ID (for CRDT merge semantics).
 */
export interface InkStroke {
  /** Unique identifier for this stroke */
  id: StrokeId;

  /** Ordered array of points composing the stroke */
  points: InkPoint[];

  /** Tool used to create this stroke */
  tool: InkTool;

  /** Stroke color in CSS color format (hex, rgb, hsl) */
  color: string;

  /**
   * Base stroke width in pixels.
   * Actual rendered width may vary with pressure.
   */
  width: number;

  /**
   * Stroke opacity [0, 1].
   * - 0 = fully transparent
   * - 1 = fully opaque
   *
   * Different tools have different default opacities
   * (e.g., highlighter defaults to ~0.4).
   */
  opacity: number;

  /**
   * User ID who created this stroke.
   * Used for:
   * - Collaboration: Show who drew what
   * - Permissions: Only creator can modify their strokes
   * - Undo: Per-user undo stacks
   */
  createdBy: string;

  /**
   * Timestamp when stroke was created (Unix ms).
   * Used for ordering and undo/redo.
   */
  createdAt: number;

  /**
   * Whether this stroke is currently selected.
   * This is a transient UI state, not persisted.
   */
  selected?: boolean;
}

// =============================================================================
// Serialization Types (for efficient storage)
// =============================================================================

/**
 * Serialized point format for storage efficiency.
 *
 * Points are stored as flat arrays [x, y, pressure?, tilt?, timestamp?]
 * to reduce JSON overhead. Undefined values are omitted.
 */
export type SerializedPoint = [number, number, number?, number?, number?];

/**
 * Serialized stroke format for efficient Yjs/CRDT storage.
 *
 * Uses flat point array format to minimize storage size and
 * reduce CRDT merge overhead.
 */
export interface SerializedStroke {
  /** Unique identifier */
  id: StrokeId;
  /** Points as flat arrays for efficiency */
  points: SerializedPoint[];
  /** Tool type */
  tool: InkTool;
  /** Color string */
  color: string;
  /** Width in pixels */
  width: number;
  /** Opacity [0, 1] */
  opacity: number;
  /** Creator user ID */
  createdBy: string;
  /** Creation timestamp */
  createdAt: number;
}

// =============================================================================
// Tool Settings Types
// =============================================================================

/**
 * Default settings for a specific ink tool.
 *
 * Each tool can have different defaults for width, opacity, etc.
 * These are used when creating new strokes.
 */
export interface InkToolSettings {
  /** Default stroke width in pixels */
  width: number;
  /** Default opacity [0, 1] */
  opacity: number;
  /** Default color (CSS color string) */
  color: string;
  /**
   * Whether this tool supports pressure sensitivity.
   * Some tools (e.g., highlighter) ignore pressure.
   */
  supportsPressure: boolean;
}

/**
 * Current tool state for a drawing session.
 *
 * Tracks the active tool and its settings.
 */
export interface InkToolState {
  /** Currently selected tool */
  activeTool: InkTool;
  /** Per-tool settings (user preferences) */
  toolSettings: Record<InkTool, InkToolSettings>;
}

// =============================================================================
// Recognition Types
// =============================================================================

/**
 * Parameters for a recognized line shape.
 */
export interface LineShapeParams {
  type: 'line';
  /** Start point */
  x1: number;
  y1: number;
  /** End point */
  x2: number;
  y2: number;
  /** Rotation angle in radians (0 = horizontal) */
  rotation: number;
}

/**
 * Parameters for a recognized rectangle shape.
 */
export interface RectangleShapeParams {
  type: 'rectangle';
  /** Top-left corner */
  x: number;
  y: number;
  /** Dimensions */
  width: number;
  height: number;
  /** Rotation angle in radians (0 = axis-aligned) */
  rotation: number;
  /** Corner radius for rounded rectangles (0 = sharp corners) */
  cornerRadius?: number;
}

/**
 * Parameters for a recognized ellipse/circle shape.
 */
export interface EllipseShapeParams {
  type: 'ellipse';
  /** Center point */
  cx: number;
  cy: number;
  /** Radii */
  rx: number;
  ry: number;
  /** Rotation angle in radians */
  rotation: number;
}

/**
 * Parameters for a recognized triangle shape.
 */
export interface TriangleShapeParams {
  type: 'triangle';
  /** Three vertices */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  /** Rotation angle in radians */
  rotation: number;
}

/**
 * Parameters for a recognized arrow shape.
 */
export interface ArrowShapeParams {
  type: 'arrow';
  /** Start point (tail) */
  x1: number;
  y1: number;
  /** End point (head) */
  x2: number;
  y2: number;
  /** Arrow head size in pixels */
  headSize: number;
  /** Rotation angle in radians */
  rotation: number;
  /** Whether arrow has head at start (bidirectional) */
  hasStartHead?: boolean;
}

/**
 * Parameters for a recognized star shape.
 */
export interface StarShapeParams {
  type: 'star';
  /** Center point */
  cx: number;
  cy: number;
  /** Outer radius (tip of points) */
  outerRadius: number;
  /** Inner radius (between points) */
  innerRadius: number;
  /** Number of points */
  points: number;
  /** Rotation angle in radians */
  rotation: number;
}

/**
 * Union type for all shape parameter types.
 */
export type ShapeParams =
  | LineShapeParams
  | RectangleShapeParams
  | EllipseShapeParams
  | TriangleShapeParams
  | ArrowShapeParams
  | StarShapeParams;

/**
 * Type of recognized shape.
 */
export type RecognizedShapeType = 'line' | 'rectangle' | 'ellipse' | 'triangle' | 'arrow' | 'star';

/**
 * A shape recognized from one or more ink strokes.
 *
 * Recognition converts freehand strokes into clean geometric shapes
 * while preserving the original strokes for undo/redo.
 */
export interface RecognizedShape {
  /** Type discriminator */
  type: 'shape';

  /** Recognized shape type */
  shapeType: RecognizedShapeType;

  /** Shape parameters (position, dimensions, etc.) */
  params: ShapeParams;

  /**
   * IDs of the source strokes that were recognized as this shape.
   * Used for:
   * - Undo: Can restore original strokes
   * - Styling: Shape inherits color/width from source strokes
   */
  sourceStrokeIds: StrokeId[];

  /** Confidence score [0, 1] for the recognition */
  confidence: number;

  /** Timestamp when recognition occurred */
  recognizedAt: number;
}

/**
 * A text segment recognized from handwriting.
 *
 * Represents an alternative interpretation of the handwriting
 * with its confidence score.
 */
export interface TextAlternative {
  /** Recognized text */
  text: string;
  /** Confidence score [0, 1] */
  confidence: number;
}

/**
 * Text recognized from handwritten ink strokes.
 *
 * Handwriting recognition converts ink to text with multiple
 * alternative interpretations ranked by confidence.
 */
export interface RecognizedText {
  /** Type discriminator */
  type: 'text';

  /** Primary recognized text (highest confidence) */
  text: string;

  /**
   * Alternative interpretations ranked by confidence.
   * First element is same as `text` field.
   */
  alternatives: TextAlternative[];

  /**
   * IDs of the source strokes that were recognized as this text.
   * Used for undo and re-recognition.
   */
  sourceStrokeIds: StrokeId[];

  /** Bounding box for the recognized text */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /** Timestamp when recognition occurred */
  recognizedAt: number;
}

/**
 * Union type for all recognition results.
 */
export type RecognitionResult = RecognizedShape | RecognizedText;

// =============================================================================
// Drawing Object Types
// =============================================================================

/**
 * Drawing object floating on the spreadsheet.
 *
 * Extends FloatingObjectBase to integrate with the existing floating
 * object system (selection, drag, resize, z-order, etc.).
 *
 * CRDT-SAFE DESIGN:
 * - Strokes stored as Map<StrokeId, InkStroke> to avoid array ordering conflicts
 * - Uses CellId for anchors (survives row/col insert/delete)
 * - Y.Map under the hood for concurrent editing support
 */
export interface DrawingObject extends FloatingObjectBase {
  type: 'drawing';

  /**
   * Strokes in this drawing, keyed by StrokeId.
   *
   * Using Map<StrokeId, InkStroke> instead of array for CRDT safety:
   * - No ordering conflicts when concurrent users add strokes
   * - O(1) lookup/delete by ID
   * - Stable references across edits
   *
   * Render order is determined by stroke createdAt timestamps.
   */
  strokes: Map<StrokeId, InkStroke>;

  /**
   * Current tool settings for this drawing.
   * Persisted per-drawing to remember user preferences.
   */
  toolState: InkToolState;

  /**
   * Recognition results for strokes in this drawing.
   * Maps from a "recognition ID" to the result.
   * A recognition can be:
   * - A shape recognized from one or more strokes
   * - Text recognized from handwriting strokes
   */
  recognitions: Map<string, RecognitionResult>;

  /**
   * Background color of the drawing canvas.
   * - undefined = transparent (shows sheet grid)
   * - CSS color string = solid background
   */
  backgroundColor?: string;
}

/**
 * Options for creating a new drawing object.
 */
export interface CreateDrawingOptions {
  /** Optional name for the drawing object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Whether the drawing is locked */
  locked?: boolean;
  /** Whether the drawing appears in print */
  printable?: boolean;
  /** Initial background color */
  backgroundColor?: string;
  /** Initial tool settings */
  toolState?: Partial<InkToolState>;
}

// =============================================================================
// Manager Interface Extensions
// =============================================================================

/**
 * Extension to IFloatingObjectManager for drawing operations.
 *
 * These methods are added to the existing floating object manager
 * interface to support ink/drawing functionality.
 */
export interface IDrawingObjectManager {
  /**
   * Create a new drawing object.
   *
   * @param sheetId - Sheet to create the drawing in
   * @param position - Initial position configuration
   * @param options - Optional drawing configuration
   * @returns The created drawing object
   */
  createDrawing(
    sheetId: string,
    position: Partial<ObjectPosition>,
    options?: CreateDrawingOptions,
  ): DrawingObject;

  /**
   * Add a stroke to a drawing.
   *
   * @param drawingId - ID of the drawing object
   * @param stroke - The stroke to add
   */
  addStroke(drawingId: string, stroke: InkStroke): void;

  /**
   * Remove a stroke from a drawing.
   *
   * @param drawingId - ID of the drawing object
   * @param strokeId - ID of the stroke to remove
   */
  removeStroke(drawingId: string, strokeId: StrokeId): void;

  /**
   * Update a stroke's properties.
   *
   * @param drawingId - ID of the drawing object
   * @param strokeId - ID of the stroke to update
   * @param updates - Partial stroke properties to update
   */
  updateStroke(drawingId: string, strokeId: StrokeId, updates: Partial<InkStroke>): void;

  /**
   * Get all strokes in a drawing ordered by creation time.
   *
   * Since strokes are stored in a Map for CRDT safety, this method
   * provides ordered iteration for rendering.
   *
   * @param drawingId - ID of the drawing object
   * @returns Array of strokes ordered by createdAt timestamp
   */
  getOrderedStrokes(drawingId: string): InkStroke[];

  /**
   * Add a recognition result to a drawing.
   *
   * @param drawingId - ID of the drawing object
   * @param recognitionId - Unique ID for this recognition
   * @param result - The recognition result (shape or text)
   */
  addRecognition(drawingId: string, recognitionId: string, result: RecognitionResult): void;

  /**
   * Remove a recognition result from a drawing.
   *
   * @param drawingId - ID of the drawing object
   * @param recognitionId - ID of the recognition to remove
   */
  removeRecognition(drawingId: string, recognitionId: string): void;

  /**
   * Update tool state for a drawing.
   *
   * @param drawingId - ID of the drawing object
   * @param toolState - New tool state
   */
  setToolState(drawingId: string, toolState: InkToolState): void;

  /**
   * Get the current tool state for a drawing.
   *
   * @param drawingId - ID of the drawing object
   * @returns Current tool state
   */
  getToolState(drawingId: string): InkToolState;
}

// =============================================================================
// Ink Accessor for Rendering
// =============================================================================

/**
 * Interface for accessing ink state during rendering.
 *
 * This is a minimal interface used by canvas-renderer to display live
 * stroke previews during ink drawing mode. It abstracts the ink machine
 * state to avoid direct XState dependencies in the renderer.
 *
 * @see canvas-renderer/src/layers/overlay-layer.ts - Consumer
 * @see state-machines/src/ink/accessor.ts - Provider
 */
export interface InkAccessorForRendering {
  /** Check if currently stroking */
  isStroking(): boolean;
  /** Check if currently erasing */
  isErasing(): boolean;
  /** Check if currently selecting with lasso */
  isSelecting(): boolean;
  /** Get target drawing object ID */
  getTargetDrawingId(): string | null;
  /** Get current stroke points */
  getCurrentStroke(): InkPoint[];
  /** Get active ink tool */
  getActiveTool(): InkTool;
  /** Get active stroke color */
  getActiveColor(): string;
  /** Get active stroke width */
  getActiveWidth(): number;
  /** Get active stroke opacity */
  getActiveOpacity(): number;
  /** Get lasso selection points */
  getLassoPoints(): InkPoint[];
  /** Get last recorded point (for cursor display) */
  getLastPoint(): InkPoint | null;
}

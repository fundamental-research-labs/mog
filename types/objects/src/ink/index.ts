/**
 * Ink Module Barrel Export
 *
 * Central export for all ink/drawing engine types and utilities.
 *
 * @example
 * import {
 *   InkStroke,
 *   StrokeId,
 *   generateStrokeId,
 *   computeStrokeBounds
 * } from '@mog-sdk/contracts/ink';
 */

// =============================================================================
// Core Ink Types
// =============================================================================

export type {
  ArrowShapeParams,
  CreateDrawingOptions,
  // Drawing object types
  DrawingObject,
  EllipseShapeParams,
  // Manager interface
  IDrawingObjectManager,
  // Ink accessor for rendering
  InkAccessorForRendering,
  // Core ink types
  InkPoint,
  InkStroke,
  InkTool,
  // Tool types
  InkToolSettings,
  InkToolState,

  // Shape parameter types
  LineShapeParams,
  RecognitionResult,
  // Recognition types
  RecognizedShape,
  RecognizedShapeType,
  RecognizedText,
  RectangleShapeParams,
  SelectionMode,
  // Serialization types
  SerializedPoint,
  SerializedStroke,
  ShapeParams,
  StarShapeParams,
  // Branded types
  StrokeId,
  TextAlternative,
  TriangleShapeParams,
} from './types';

// =============================================================================
// Spatial Index Types
// =============================================================================

export type {
  // Spatial index interface
  ISpatialIndex,
  // Bounding box
  InkBoundingBox,
} from './spatial-index';

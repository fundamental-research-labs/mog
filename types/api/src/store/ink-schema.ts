/**
 * Ink Schema - Type Definitions Only
 *
 * Runtime schema objects, defaults, tool constants, and utility functions have been moved to:
 * @see @mog-sdk/kernel/defaults/ink (schema objects & utilities)
 * @see kernel/src/domain/drawing/ink/ink-tool-defaults.ts (tool constants & functions)
 *
 * This file retains only the type exports for the contracts layer.
 */

/**
 * Type for shape recognition thresholds.
 * The actual SHAPE_RECOGNITION_THRESHOLDS constant lives in kernel.
 */
export interface ShapeRecognitionThresholds {
  readonly line: number;
  readonly rectangleAngle: number;
  readonly rectangleEdge: number;
  readonly ellipse: number;
  readonly triangleAngle: number;
  readonly arrowHead: number;
  readonly star: number;
  readonly minStrokeLength: number;
  readonly minConfidence: number;
  readonly multiStrokeWindow: number;
}

/**
 * Ink Recognition Bridge Interface
 *
 * Bridge interface for converting ink strokes into geometric shapes or text.
 * Provides shape recognition (local algorithms) and text recognition (browser API).
 *
 * Bridge Pattern:
 * - Interface defined here in contracts/
 * - Implementation in engine/src/bridges/
 * - Accessed via DocumentContext for dependency injection
 *
 * @see contracts/src/ink/types.ts for InkStroke, RecognizedShape, RecognizedText
 */

import type { InkStroke, RecognizedShapeType, ShapeParams } from '@mog/types-objects/ink/types';

// =============================================================================
// Recognition Result Types
// =============================================================================

/**
 * Result of shape recognition.
 *
 * Contains the recognized shape type, confidence score, bounding box,
 * and shape-specific parameters.
 */
export interface ShapeRecognitionResult {
  /** Type of recognized shape */
  type: RecognizedShapeType;
  /** Confidence score [0, 1] */
  confidence: number;
  /** Bounding box of the recognized shape */
  bounds: { x: number; y: number; width: number; height: number };
  /** Shape-specific parameters */
  params: ShapeParams;
}

/**
 * Result of text recognition.
 *
 * Contains the recognized text string, confidence score, and optional bounds.
 */
export interface TextRecognitionResult {
  /** Recognized text string */
  text: string;
  /** Confidence score [0, 1] */
  confidence: number;
  /** Bounding box of the text (null if not available) */
  bounds: { x: number; y: number; width: number; height: number } | null;
}

// =============================================================================
// Recognition Thresholds
// =============================================================================

/**
 * Configurable confidence thresholds per shape type.
 *
 * Users can tune these based on their drawing precision:
 * - Lower values = more permissive (may get false positives)
 * - Higher values = stricter (may miss intended shapes)
 */
export interface RecognitionThresholds {
  /** Threshold for line recognition (default: 0.70) */
  line: number;
  /** Threshold for rectangle recognition (default: 0.65) */
  rectangle: number;
  /** Threshold for ellipse/circle recognition (default: 0.70) */
  ellipse: number;
  /** Threshold for triangle recognition (default: 0.60) */
  triangle: number;
  /** Threshold for arrow recognition (default: 0.60) */
  arrow: number;
  /** Threshold for star recognition (default: 0.65) */
  star: number;
  /** Threshold for text recognition (default: 0.50) */
  text: number;
}

/**
 * Default thresholds - balanced for most users.
 */
export const DEFAULT_RECOGNITION_THRESHOLDS: RecognitionThresholds = {
  line: 0.7,
  rectangle: 0.65,
  ellipse: 0.7,
  triangle: 0.6,
  arrow: 0.6,
  star: 0.65,
  text: 0.5,
};

// =============================================================================
// Bridge Interface
// =============================================================================

/**
 * Bridge interface for ink recognition.
 *
 * Provides methods for recognizing strokes as shapes or text,
 * with configurable confidence thresholds.
 */
export interface IInkRecognitionBridge {
  /**
   * Recognize strokes as a geometric shape.
   *
   * Returns the highest-confidence match above its type's threshold.
   * Returns null if no shape is recognized with sufficient confidence.
   *
   * @param strokes - Array of strokes to analyze
   * @returns Recognition result or null
   */
  recognizeShape(strokes: InkStroke[]): Promise<ShapeRecognitionResult | null>;

  /**
   * Recognize strokes as handwritten text.
   *
   * Uses browser Handwriting Recognition API when available.
   * Returns null if recognition fails or API is unavailable.
   *
   * @param strokes - Array of strokes to analyze
   * @returns Recognition result or null
   */
  recognizeText(strokes: InkStroke[]): Promise<TextRecognitionResult | null>;

  /**
   * Check if shape recognition is available.
   *
   * Shape recognition uses local algorithms, so it's always available.
   */
  isShapeRecognitionAvailable(): boolean;

  /**
   * Check if text recognition is available.
   *
   * Text recognition requires the browser Handwriting Recognition API.
   */
  isTextRecognitionAvailable(): boolean;

  /**
   * Update recognition thresholds.
   *
   * Allows runtime tuning without recreating the bridge.
   *
   * @param thresholds - Partial threshold updates
   */
  setThresholds(thresholds: Partial<RecognitionThresholds>): void;

  /**
   * Get current thresholds.
   *
   * @returns Current threshold configuration
   */
  getThresholds(): RecognitionThresholds;

  /**
   * Cleanup resources.
   *
   * Called when the bridge is no longer needed.
   */
  destroy(): void;
}

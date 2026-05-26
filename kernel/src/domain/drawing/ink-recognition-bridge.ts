/// <reference path="../../global.ts" />
/**
 * Ink Recognition Bridge Implementation
 *
 * Implements shape recognition using local geometric analysis algorithms
 * and text recognition using the browser Handwriting Recognition API.
 *
 * Shape Recognition Algorithms:
 * - Line: Straightness analysis (max deviation from ideal line)
 * - Ellipse: Radius variance and closedness analysis
 * - Rectangle: Corner detection and right-angle verification
 * - Triangle: 3-corner detection with closedness
 * - Arrow: Line with curvature at one end
 * - Star: Multiple strokes radiating from center
 *
 * @see contracts/src/bridges/ink-recognition-bridge.ts for interface
 */

import type {
  IInkRecognitionBridge,
  RecognitionThresholds,
  ShapeRecognitionResult,
  TextRecognitionResult,
} from '@mog-sdk/contracts/bridges';
import type {
  ArrowShapeParams,
  EllipseShapeParams,
  InkPoint,
  InkStroke,
  LineShapeParams,
  RectangleShapeParams,
  StarShapeParams,
  TriangleShapeParams,
} from '@mog-sdk/contracts/ink';

import { DEFAULT_RECOGNITION_THRESHOLDS } from '@mog-sdk/contracts/bridges';

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an ink recognition bridge with configurable thresholds.
 *
 * @param initialThresholds - Optional initial threshold overrides
 * @returns IInkRecognitionBridge instance
 */
export function createInkRecognitionBridge(
  initialThresholds?: Partial<RecognitionThresholds>,
): IInkRecognitionBridge {
  // Mutable thresholds - can be updated at runtime
  let thresholds: RecognitionThresholds = {
    ...DEFAULT_RECOGNITION_THRESHOLDS,
    ...initialThresholds,
  };

  return {
    async recognizeShape(strokes: InkStroke[]): Promise<ShapeRecognitionResult | null> {
      if (strokes.length === 0) return null;

      // Analyze strokes for geometric patterns
      const candidates = analyzeForShapes(strokes, thresholds);

      if (candidates.length === 0) return null;

      // Return highest confidence match that passes its type's threshold
      const sorted = candidates.sort((a, b) => b.confidence - a.confidence);

      for (const candidate of sorted) {
        const threshold = thresholds[candidate.type as keyof RecognitionThresholds];
        if (typeof threshold === 'number' && candidate.confidence >= threshold) {
          return candidate;
        }
      }

      return null;
    },

    async recognizeText(strokes: InkStroke[]): Promise<TextRecognitionResult | null> {
      if (strokes.length === 0) return null;

      // Try browser's Handwriting Recognition API if available
      if ('Handwriting' in window) {
        try {
          const result = await recognizeWithBrowserAPI(strokes);
          if (result && result.confidence >= thresholds.text) {
            return result;
          }
        } catch {
          // Fall through to null
        }
      }

      // Text recognition not available without browser API
      return null;
    },

    isShapeRecognitionAvailable(): boolean {
      return true; // Always available (uses local algorithms)
    },

    isTextRecognitionAvailable(): boolean {
      return typeof window !== 'undefined' && 'Handwriting' in window;
    },

    setThresholds(newThresholds: Partial<RecognitionThresholds>): void {
      thresholds = { ...thresholds, ...newThresholds };
    },

    getThresholds(): RecognitionThresholds {
      return { ...thresholds };
    },

    destroy(): void {
      // No cleanup needed
    },
  };
}

// =============================================================================
// Shape Analysis
// =============================================================================

/**
 * Analyze strokes for geometric shape patterns.
 *
 * @param strokes - Array of strokes to analyze
 * @param thresholds - Confidence thresholds
 * @returns Array of shape candidates
 */
function analyzeForShapes(
  strokes: InkStroke[],
  thresholds: RecognitionThresholds,
): ShapeRecognitionResult[] {
  const results: ShapeRecognitionResult[] = [];
  const bounds = computeAllStrokesBounds(strokes);
  if (!bounds) return results;

  // Single stroke analysis
  if (strokes.length === 1) {
    const stroke = strokes[0];
    const points = stroke.points;

    // Check for line (only if above minimum threshold)
    if (thresholds.line > 0) {
      const lineResult = analyzeAsLine(points, bounds);
      if (lineResult) results.push(lineResult);
    }

    // Check for circle/ellipse
    if (thresholds.ellipse > 0) {
      const ellipseResult = analyzeAsEllipse(points, bounds);
      if (ellipseResult) results.push(ellipseResult);
    }

    // Check for rectangle
    if (thresholds.rectangle > 0) {
      const rectangleResult = analyzeAsRectangle(points, bounds);
      if (rectangleResult) results.push(rectangleResult);
    }

    // Check for triangle
    if (thresholds.triangle > 0) {
      const triangleResult = analyzeAsTriangle(points, bounds);
      if (triangleResult) results.push(triangleResult);
    }

    // Check for arrow
    if (thresholds.arrow > 0) {
      const arrowResult = analyzeAsArrow(points, bounds);
      if (arrowResult) results.push(arrowResult);
    }
  }

  // Multi-stroke analysis (for shapes drawn with multiple strokes)
  if (strokes.length > 1) {
    // Combine all points and analyze
    const allPoints = strokes.flatMap((s) => s.points);

    if (thresholds.rectangle > 0) {
      const rectangleResult = analyzeAsRectangle(allPoints, bounds);
      if (rectangleResult) results.push(rectangleResult);
    }

    // Star requires multiple strokes typically
    if (thresholds.star > 0 && strokes.length >= 2) {
      const starResult = analyzeAsStar(strokes, bounds);
      if (starResult) results.push(starResult);
    }
  }

  return results;
}

// =============================================================================
// Line Recognition
// =============================================================================

/**
 * Analyze points as a line shape.
 *
 * Algorithm:
 * 1. Compute straight line from first to last point
 * 2. Measure max deviation of all points from that line
 * 3. Score based on straightness ratio
 */
function analyzeAsLine(
  points: InkPoint[],
  bounds: { x: number; y: number; width: number; height: number },
): ShapeRecognitionResult | null {
  if (points.length < 2) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const length = Math.hypot(end.x - start.x, end.y - start.y);

  // Minimum length check
  if (length < 20) return null;

  // Compute max deviation from straight line
  let maxDeviation = 0;
  for (const point of points) {
    const deviation = pointToLineDistance(point, start, end);
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  // Score based on straightness
  const straightness = 1 - maxDeviation / length;
  const confidence = Math.max(0, Math.min(1, straightness * 1.2 - 0.1));

  // Return even low confidence - threshold check happens in main function
  if (confidence < 0.3) return null;

  const params: LineShapeParams = {
    type: 'line',
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    rotation: Math.atan2(end.y - start.y, end.x - start.x),
  };

  return {
    type: 'line',
    confidence,
    bounds,
    params,
  };
}

// =============================================================================
// Ellipse Recognition
// =============================================================================

/**
 * Analyze points as an ellipse/circle shape.
 *
 * Algorithm:
 * 1. Compute centroid of all points
 * 2. Compute average radius from centroid
 * 3. Measure variance in radius (lower = more circular)
 * 4. Check closedness (distance from first to last point)
 */
function analyzeAsEllipse(
  points: InkPoint[],
  bounds: { x: number; y: number; width: number; height: number },
): ShapeRecognitionResult | null {
  if (points.length < 10) return null;

  // Compute centroid
  const center = computeCentroid(points);

  // Compute average radius
  const radii = points.map((p) => Math.hypot(p.x - center.x, p.y - center.y));
  const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;

  if (avgRadius < 10) return null;

  // Compute variance in radius (lower = more circular)
  const variance = radii.reduce((sum, r) => sum + (r - avgRadius) ** 2, 0) / radii.length;
  const normalizedVariance = variance / avgRadius ** 2;

  // Check if closed (end near start)
  const gap = Math.hypot(
    points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y,
  );
  const closedness = 1 - gap / (avgRadius * 2);

  // Combined confidence
  const confidence = Math.max(
    0,
    Math.min(1, (1 - normalizedVariance * 5) * Math.max(0.5, closedness)),
  );

  if (confidence < 0.3) return null;

  // Compute ellipse parameters
  const { radiusX, radiusY, rotation } = fitEllipse(points, center);

  const params: EllipseShapeParams = {
    type: 'ellipse',
    cx: center.x,
    cy: center.y,
    rx: radiusX,
    ry: radiusY,
    rotation,
  };

  return {
    type: 'ellipse',
    confidence,
    bounds,
    params,
  };
}

// =============================================================================
// Rectangle Recognition
// =============================================================================

/**
 * Analyze points as a rectangle shape.
 *
 * Algorithm:
 * 1. Find corners (points with high curvature)
 * 2. Check for approximately 4 corners
 * 3. Verify angles are approximately 90 degrees
 * 4. Check closedness
 */
function analyzeAsRectangle(
  points: InkPoint[],
  bounds: { x: number; y: number; width: number; height: number },
): ShapeRecognitionResult | null {
  if (points.length < 4) return null;

  // Find corners (points with high curvature)
  const corners = findCorners(points);

  // Rectangle needs ~4 corners
  if (corners.length < 3 || corners.length > 6) return null;

  // Check if closed
  const gap = Math.hypot(
    points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y,
  );
  const perimeter = computePathLength(points);
  const closedness = 1 - gap / (perimeter * 0.1);

  if (closedness < 0.5) return null;

  // Check angles at corners (should be ~90 degrees)
  let rightAngleScore = 0;
  for (let i = 0; i < corners.length; i++) {
    const prev = corners[(i - 1 + corners.length) % corners.length];
    const curr = corners[i];
    const next = corners[(i + 1) % corners.length];

    const angle = computeAngle(prev, curr, next);
    const deviation = Math.abs(angle - Math.PI / 2);
    rightAngleScore += 1 - deviation / (Math.PI / 4);
  }
  rightAngleScore /= corners.length;

  const confidence = Math.min(1, closedness * rightAngleScore);

  if (confidence < 0.3) return null;

  const params: RectangleShapeParams = {
    type: 'rectangle',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: 0, // Could compute rotation from corners
  };

  return {
    type: 'rectangle',
    confidence,
    bounds,
    params,
  };
}

// =============================================================================
// Triangle Recognition
// =============================================================================

/**
 * Analyze points as a triangle shape.
 *
 * Algorithm:
 * 1. Find corners (points with high curvature)
 * 2. Triangle needs exactly 3 corners
 * 3. Check closedness
 */
function analyzeAsTriangle(
  points: InkPoint[],
  bounds: { x: number; y: number; width: number; height: number },
): ShapeRecognitionResult | null {
  if (points.length < 3) return null;

  // Find corners
  const corners = findCorners(points);

  // Triangle needs exactly 3 corners
  if (corners.length !== 3) return null;

  // Check if closed
  const gap = Math.hypot(
    points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y,
  );
  const perimeter = computePathLength(points);
  const closedness = 1 - gap / (perimeter * 0.15);

  if (closedness < 0.4) return null;

  const confidence = closedness * 0.9;

  if (confidence < 0.3) return null;

  const params: TriangleShapeParams = {
    type: 'triangle',
    x1: corners[0].x,
    y1: corners[0].y,
    x2: corners[1].x,
    y2: corners[1].y,
    x3: corners[2].x,
    y3: corners[2].y,
    rotation: 0,
  };

  return {
    type: 'triangle',
    confidence,
    bounds,
    params,
  };
}

// =============================================================================
// Arrow Recognition
// =============================================================================

/**
 * Analyze points as an arrow shape.
 *
 * Algorithm:
 * 1. Check if mostly a straight line
 * 2. Find point of maximum curvature (potential arrowhead)
 * 3. Arrowhead should be near one end
 */
function analyzeAsArrow(
  points: InkPoint[],
  bounds: { x: number; y: number; width: number; height: number },
): ShapeRecognitionResult | null {
  if (points.length < 5) return null;

  // Check if mostly a line
  const start = points[0];
  const end = points[points.length - 1];
  const mainLength = Math.hypot(end.x - start.x, end.y - start.y);

  if (mainLength < 30) return null;

  // Find point of maximum curvature (potential arrowhead)
  let maxCurvatureIdx = -1;
  let maxCurvature = 0;

  for (let i = 2; i < points.length - 2; i++) {
    const curvature = computeCurvature(points[i - 2], points[i], points[i + 2]);
    if (curvature > maxCurvature) {
      maxCurvature = curvature;
      maxCurvatureIdx = i;
    }
  }

  // Arrowhead should be near an end
  const distToStart = maxCurvatureIdx;
  const distToEnd = points.length - 1 - maxCurvatureIdx;
  const nearEnd = Math.min(distToStart, distToEnd) < points.length * 0.25;

  if (!nearEnd || maxCurvature < 0.3) return null;

  const confidence = Math.min(1, maxCurvature * 0.8);

  if (confidence < 0.3) return null;

  const params: ArrowShapeParams = {
    type: 'arrow',
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    headSize: 10,
    rotation: Math.atan2(end.y - start.y, end.x - start.x),
  };

  return {
    type: 'arrow',
    confidence,
    bounds,
    params,
  };
}

// =============================================================================
// Star Recognition
// =============================================================================

/**
 * Analyze multiple strokes as a star shape.
 *
 * Algorithm:
 * 1. Star requires multiple strokes (rays)
 * 2. Check if all strokes roughly intersect at a common point
 */
function analyzeAsStar(
  strokes: InkStroke[],
  bounds: { x: number; y: number; width: number; height: number },
): ShapeRecognitionResult | null {
  if (strokes.length < 3) return null;

  // Check if all strokes roughly intersect at a common point
  const allPoints = strokes.flatMap((s) => s.points);
  const center = computeCentroid(allPoints);

  // Each stroke should pass near the center
  let strokesThroughCenter = 0;
  for (const stroke of strokes) {
    const closestDist = Math.min(
      ...stroke.points.map((p) => Math.hypot(p.x - center.x, p.y - center.y)),
    );
    if (closestDist < 20) {
      strokesThroughCenter++;
    }
  }

  const confidence = strokesThroughCenter / strokes.length;

  if (confidence < 0.3) return null;

  const params: StarShapeParams = {
    type: 'star',
    cx: center.x,
    cy: center.y,
    outerRadius: Math.max(bounds.width, bounds.height) / 2,
    innerRadius: Math.max(bounds.width, bounds.height) / 4,
    points: strokes.length,
    rotation: 0,
  };

  return {
    type: 'star',
    confidence,
    bounds,
    params,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute distance from a point to a line segment.
 */
function pointToLineDistance(point: InkPoint, lineStart: InkPoint, lineEnd: InkPoint): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx: number, yy: number;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  return Math.hypot(point.x - xx, point.y - yy);
}

/**
 * Compute centroid of points.
 */
function computeCentroid(points: InkPoint[]): { x: number; y: number } {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Fit an ellipse to points given a center.
 */
function fitEllipse(
  points: InkPoint[],
  center: { x: number; y: number },
): { radiusX: number; radiusY: number; rotation: number } {
  // Simplified ellipse fitting
  let sumX = 0,
    sumY = 0;
  for (const p of points) {
    sumX += Math.abs(p.x - center.x);
    sumY += Math.abs(p.y - center.y);
  }
  return {
    radiusX: sumX / points.length,
    radiusY: sumY / points.length,
    rotation: 0,
  };
}

/**
 * Find corners (points with high curvature).
 */
function findCorners(points: InkPoint[]): InkPoint[] {
  const corners: InkPoint[] = [];
  const threshold = 0.3; // Curvature threshold

  for (let i = 2; i < points.length - 2; i++) {
    const curvature = computeCurvature(points[i - 2], points[i], points[i + 2]);
    if (curvature > threshold) {
      // Avoid adding corners too close together
      if (corners.length === 0 || distanceBetween(corners[corners.length - 1], points[i]) > 10) {
        corners.push(points[i]);
      }
    }
  }

  return corners;
}

/**
 * Compute curvature at a point given previous and next points.
 */
function computeCurvature(p1: InkPoint, p2: InkPoint, p3: InkPoint): number {
  const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

  const dot = v1.x * v2.x + v1.y * v2.y;
  const cross = v1.x * v2.y - v1.y * v2.x;

  return Math.abs(Math.atan2(cross, dot)) / Math.PI;
}

/**
 * Compute angle at a corner point.
 */
function computeAngle(p1: InkPoint, p2: InkPoint, p3: InkPoint): number {
  const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);

  if (mag1 === 0 || mag2 === 0) return 0;

  return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
}

/**
 * Compute path length of a stroke.
 */
function computePathLength(points: InkPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

/**
 * Compute distance between two points.
 */
function distanceBetween(p1: InkPoint, p2: InkPoint): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Compute combined bounding box of all strokes.
 */
function computeAllStrokesBounds(
  strokes: InkStroke[],
): { x: number; y: number; width: number; height: number } | null {
  if (strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// =============================================================================
// Browser API Text Recognition
// =============================================================================

/**
 * Recognize text using browser Handwriting Recognition API.
 */
async function recognizeWithBrowserAPI(
  strokes: InkStroke[],
): Promise<TextRecognitionResult | null> {
  if (!window.Handwriting) {
    return null;
  }
  const recognizer = await window.Handwriting.createRecognizer({
    languages: ['en'],
  });

  // Convert strokes to handwriting input format
  const drawing = {
    strokes: strokes.map((stroke) => ({
      points: stroke.points.map((p) => ({
        x: p.x,
        y: p.y,
        t: p.timestamp,
      })),
    })),
  };

  const result = await recognizer.recognize(drawing);

  if (result.candidates && result.candidates.length > 0) {
    const bounds = computeAllStrokesBounds(strokes);
    return {
      text: result.candidates[0].text,
      confidence: result.candidates[0].score ?? 0.5,
      bounds,
    };
  }

  return null;
}

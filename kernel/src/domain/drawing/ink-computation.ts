/**
 * Ink computation — pure functions for ink stroke operations.
 *
 * Extracted from FloatingObjectBridge. All functions are stateless and
 * delegate to @mog/ink-engine and @mog/geometry.
 */

import { PathOps } from '@mog/geometry';
import {
  createSpatialIndex,
  createStroke,
  eraseFromStroke,
  pointErase,
  pointNearStroke,
  simplifyStroke,
  smoothStroke,
  strokeBoundingBox,
  strokesIntersect,
  strokeToDrawingObject,
  strokeToPath,
  type Stroke,
  type StrokePoint,
} from '@mog/ink-engine';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { StrokeId } from '@mog-sdk/contracts/ink';

const { pathToSvgString } = PathOps;

// Re-export types for consumers
export type { Stroke, StrokePoint };

/**
 * Create a new stroke using @mog/ink-engine.
 */
export function createInkStroke(
  points: StrokePoint[],
  options: { color: string; width: number; opacity?: number; id: StrokeId },
): Stroke {
  return createStroke(points, options);
}

/**
 * Smooth a stroke's points using @mog/ink-engine.
 */
export function smoothInkStroke(points: StrokePoint[], factor?: number): StrokePoint[] {
  return smoothStroke(points, factor);
}

/**
 * Simplify a stroke's points (reduce point count) using @mog/ink-engine.
 */
export function simplifyInkStroke(points: StrokePoint[], tolerance?: number): StrokePoint[] {
  return simplifyStroke(points, tolerance);
}

/**
 * Get bounding box for stroke points using @mog/ink-engine.
 */
export function getStrokeBounds(points: StrokePoint[], width: number) {
  return strokeBoundingBox(points, width);
}

/**
 * Convert stroke to an SVG path string.
 * Uses strokeToPath from ink-engine, then pathToSvgString from geometry.
 */
export function strokeToSvgPath(stroke: Stroke): string {
  const path = strokeToPath(stroke);
  return pathToSvgString(path);
}

/**
 * Create a spatial index for efficient stroke queries using @mog/ink-engine.
 */
export function createInkSpatialIndex() {
  return createSpatialIndex();
}

/**
 * Check if two strokes intersect using @mog/ink-engine.
 */
export function checkStrokesIntersect(strokeA: Stroke, strokeB: Stroke): boolean {
  return strokesIntersect(strokeA, strokeB);
}

/**
 * Check if a point is near a stroke using @mog/ink-engine.
 */
export function isPointNearStroke(
  stroke: Stroke,
  x: number,
  y: number,
  threshold?: number,
): boolean {
  return pointNearStroke({ x, y }, stroke, threshold ?? 5);
}

/**
 * Erase part of a stroke using @mog/ink-engine.
 */
export function eraseFromInkStroke(
  stroke: Stroke,
  eraserX: number,
  eraserY: number,
  eraserRadius: number,
): Stroke[] {
  const eraserRect = {
    x: eraserX - eraserRadius,
    y: eraserY - eraserRadius,
    width: eraserRadius * 2,
    height: eraserRadius * 2,
  };
  return eraseFromStroke(stroke, eraserRect);
}

/**
 * Point erase across multiple strokes using @mog/ink-engine.
 */
export function pointEraseStrokes(
  strokes: Stroke[],
  x: number,
  y: number,
  radius: number,
): Stroke[] {
  const center = { x, y };
  const results: Stroke[] = [];
  for (const stroke of strokes) {
    results.push(...pointErase(stroke, center, radius));
  }
  return results;
}

/**
 * Convert an ink stroke to a DrawingObject using @mog/ink-engine.
 *
 * The resulting DrawingObject contains the stroke's variable-width outline
 * as geometry with a solid fill matching the stroke's color.
 */
export function computeInkDrawingObject(stroke: Stroke): DrawingObject {
  return strokeToDrawingObject(stroke);
}

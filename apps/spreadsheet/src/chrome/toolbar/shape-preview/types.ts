/**
 * Shape Preview Types
 *
 * Type definitions for shape preview thumbnail components.
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

/**
 * Bounding box for shape rendering.
 */
export interface ShapeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Props for individual shape drawing functions.
 */
export interface ShapeDrawProps {
  ctx: CanvasRenderingContext2D;
  bounds: ShapeBounds;
}

/**
 * Shape drawing function signature.
 * Returns true if shape was drawn, false if not handled.
 */
export type ShapeDrawFn = (ctx: CanvasRenderingContext2D, bounds: ShapeBounds) => boolean;

/**
 * Props for the main ShapePreviewThumbnail component.
 */
export interface ShapePreviewThumbnailProps {
  shapeType: ShapeType;
  width?: number;
  height?: number;
  fillColor?: string;
  strokeColor?: string;
}

/**
 * Shape category for organizing shape types.
 */
export type ShapeCategory =
  | 'basic'
  | 'stars'
  | 'arrows'
  | 'arrowCallouts'
  | 'flowchart'
  | 'callouts'
  | 'lines'
  | 'symbols'
  | 'ribbons';

/**
 * Constants for shape preview rendering.
 */
export const SHAPE_PREVIEW_DEFAULTS = {
  WIDTH: 24,
  HEIGHT: 24,
  FILL_COLOR: '#e0e7ff', // Light indigo fill
  STROKE_COLOR: '#6366f1', // Indigo stroke
} as const;

/**
 * Shape types that are line-based (no fill, stroke only).
 * These match the 'lines' category from shape-rendering-info.
 */
export const LINE_SHAPE_TYPES = new Set<ShapeType>([
  'line',
  'lineArrow',
  'lineDoubleArrow',
  'curve',
  'arc',
  'connector',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
]);

/**
 * Check if a shape type is line-based (no fill).
 */
export function isLineShape(shapeType: ShapeType): boolean {
  return LINE_SHAPE_TYPES.has(shapeType);
}

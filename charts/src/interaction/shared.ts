/**
 * Shared Interaction Utilities
 *
 * Common types and helper functions used across interaction modules
 * (pick, brush, tooltip). Extracted here to avoid duplication.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A row of data associated with a mark.
 * Used by brush and tooltip modules.
 */
export type DataRow = Record<string, unknown>;

// =============================================================================
// Geometry Helpers
// =============================================================================

/**
 * Calculate the radius for a symbol based on its area.
 * Symbol size is specified as an area (in square pixels),
 * so the radius is sqrt(area / PI).
 *
 * Used by pick (hit testing) and brush (bounding box) modules.
 */
export function symbolRadius(size: number): number {
  return Math.sqrt(size / Math.PI);
}

/**
 * Zoom Utility Functions
 *
 * Pure functions for zoom calculations. No side effects.
 * Store holds data, these functions compute values.
 *
 * @module state/utils/zoom-utils
 */

import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from '@mog-sdk/contracts/rendering';

/**
 * Clamp a zoom level to valid range [MIN_ZOOM, MAX_ZOOM]
 */
export function clampZoom(level: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
}

/**
 * Calculate zoom level after zooming in by one step
 */
export function zoomIn(currentLevel: number): number {
  return clampZoom(currentLevel + ZOOM_STEP);
}

/**
 * Calculate zoom level after zooming out by one step
 */
export function zoomOut(currentLevel: number): number {
  return clampZoom(currentLevel - ZOOM_STEP);
}

/**
 * Get zoom level for a sheet, defaulting to 100% if not set
 */
export function getZoomLevel(zoomLevels: Record<string, number>, sheetId: string): number {
  return zoomLevels[sheetId] ?? DEFAULT_ZOOM;
}

/**
 * Convert the app's decimal zoom level to the percent value stored in sheet settings.
 */
export function zoomLevelToScale(level: number): number {
  return Math.round(clampZoom(level) * 100);
}

/**
 * Convert a persisted sheet zoom percent to the app's decimal zoom level.
 */
export function zoomScaleToLevel(scale: number | null | undefined): number | null {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  return clampZoom(scale / 100);
}

/**
 * Format zoom level as percentage string (e.g., "100%")
 */
export function formatZoomPercent(level: number): string {
  return `${Math.round(level * 100)}%`;
}

/**
 * Parse percentage string to zoom level (e.g., "100%" -> 1.0)
 * Returns null if invalid
 */
export function parseZoomPercent(percent: string): number | null {
  const match = percent.match(/^(\d+)%?$/);
  if (!match) return null;
  const value = parseInt(match[1], 10) / 100;
  if (isNaN(value) || value < MIN_ZOOM || value > MAX_ZOOM) return null;
  return value;
}

/**
 * Find the nearest preset zoom level
 */
export function nearestPreset(level: number, presets: readonly number[]): number {
  return presets.reduce((nearest, preset) =>
    Math.abs(preset - level) < Math.abs(nearest - level) ? preset : nearest,
  );
}

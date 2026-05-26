/**
 * Clipboard Operations (Universal)
 *
 * App-agnostic clipboard utilities for canvas objects.
 * Contains only generic parts: offset calculation, validation, duplication
 * helpers that work with CanvasObjectPosition.
 *
 * Cell-anchor offset logic (calculateDuplicatePosition with CellAnchor xOffset/yOffset)
 * stays in the spreadsheet/ adapter layer.
 *
 * @module core/clipboard
 */

import type { CanvasObjectPosition } from '@mog-sdk/contracts/objects/canvas-object';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default offset for duplicated objects (pixels) */
const DEFAULT_DUPLICATE_OFFSET = 20;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Offset for positioning duplicated objects.
 */
export interface DuplicateOffset {
  /** Horizontal offset in pixels (positive = right) */
  dx: number;
  /** Vertical offset in pixels (positive = down) */
  dy: number;
}

/**
 * Generic clipboard data for any canvas object.
 * App-specific clipboard data types extend this.
 */
export interface GenericClipboardData {
  /** Original object type */
  type: string;
  /** Document ID where the object originated */
  sourceDocumentId: string;
  /** Resolved pixel position for the new object (with offset applied) */
  position: CanvasObjectPosition;
  /** App-specific payload (opaque to core) */
  payload: unknown;
}

// =============================================================================
// OFFSET CALCULATION
// =============================================================================

/**
 * Calculate the position for a duplicated object using pixel offsets.
 *
 * Applies the given offset to the position's x/y values.
 * This creates a new position that is visually offset from the original.
 *
 * @param position - The resolved pixel position of the source object
 * @param offset - The offset to apply
 * @returns New CanvasObjectPosition with offset applied
 */
export function calculateDuplicateOffset(
  position: CanvasObjectPosition,
  offset?: Partial<DuplicateOffset>,
): CanvasObjectPosition {
  const dx = offset?.dx ?? DEFAULT_DUPLICATE_OFFSET;
  const dy = offset?.dy ?? DEFAULT_DUPLICATE_OFFSET;

  return {
    ...position,
    x: position.x + dx,
    y: position.y + dy,
  };
}

/**
 * Calculate an offset for multiple duplicates to avoid stacking.
 *
 * When duplicating multiple objects at once, this calculates progressive
 * offsets so each duplicate is visible and not directly overlapping others.
 *
 * @param index - The index of the duplicate (0-based)
 * @param baseOffset - The base offset for the first duplicate
 * @returns Offset for this specific duplicate
 */
export function calculateBatchDuplicateOffset(
  index: number,
  baseOffset?: Partial<DuplicateOffset>,
): DuplicateOffset {
  const baseDx = baseOffset?.dx ?? DEFAULT_DUPLICATE_OFFSET;
  const baseDy = baseOffset?.dy ?? DEFAULT_DUPLICATE_OFFSET;

  // Each subsequent duplicate is offset further
  const multiplier = index + 1;

  return {
    dx: baseDx * multiplier,
    dy: baseDy * multiplier,
  };
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that generic clipboard data has the required structure.
 *
 * Checks top-level fields only. App-specific validation should be done
 * by the app layer.
 *
 * @param data - Data to validate
 * @returns true if the data has the required generic clipboard structure
 */
export function isValidClipboardData(data: unknown): data is GenericClipboardData {
  if (!data || typeof data !== 'object') return false;

  const d = data as Partial<GenericClipboardData>;

  // Check required top-level fields
  if (typeof d.type !== 'string') return false;
  if (typeof d.sourceDocumentId !== 'string') return false;
  if (!d.position || typeof d.position !== 'object') return false;

  // Check position has required numeric fields
  const pos = d.position;
  if (typeof pos.x !== 'number') return false;
  if (typeof pos.y !== 'number') return false;
  if (typeof pos.width !== 'number') return false;
  if (typeof pos.height !== 'number') return false;

  return true;
}

// =============================================================================
// DUPLICATION HELPERS
// =============================================================================

/**
 * Prepare a generic clipboard entry from a resolved object.
 *
 * This is the universal part of clipboard preparation: it takes an already-resolved
 * pixel position and applies the duplicate offset. App-specific data goes in payload.
 *
 * @param type - Object type
 * @param sourceDocumentId - Document the object came from
 * @param position - Resolved pixel position of the source object
 * @param payload - App-specific data (opaque to core)
 * @param offset - Optional offset for the position
 * @returns GenericClipboardData ready for clipboard
 */
export function prepareGenericClipboardData(
  type: string,
  sourceDocumentId: string,
  position: CanvasObjectPosition,
  payload: unknown,
  offset?: Partial<DuplicateOffset>,
): GenericClipboardData {
  return {
    type,
    sourceDocumentId,
    position: calculateDuplicateOffset(position, offset),
    payload,
  };
}

/**
 * Prepare multiple generic clipboard entries with progressive offsets.
 *
 * @param entries - Array of { type, sourceDocumentId, position, payload }
 * @param baseOffset - Base offset for the first object
 * @returns Array of GenericClipboardData
 */
export function prepareGenericClipboardBatch(
  entries: Array<{
    type: string;
    sourceDocumentId: string;
    position: CanvasObjectPosition;
    payload: unknown;
  }>,
  baseOffset?: Partial<DuplicateOffset>,
): GenericClipboardData[] {
  return entries.map((entry, index) => {
    const offset = calculateBatchDuplicateOffset(index, baseOffset);
    return prepareGenericClipboardData(
      entry.type,
      entry.sourceDocumentId,
      entry.position,
      entry.payload,
      offset,
    );
  });
}

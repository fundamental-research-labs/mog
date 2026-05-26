/**
 * Floating Object Manager Types
 *
 * Shared types for the floating object management system.
 *
 * Types:
 * - CanvasObjectContext: Universal context using IPositionResolver (no cell-grid deps)
 * - DocumentObjectMaps: Document-scoped floating object maps
 * - CreateDocumentObjectResult: Uses containerId instead of sheetId
 */

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { IPositionResolver } from '@mog-sdk/contracts/objects/canvas-object';

import type { ComputeBridge } from '../bridges/compute/compute-bridge';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Minimum distance from edge for resize handles to be hit (pixels).
 * Increased from 8 to 12 for better clickability on high-DPI displays.
 */
export const HANDLE_SIZE = 12;

/** Distance above object for rotation handle (pixels) */
export const ROTATION_HANDLE_OFFSET = 25;

/** Default offset for duplicated objects (pixels) */
export const DEFAULT_DUPLICATE_OFFSET = 20;

// =============================================================================
// UNIVERSAL TYPES
// =============================================================================

/**
 * Computed bounding box for an object in pixel coordinates.
 */
export interface ObjectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * Universal context for canvas object operations.
 * Uses IPositionResolver instead of CellPositionLookup.
 *
 * App-specific managers provide their own resolver implementation.
 */
export interface CanvasObjectContext<TAnchor = unknown> {
  /** ComputeBridge for Rust/Yrs storage access */
  computeBridge: ComputeBridge;
  /** Position resolver (app-agnostic) */
  resolver: IPositionResolver<TAnchor> | null;
}

/**
 * Result of a canvas object creation operation (universal).
 */
export interface CreateDocumentObjectResult<T extends FloatingObject> {
  object: T;
  containerId: string;
}

/**
 * Maps passed to sub-manager creation functions.
 * Sub-managers write newly created objects into this map as a local staging area
 * before persisting to ComputeBridge. The caller provides a fresh Map per call.
 */
export interface DocumentObjectMaps {
  /** Staging map for floating objects (containerId scope) */
  floatingObjects: Map<string, FloatingObject>;
}

/**
 * Picture Manager
 *
 * Standalone functions for picture-specific floating object operations.
 * Extracted from FloatingObjectManager to follow single responsibility principle.
 *
 * These functions handle:
 * - Creating picture objects
 * - Exporting pictures as files
 * - Duplicating picture objects
 *
 * All functions are designed to be called from FloatingObjectManager or
 * integrated directly into action handlers.
 */

import type {
  CreatePictureOptions,
  FloatingObject,
  ObjectPosition,
  PictureObject,
} from '@mog-sdk/contracts/floating-objects';
import type { IPositionResolver } from '@mog-sdk/contracts/objects/canvas-object';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

type ObjectPositionResolver = IPositionResolver<ObjectPosition>;

import { DocumentNotReadyError } from '../../errors/document';
import type { DocumentObjectMaps } from '../types';
import { DEFAULT_DUPLICATE_OFFSET } from '../types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Context required for picture operations.
 * Uses IPositionResolver instead of CellPositionLookup for app-agnostic anchoring.
 */
export interface PictureContext {
  /** ComputeBridge for Rust/Yrs storage access */
  computeBridge: {
    setFloatingObject(containerId: string, id: string, obj: unknown): Promise<unknown>;
  };
  /** Position resolver for anchor creation (app-agnostic) */
  resolver: ObjectPositionResolver | null;
}

/**
 * Parameters for creating a picture object.
 */
export interface CreatePictureParams {
  /** The context containing store refs and resolver */
  ctx: PictureContext;
  /** Container (sheet/slide/page) to create the picture in */
  containerId: string;
  /** Image source (data URL, blob URL, or external URL) */
  src: string;
  /** Initial position configuration */
  position: Partial<ObjectPosition>;
  /** Optional configuration */
  options?: CreatePictureOptions;
  /** Function to get or create floating object maps for a container */
  getOrCreateMaps: (containerId: string) => DocumentObjectMaps | null;
  /** Function to get the next z-index for a container */
  getNextZIndex: (containerId: string) => number;
  /** Function to generate a unique object ID */
  generateObjectId: () => string;
  /** Function to generate a unique object name */
  generateObjectName: (type: 'picture') => string;
}

/**
 * Parameters for exporting a picture as a file.
 */
export interface ExportPictureParams {
  /** The picture object to export */
  picture: PictureObject;
  /** Optional filename (defaults to picture name or "image.png") */
  filename?: string;
}

/**
 * Parameters for duplicating a picture.
 */
export interface DuplicatePictureParams {
  /** The picture object to duplicate */
  picture: PictureObject;
  /** Optional offset for the duplicate position */
  offset?: { dx: number; dy: number };
}

/**
 * Result of duplicating a picture.
 * Contains the new position for the duplicated picture.
 */
export interface DuplicatePictureResult {
  /** New position for the duplicated picture */
  newPosition: ObjectPosition;
  /** Options to pass to createPicture */
  options: CreatePictureOptions;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Normalize a partial position configuration to a full ObjectPosition
 * using the generic IPositionResolver.
 *
 * @param containerId - Container ID for the position
 * @param partial - Partial position configuration
 * @param defaultWidth - Default width if not specified
 * @param defaultHeight - Default height if not specified
 * @param resolver - Position resolver for anchor creation (optional)
 * @returns Normalized ObjectPosition
 */
function normalizePosition(
  containerId: string,
  partial: Partial<ObjectPosition>,
  defaultWidth: number,
  defaultHeight: number,
  resolver: ObjectPositionResolver | null,
): ObjectPosition {
  const anchorType = partial.anchorType ?? 'oneCell';

  // If the caller already provided a `from` anchor, use it as-is.
  // Otherwise, ask the resolver to create a default anchor at origin.
  let from = partial.from;
  if (!from) {
    if (resolver) {
      const resolvedPosition = resolver.fromPixels(
        containerId,
        10,
        10,
        defaultWidth,
        defaultHeight,
      );
      from = resolvedPosition.from ?? {
        cellId: toCellId('__placeholder__'),
        xOffset: 10,
        yOffset: 10,
      };
    } else {
      // Fallback - shouldn't happen in normal flow
      from = { cellId: toCellId('__placeholder__'), xOffset: 10, yOffset: 10 };
      console.warn('[PictureManager] resolver not set, using placeholder anchor');
    }
  }

  return {
    anchorType,
    from: from!,
    to: partial.to,
    x: partial.x,
    y: partial.y,
    width: partial.width ?? defaultWidth,
    height: partial.height ?? defaultHeight,
    rotation: partial.rotation ?? 0,
    flipH: partial.flipH,
    flipV: partial.flipV,
  };
}

// =============================================================================
// PICTURE OPERATIONS
// =============================================================================

/**
 * Create a picture object.
 *
 * Creates a new picture floating object with the specified source image and position.
 * The picture is written to the in-memory cache synchronously and persisted to
 * ComputeBridge asynchronously.
 *
 * @param params - Parameters for creating the picture
 * @returns The created PictureObject
 * @throws Error if the document is not found
 *
 * @example
 * ```typescript
 * const picture = createPicture({
 *   ctx,
 *   containerId: 'sheet1',
 *   src: 'data:image/png;base64,...',
 *   position: { x: 100, y: 100, width: 200, height: 150 },
 *   options: { name: 'My Picture', altText: 'A sample image' },
 *   getOrCreateMaps,
 *   getNextZIndex,
 *   generateObjectId,
 *   generateObjectName,
 * });
 * ```
 */
export function createPicture(params: CreatePictureParams): PictureObject {
  const {
    ctx,
    containerId,
    src,
    position,
    options,
    getOrCreateMaps,
    getNextZIndex,
    generateObjectId,
    generateObjectName,
  } = params;

  // Pre-compute values that don't need store access
  const id = generateObjectId();
  const now = Date.now();

  // Default original dimensions if not provided
  // In practice, the caller should measure the image first
  const originalWidth = 200;
  const originalHeight = 150;

  // Pre-compute position (may use resolver but doesn't modify store)
  const normalizedPosition = normalizePosition(
    containerId,
    position,
    originalWidth,
    originalHeight,
    ctx.resolver,
  );

  // Get cache map for the container
  const maps = getOrCreateMaps(containerId);
  if (!maps) {
    throw new DocumentNotReadyError(`Container not found: ${containerId}`);
  }

  // Get z-index from current cache contents
  const zIndex = getNextZIndex(containerId);

  const pictureObj: PictureObject = {
    id,
    type: 'picture',
    sheetId: toSheetId(containerId),
    containerId,
    anchor: normalizedPosition,
    src,
    originalWidth,
    originalHeight,
    position: normalizedPosition,
    zIndex,
    locked: options?.locked ?? false,
    printable: options?.printable ?? true,
    name: options?.name ?? generateObjectName('picture'),
    altText: options?.altText,
    crop: options?.crop,
    adjustments: options?.adjustments,
    border: options?.border,
    createdAt: now,
    updatedAt: now,
  };

  // Write to in-memory cache synchronously
  maps.floatingObjects.set(id, pictureObj as FloatingObject);

  // Persist to ComputeBridge asynchronously (fire-and-forget)
  ctx.computeBridge.setFloatingObject(containerId, id, pictureObj).catch((err) => {
    console.error('[PictureManager] Failed to persist picture to ComputeBridge:', err);
  });

  return pictureObj;
}

/**
 * Export a picture as a downloadable file.
 *
 * Creates a temporary download link from the picture's src (data URL or blob URL)
 * and triggers a download to the user's device.
 *
 * @param params - Parameters for exporting the picture
 *
 * @example
 * ```typescript
 * const picture = manager.getObject(pictureId) as PictureObject;
 * exportPictureAsFile({
 *   picture,
 *   filename: 'exported-image.png'
 * });
 * ```
 */
export function exportPictureAsFile(params: ExportPictureParams): void {
  const { picture, filename } = params;

  // Determine filename
  const defaultFilename = picture.name ? `${picture.name}.png` : 'image.png';
  const finalFilename = filename ?? defaultFilename;

  // Create a temporary download link
  const link = document.createElement('a');
  link.href = picture.src;
  link.download = finalFilename;
  link.style.display = 'none';

  // Append to body, click, and remove
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Prepare duplication data for a picture object.
 *
 * Computes the new position and options needed to create a duplicate of the
 * given picture. This function does not create the picture itself - it returns
 * the parameters needed for createPicture.
 *
 * @param params - Parameters for duplicating the picture
 * @returns The new position and options for the duplicate
 *
 * @example
 * ```typescript
 * const picture = manager.getObject(pictureId) as PictureObject;
 * const { newPosition, options } = preparePictureDuplication({
 *   picture,
 *   offset: { dx: 30, dy: 30 }
 * });
 *
 * const duplicate = createPicture({
 *   ctx,
 *   containerId: picture.containerId,
 *   src: picture.src,
 *   position: newPosition,
 *   options,
 *   ...helpers
 * });
 * ```
 */
export function preparePictureDuplication(params: DuplicatePictureParams): DuplicatePictureResult {
  const { picture, offset } = params;

  const dx = offset?.dx ?? DEFAULT_DUPLICATE_OFFSET;
  const dy = offset?.dy ?? DEFAULT_DUPLICATE_OFFSET;

  // Create a new position offset from the original
  const newPosition: ObjectPosition = {
    ...picture.position,
    from: {
      ...picture.position.from,
      xOffset: picture.position.from.xOffset + dx,
      yOffset: picture.position.from.yOffset + dy,
    },
  };

  // Handle two-cell anchor
  if (picture.position.to) {
    newPosition.to = {
      ...picture.position.to,
      xOffset: picture.position.to.xOffset + dx,
      yOffset: picture.position.to.yOffset + dy,
    };
  }

  // Prepare options (excluding name which should be regenerated)
  const options: CreatePictureOptions = {
    altText: picture.altText,
    locked: false, // Duplicates are always unlocked initially
    printable: picture.printable,
    crop: picture.crop,
    adjustments: picture.adjustments,
    border: picture.border,
  };

  return { newPosition, options };
}

/**
 * Check if a floating object is a picture.
 *
 * Type guard function to narrow FloatingObject to PictureObject.
 *
 * @param obj - The floating object to check
 * @returns True if the object is a picture
 *
 * @example
 * ```typescript
 * const obj = manager.getObject(objectId);
 * if (obj && isPictureObject(obj)) {
 *   console.log(obj.src); // TypeScript knows this is a PictureObject
 * }
 * ```
 */
export function isPictureObject(obj: FloatingObject): obj is PictureObject {
  return obj.type === 'picture';
}

/**
 * Get picture-specific properties from a floating object.
 *
 * Returns the picture-specific properties if the object is a picture,
 * or undefined otherwise. Useful for optional chaining.
 *
 * @param obj - The floating object to check
 * @returns The PictureObject if it's a picture, undefined otherwise
 *
 * @example
 * ```typescript
 * const obj = manager.getObject(objectId);
 * const src = asPictureObject(obj)?.src;
 * ```
 */
export function asPictureObject(obj: FloatingObject | undefined): PictureObject | undefined {
  if (obj && isPictureObject(obj)) {
    return obj;
  }
  return undefined;
}

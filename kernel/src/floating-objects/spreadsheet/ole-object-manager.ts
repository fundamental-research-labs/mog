/**
 * OLE Object Manager (Spreadsheet-Specific)
 *
 * Standalone functions for OLE object-specific floating object operations.
 *
 * This is spreadsheet-specific because:
 * - OLE objects are positioned on the cell grid
 * - Relies on ComputeBridge for persistence
 *
 * OLE objects represent embedded or linked external content (Word documents,
 * PDF files, Visio drawings). They may have a preview image (PNG/JPEG) or
 * display as an icon.
 */

import type {
  FloatingObject,
  ObjectPosition,
  OleObjectObject,
} from '@mog-sdk/contracts/floating-objects';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import { DocumentNotReadyError } from '../../errors/document';
import type { DocumentObjectMaps } from '../types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Parameters for creating an OLE object.
 */
export interface CreateOleObjectParams {
  /** The context containing store refs and providers */
  ctx: {
    computeBridge: ComputeBridge;
  };
  /** Container (sheet) to create the OLE object in */
  containerId: SheetId;
  /** OLE ProgID identifying the source application */
  progId: string;
  /** Display aspect: 'content' renders the object preview, 'icon' shows an application icon */
  dvAspect: 'content' | 'icon';
  /** Whether the object links to an external file */
  isLinked: boolean;
  /** Whether the object data is embedded in the workbook */
  isEmbedded: boolean;
  /** Blob URL for the preview image, null for unsupported formats */
  previewImageSrc: string | null;
  /** Descriptive text for accessibility */
  altText: string;
  /** Initial position configuration */
  position: Partial<ObjectPosition>;
  /** Function to get or create floating object maps for a container */
  getOrCreateMaps: (containerId: SheetId) => DocumentObjectMaps | null;
  /** Function to get the next z-index for a container */
  getNextZIndex: (containerId: SheetId) => number;
  /** Function to generate a unique object ID */
  generateObjectId: () => string;
  /** Function to generate a unique object name */
  generateObjectName: (type: 'oleObject') => string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function normalizePosition(
  partial: Partial<ObjectPosition>,
  defaultWidth: number,
  defaultHeight: number,
): ObjectPosition {
  const anchorType = partial.anchorType ?? 'oneCell';
  const defaultAnchor = { cellId: toCellId('cell-0-0'), xOffset: 10, yOffset: 10 };

  return {
    anchorType,
    from: partial.from ?? defaultAnchor,
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
// OLE OBJECT OPERATIONS
// =============================================================================

/**
 * Create an OLE object.
 *
 * @param params - Parameters for creating the OLE object
 * @returns The created OleObjectObject
 * @throws Error if the document is not found
 */
export async function createOleObject(params: CreateOleObjectParams): Promise<OleObjectObject> {
  const {
    ctx,
    containerId,
    progId,
    dvAspect,
    isLinked,
    isEmbedded,
    previewImageSrc,
    altText,
    position,
    getOrCreateMaps,
    getNextZIndex,
    generateObjectId,
    generateObjectName,
  } = params;

  const id = generateObjectId();
  const now = Date.now();

  const defaultWidth = 200;
  const defaultHeight = 150;

  const normalizedPosition = normalizePosition(position, defaultWidth, defaultHeight);

  const maps = getOrCreateMaps(containerId);
  if (!maps) {
    throw new DocumentNotReadyError(`Container not found: ${containerId}`);
  }

  const zIndex = getNextZIndex(containerId);

  const oleObj: OleObjectObject = {
    id,
    type: 'oleObject',
    sheetId: containerId,
    containerId,
    progId,
    dvAspect,
    isLinked,
    isEmbedded,
    previewImageSrc,
    altText,
    position: normalizedPosition,
    anchor: normalizedPosition,
    zIndex,
    locked: false,
    printable: true,
    name: generateObjectName('oleObject'),
    createdAt: now,
    updatedAt: now,
  };

  // Write to in-memory cache synchronously
  maps.floatingObjects.set(id, oleObj as FloatingObject);

  // Persist to ComputeBridge asynchronously
  ctx.computeBridge.setFloatingObject(containerId, id, oleObj).catch((err) => {
    console.error('[OleObjectManager] Failed to persist OLE object to ComputeBridge:', err);
  });

  return oleObj;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isOleObject(obj: FloatingObject): obj is OleObjectObject {
  return obj.type === 'oleObject';
}

export function asOleObject(obj: FloatingObject | undefined): OleObjectObject | undefined {
  if (obj && isOleObject(obj)) return obj;
  return undefined;
}

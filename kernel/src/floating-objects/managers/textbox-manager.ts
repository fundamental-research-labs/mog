/**
 * TextBox Manager
 *
 * Standalone functions for textbox-specific operations extracted from FloatingObjectManager.
 * These functions handle textbox creation and duplication, with proper anchor resolution
 * via IPositionResolver (app-agnostic).
 *
 * @see ../floating-object-manager.ts - Main manager class
 * @see ../types.ts - Shared types
 * @see contracts/src/floating-objects.ts - Type contracts
 */

import type {
  CreateTextBoxOptions,
  FloatingObject,
  ObjectPosition,
  TextBoxObject,
} from '@mog-sdk/contracts/floating-objects';
import type { IObjectStore, IPositionResolver } from '@mog-sdk/contracts/objects/canvas-object';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { DEFAULT_DUPLICATE_OFFSET } from '../types';

type ObjectPositionResolver = IPositionResolver<ObjectPosition>;

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default fill for new textboxes - white background like Excel */
const DEFAULT_TEXTBOX_FILL = { type: 'solid' as const, color: '#ffffff' };

/** Default border for new textboxes - thin black outline like Excel */
const DEFAULT_TEXTBOX_BORDER = { style: 'solid' as const, color: '#000000', width: 1 };

// =============================================================================
// TYPES
// =============================================================================

/**
 * Parameters for creating a textbox.
 */
export interface CreateTextBoxParams {
  /** Container (sheet/slide/page) to create the textbox in */
  containerId: string;
  /** Initial text content (can be plain text or rich text HTML) */
  content: string;
  /** Position configuration for the textbox */
  position: Partial<ObjectPosition>;
  /** Optional configuration for the textbox */
  options?: CreateTextBoxOptions;
}

/**
 * Parameters for duplicating a textbox.
 */
export interface DuplicateTextBoxParams {
  /** The textbox object to duplicate */
  textbox: TextBoxObject;
  /** Optional offset for the duplicate position */
  offset?: { dx: number; dy: number };
}

/**
 * Dependencies required for textbox operations.
 * Uses IPositionResolver instead of CellPositionLookup for app-agnostic anchoring.
 */
export interface TextBoxDependencies {
  /** Object store for CRUD operations */
  store: IObjectStore<FloatingObject>;
  /** Position resolver for anchor creation (app-agnostic) */
  resolver: ObjectPositionResolver | null;
  /** Function to generate unique object IDs */
  generateObjectId: () => string;
  /** Function to generate unique object names */
  generateObjectName: (type: 'textbox') => string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the next z-index for a container (highest current + 1).
 *
 * @param deps - Store dependencies
 * @param containerId - Container to get z-index for
 * @returns Next available z-index value
 */
async function getNextZIndex(
  store: IObjectStore<FloatingObject>,
  containerId: string,
): Promise<number> {
  const objects = await store.readInDocument(containerId);
  let maxZ = 0;
  for (const obj of objects) {
    if (obj.zIndex > maxZ) {
      maxZ = obj.zIndex;
    }
  }
  return maxZ + 1;
}

/**
 * Normalize a partial position configuration to a full ObjectPosition
 * using the generic IPositionResolver.
 *
 * @param containerId - The container the position is for
 * @param partial - Partial position configuration
 * @param defaultWidth - Default width if not specified
 * @param defaultHeight - Default height if not specified
 * @param resolver - Position resolver for anchor creation
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
      console.warn('[textbox-manager] resolver not set, using placeholder anchor');
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
// TEXTBOX OPERATIONS
// =============================================================================

/**
 * Create a new textbox object.
 *
 * Creates a textbox with the specified content and position. The textbox uses
 * IPositionResolver-based anchoring, ensuring the anchor is resolved correctly
 * for whatever app context is active.
 *
 * @param params - The textbox creation parameters
 * @param deps - Dependencies required for the operation
 * @returns The created TextBoxObject
 * @throws Error if the document is not found
 *
 * @example
 * ```typescript
 * const textbox = await createTextBox(
 *   {
 *     containerId: 'sheet-1',
 *     content: 'Hello World',
 *     position: { x: 100, y: 100, width: 200, height: 100 },
 *     options: { fill: { type: 'solid', color: '#ffffff' } }
 *   },
 *   deps
 * );
 * ```
 */
export async function createTextBox(
  params: CreateTextBoxParams,
  deps: TextBoxDependencies,
): Promise<TextBoxObject> {
  const { containerId, content, position, options } = params;
  const { store, resolver, generateObjectId, generateObjectName } = deps;

  // Pre-compute values
  const id = generateObjectId();
  const now = Date.now();

  // Default text box size
  const defaultWidth = 150;
  const defaultHeight = 75;

  // Pre-compute position (may use resolver but doesn't modify storage)
  const normalizedPosition = normalizePosition(
    containerId,
    position,
    defaultWidth,
    defaultHeight,
    resolver,
  );

  // Get z-index from existing objects
  const zIndex = await getNextZIndex(store, containerId);

  // Build the ShapeText from options or defaults
  const textObj = options?.text ?? {
    content,
    margins: { top: 4, right: 4, bottom: 4, left: 4 },
    verticalAlign: 'top' as const,
  };

  const textBoxObj: TextBoxObject = {
    id,
    type: 'textbox',
    sheetId: toSheetId(containerId),
    containerId,
    anchor: normalizedPosition,
    text: textObj,
    position: normalizedPosition,
    zIndex,
    locked: options?.locked ?? false,
    printable: options?.printable ?? true,
    name: options?.name ?? generateObjectName('textbox'),
    altText: options?.altText,
    fill: options?.fill ?? DEFAULT_TEXTBOX_FILL,
    border: options?.border ?? DEFAULT_TEXTBOX_BORDER,
    textEffects: options?.textEffects,
    createdAt: now,
    updatedAt: now,
  };

  await store.create(containerId, textBoxObj as FloatingObject);

  return textBoxObj;
}

/**
 * Create a duplicate of an existing textbox with an offset position.
 *
 * Duplicates all properties of the source textbox including content, formatting,
 * fill, border, and margins. The duplicate is positioned offset from the original.
 *
 * @param params - The duplication parameters
 * @param deps - Dependencies required for the operation
 * @returns The duplicated TextBoxObject
 *
 * @example
 * ```typescript
 * const duplicate = await duplicateTextBox(
 *   {
 *     textbox: existingTextbox,
 *     offset: { dx: 30, dy: 30 }
 *   },
 *   deps
 * );
 * ```
 */
export async function duplicateTextBox(
  params: DuplicateTextBoxParams,
  deps: TextBoxDependencies,
): Promise<TextBoxObject> {
  const { textbox, offset } = params;
  const { generateObjectName } = deps;

  const dx = offset?.dx ?? DEFAULT_DUPLICATE_OFFSET;
  const dy = offset?.dy ?? DEFAULT_DUPLICATE_OFFSET;

  // Create a new position offset from the original
  const newPosition: Partial<ObjectPosition> = {
    ...textbox.position,
    from: {
      ...textbox.position.from,
      xOffset: textbox.position.from.xOffset + dx,
      yOffset: textbox.position.from.yOffset + dy,
    },
  };

  // Handle two-cell anchor 'to' position
  if (textbox.position.to) {
    newPosition.to = {
      ...textbox.position.to,
      xOffset: textbox.position.to.xOffset + dx,
      yOffset: textbox.position.to.yOffset + dy,
    };
  }

  // Use containerId from the original textbox (falls back to sheetId for compat)
  const containerId = textbox.containerId || textbox.sheetId;

  // Create the duplicate with same properties but new position
  return createTextBox(
    {
      containerId,
      content: textbox.text?.content ?? '',
      position: newPosition,
      options: {
        name: generateObjectName('textbox'),
        altText: textbox.altText,
        locked: false, // Duplicates are not locked
        printable: textbox.printable,
        fill: textbox.fill,
        border: textbox.border,
        text: textbox.text,
      },
    },
    deps,
  );
}

/**
 * Check if a floating object is a textbox.
 *
 * Type guard function for narrowing FloatingObject to TextBoxObject.
 *
 * @param obj - The floating object to check
 * @returns True if the object is a textbox
 *
 * @example
 * ```typescript
 * const obj = manager.getObject(id);
 * if (obj && isTextBox(obj)) {
 *   // obj is now typed as TextBoxObject
 *   console.log(obj.text?.content);
 * }
 * ```
 */
export function isTextBox(obj: FloatingObject): obj is TextBoxObject {
  return obj.type === 'textbox';
}

/**
 * Get default textbox options.
 *
 * Returns a complete set of default options for creating a textbox.
 * Useful for callers who want to customize only specific properties.
 *
 * @returns Default CreateTextBoxOptions
 *
 * @example
 * ```typescript
 * const defaults = getDefaultTextBoxOptions();
 * const options = {
 *   ...defaults,
 *   fill: { type: 'solid', color: '#e0e0e0' }
 * };
 * ```
 */
export function getDefaultTextBoxOptions(): Required<
  Pick<CreateTextBoxOptions, 'locked' | 'printable' | 'text'>
> {
  return {
    locked: false,
    printable: true,
    text: {
      content: '',
      margins: { top: 4, right: 4, bottom: 4, left: 4 },
      verticalAlign: 'top',
    },
  };
}

/**
 * Default textbox dimensions in pixels.
 */
export const DEFAULT_TEXTBOX_WIDTH = 150;
export const DEFAULT_TEXTBOX_HEIGHT = 75;

// =============================================================================
// TEXT_EFFECT DESERIALIZATION
// =============================================================================

/**
 * Deserialize a TextBoxObject from storage format to proper plain objects.
 *
 * When TextBox objects with TextEffect config are stored and read back,
 * the nested `textEffects` property should be a plain object. This function
 * ensures proper deserialization.
 *
 * @param stored - The stored floating object from storage
 * @returns Deserialized TextBoxObject with proper TextEffect config, or null if not a textbox
 *
 * @example
 * ```typescript
 * const obj = await readObject(deps, objectId);
 * const textbox = asTextBoxWithTextEffect(obj);
 * if (textbox?.textEffects) {
 *   console.log(textbox.textEffects.warpPreset);
 * }
 * ```
 */
export function asTextBoxWithTextEffect(stored: FloatingObject): TextBoxObject | null {
  if (stored.type !== 'textbox') return null;

  // Check if the textEffects property needs deserialization
  const storedTextEffect = (stored as { textEffects?: unknown }).textEffects;

  // If no textEffects config, return as-is
  if (!storedTextEffect) {
    return stored as TextBoxObject;
  }

  // With ComputeBridge storage, objects are plain JSON -- no Y.Map deserialization needed
  if (typeof storedTextEffect === 'object') {
    return stored as TextBoxObject;
  }

  // Fallback: return as-is
  return stored as TextBoxObject;
}

/**
 * Equation Manager (Spreadsheet-Specific)
 *
 * Standalone functions for equation-specific operations.
 * Handles creating, updating, and managing equation floating objects.
 *
 * This is spreadsheet-specific because:
 * - Equations are positioned on the cell grid
 * - Event emission flows through the spreadsheet MutationResult pipeline
 *
 * @see contracts/src/floating-objects.ts - Type contracts for equations
 */

import type { EquationId, EquationStyle } from '@mog-sdk/contracts/equation';
import type {
  CreateEquationOptions,
  EquationObject,
  FloatingObject,
  ObjectPosition,
} from '@mog-sdk/contracts/floating-objects';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { getEquationStyleDefaults } from './equation-defaults';

/** Create a branded EquationId from a plain string. */
function createEquationId(id: string): EquationId {
  return id as EquationId;
}

import type { IObjectStore } from '@mog-sdk/contracts/objects/canvas-object';
import type { SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_EQUATION_WIDTH = 150;
const DEFAULT_EQUATION_HEIGHT = 50;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateObjectId(): string {
  return `eq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function getNextZIndex(
  store: IObjectStore<FloatingObject>,
  containerId: SheetId,
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

function normalizePosition(partial: Partial<ObjectPosition>): ObjectPosition {
  const anchorType = partial.anchorType ?? 'oneCell';
  const defaultAnchor = { cellId: toCellId('cell-0-0'), xOffset: 10, yOffset: 10 };

  return {
    anchorType,
    from: partial.from ?? defaultAnchor,
    to: partial.to,
    x: partial.x,
    y: partial.y,
    width: partial.width ?? DEFAULT_EQUATION_WIDTH,
    height: partial.height ?? DEFAULT_EQUATION_HEIGHT,
    rotation: partial.rotation ?? 0,
    flipH: partial.flipH,
    flipV: partial.flipV,
  };
}

// =============================================================================
// EQUATION OPERATIONS
// =============================================================================

/**
 * Create a new equation object.
 */
export async function createEquation(
  store: IObjectStore<FloatingObject>,
  containerId: SheetId,
  position: Partial<ObjectPosition>,
  options?: CreateEquationOptions,
  nameGenerator?: () => string,
): Promise<EquationObject> {
  const id = generateObjectId();
  const now = Date.now();
  const normalizedPosition = normalizePosition(position);

  const style: EquationStyle = {
    ...getEquationStyleDefaults(),
    ...options?.style,
  };

  const zIndex = await getNextZIndex(store, containerId);

  const equationObj: EquationObject = {
    id,
    type: 'equation',
    sheetId: containerId,
    containerId,
    position: normalizedPosition,
    anchor: normalizedPosition,
    zIndex,
    locked: options?.locked ?? false,
    printable: options?.printable ?? true,
    name: nameGenerator?.() ?? options?.name ?? `Equation ${id.slice(-4)}`,
    altText: options?.altText,
    equation: {
      id: createEquationId(id),
      latex: options?.latex ?? '',
      omml: options?.omml ?? '',
      style,
    },
    createdAt: now,
    updatedAt: now,
  };

  await store.create(containerId, equationObj as FloatingObject);

  return equationObj;
}

/**
 * Update an equation's LaTeX content.
 */
export async function updateEquation(
  store: IObjectStore<FloatingObject>,
  objectId: string,
  latex: string,
  omml?: string,
): Promise<void> {
  const found = await store.read(objectId);
  if (!found.object || !found.containerId) {
    console.warn(`[equation-manager] Equation not found: ${objectId}`);
    return;
  }

  if (found.object.type !== 'equation') {
    console.warn(`[equation-manager] Not an equation: ${objectId}`);
    return;
  }

  const eq = found.object as EquationObject;
  const updatedEquation = {
    ...eq.equation,
    latex,
    ...(omml !== undefined ? { omml } : {}),
  };

  await store.update(
    objectId,
    { equation: updatedEquation } as Partial<FloatingObject>,
    found.containerId,
  );
}

/**
 * Update an equation's OMML directly (used for XLSX import).
 */
export async function updateEquationOmml(
  store: IObjectStore<FloatingObject>,
  objectId: string,
  omml: string,
): Promise<void> {
  const found = await store.read(objectId);
  if (!found.object || !found.containerId) return;

  const eq = found.object as EquationObject;
  const updatedEquation = { ...eq.equation, omml };

  await store.update(
    objectId,
    { equation: updatedEquation } as Partial<FloatingObject>,
    found.containerId,
  );
}

/**
 * Delete an equation object.
 */
export async function deleteEquation(
  store: IObjectStore<FloatingObject>,
  objectId: string,
): Promise<void> {
  const result = await store.delete(objectId);
  if (!result.success) {
    console.warn(`[equation-manager] Equation not found for deletion: ${objectId}`);
  }
}

/**
 * Duplicate an equation object.
 */
export async function duplicateEquation(
  store: IObjectStore<FloatingObject>,
  objectId: string,
  offsetX: number = 20,
  offsetY: number = 20,
): Promise<EquationObject | null> {
  const found = await store.read(objectId);
  if (!found.object || !found.containerId) return null;

  const sourceObj = found.object;
  if (sourceObj.type !== 'equation') return null;

  const eq = sourceObj as EquationObject;

  const newPosition: Partial<ObjectPosition> = {
    ...eq.position,
    x: (eq.position.x ?? 0) + offsetX,
    y: (eq.position.y ?? 0) + offsetY,
  };

  return createEquation(store, eq.sheetId, newPosition, {
    latex: eq.equation.latex,
    omml: eq.equation.omml,
    style: eq.equation.style,
    name: `${eq.name} (Copy)`,
    altText: eq.altText,
    locked: eq.locked,
    printable: eq.printable,
  });
}

/**
 * Check if an object is an equation.
 */
export function isEquation(obj: FloatingObject | undefined | null): obj is EquationObject {
  return obj?.type === 'equation';
}

/**
 * Convert a stored floating object to an EquationObject with proper structure.
 */
export function asEquationObject(stored: FloatingObject): EquationObject | null {
  if (stored.type !== 'equation') return null;

  const storedEquation = (stored as { equation: unknown }).equation;

  if (
    storedEquation &&
    typeof storedEquation === 'object' &&
    'latex' in storedEquation &&
    typeof (storedEquation as { latex?: unknown }).latex === 'string' &&
    'style' in storedEquation &&
    typeof (storedEquation as { style?: unknown }).style === 'object' &&
    'fontFamily' in ((storedEquation as { style: object }).style as object)
  ) {
    return stored as EquationObject;
  }

  if (storedEquation && typeof storedEquation === 'object') {
    const plainEquation = storedEquation as {
      id?: unknown;
      latex?: unknown;
      omml?: unknown;
      ast?: unknown;
      style?: unknown;
    };

    const style: EquationStyle =
      plainEquation.style && typeof plainEquation.style === 'object'
        ? (plainEquation.style as EquationStyle)
        : {
            fontFamily: 'Cambria Math',
            fontSize: 11,
            color: '#000000',
            backgroundColor: 'transparent',
            justification: 'center',
            displayMode: true,
            smallFractions: false,
          };

    return {
      id: stored.id,
      type: 'equation',
      sheetId: stored.sheetId,
      containerId: stored.sheetId,
      position: stored.position,
      anchor: stored.position,
      zIndex: stored.zIndex,
      locked: stored.locked,
      printable: stored.printable,
      name: stored.name,
      altText: stored.altText,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      equation: {
        id: plainEquation.id as EquationObject['equation']['id'],
        latex: (plainEquation.latex as string) ?? '',
        omml: (plainEquation.omml as string) ?? '',
        ast: plainEquation.ast as EquationObject['equation']['ast'],
        style,
      },
    };
  }

  console.warn('[equation-manager] Unexpected equation structure:', stored.id);
  return stored as EquationObject;
}

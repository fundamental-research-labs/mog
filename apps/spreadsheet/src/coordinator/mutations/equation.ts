/**
 * Equation Mutations Module
 *
 * Orchestrates equation write operations following the Mutations Layer pattern.
 * All equation writes go through this module to ensure:
 * - Proper undo description via workbook.setPendingUndoDescription()
 * - Consistent API for action handlers
 * - EventBus integration for UI updates
 *
 * Architecture: "Reads Direct, Writes Orchestrated"
 * - Reads: Use equation-operations.ts functions directly
 * - Writes: Come through this mutations layer
 *
 * Uses the handle-based Worksheet API (ws.equations.*, ws.objects.*) instead of
 * the legacy FloatingObjectManager.
 *
 */

import type { EquationStyle } from '@mog-sdk/contracts/equation';
import type {
  FloatingObjectDeletedEvent,
  FloatingObjectUpdatedEvent,
} from '@mog-sdk/contracts/events';
import type { EquationObject, FloatingObject } from '@mog-sdk/contracts/floating-objects';

import type { EquationConfig, WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Equation Error Types
// =============================================================================

/**
 * Equation operation error codes.
 */
export type EquationErrorCode = 'OBJECT_NOT_FOUND' | 'NOT_AN_EQUATION';

/**
 * Equation operation error structure.
 */
export interface EquationError {
  code: EquationErrorCode;
  message: string;
  objectId?: string;
}

/**
 * Result type for equation operations.
 */
export type EquationResult<T> =
  | { success: true; value: T }
  | { success: false; error: EquationError };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create error result for object not found.
 */
function objectNotFound(objectId: string): EquationResult<never> {
  return {
    success: false,
    error: {
      code: 'OBJECT_NOT_FOUND',
      message: `Object ${objectId} not found`,
      objectId,
    },
  };
}

/**
 * Create error result for non-equation object.
 */
function notAnEquation(objectId: string): EquationResult<never> {
  return {
    success: false,
    error: {
      code: 'NOT_AN_EQUATION',
      message: `Object ${objectId} is not an equation`,
      objectId,
    },
  };
}

/**
 * Get an equation object by ID with type validation using the handle-based API.
 */
async function getEquation(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  objectId: string,
): Promise<EquationResult<EquationObject>> {
  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.equations.get(objectId);
  if (!handle) {
    // Could be not found or not an equation — check via objects collection
    const objHandle = await ws.objects.get(objectId);
    if (!objHandle) return objectNotFound(objectId);
    return notAnEquation(objectId);
  }

  const obj = await handle.getData();
  return { success: true, value: obj as EquationObject };
}

// =============================================================================
// Insert Equation
// =============================================================================

/**
 * Insert a new equation object.
 *
 * @param workbook - Workbook API
 * @param sheetId - Sheet to create equation on
 * @param latex - LaTeX content
 * @param position - Position configuration
 * @param style - Optional style overrides
 * @returns Result with object ID or error
 */
export async function insertEquation(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  latex: string,
  position: Record<string, unknown>,
  style?: Partial<EquationStyle>,
): Promise<EquationResult<string>> {
  workbook.setPendingUndoDescription('Insert Equation');

  const ws = workbook.getSheetById(sheetId);
  const config: EquationConfig = {
    latex,
    x: position.x as number | undefined,
    y: position.y as number | undefined,
    width: position.width as number | undefined,
    height: position.height as number | undefined,
    style,
  };

  const handle = await ws.equations.add(config);

  // No manual event emission needed — ws.equations.add() writes through
  // the compute bridge, which returns floatingObjectChanges in the MutationResult.
  // MutationResultHandler emits floatingObject:updated automatically.

  return { success: true, value: handle.id };
}

// =============================================================================
// Update Equation
// =============================================================================

/**
 * Update equation LaTeX content.
 *
 * @param workbook - Workbook API
 * @param sheetId - Sheet containing the equation
 * @param objectId - Equation object ID
 * @param latex - New LaTeX content
 * @param omml - Optional OMML content
 * @returns Result indicating success or error
 */
export async function updateEquation(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  objectId: string,
  latex: string,
  omml?: string,
): Promise<EquationResult<void>> {
  const result = await getEquation(workbook, sheetId, objectId);
  if (!result.success) return result;

  const eq = result.value;

  workbook.setPendingUndoDescription('Edit Equation');

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.equations.get(objectId);
  if (!handle) return objectNotFound(objectId);

  await handle.update({ latex, omml });

  const event: FloatingObjectUpdatedEvent = {
    type: 'floatingObject:updated',
    objectId,
    sheetId: eq.sheetId,
    containerId: eq.sheetId,
    changes: {} as Partial<FloatingObject>,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Delete Equation
// =============================================================================

/**
 * Delete an equation object.
 *
 * @param workbook - Workbook API
 * @param sheetId - Sheet containing the equation
 * @param objectId - Equation object ID
 * @returns Result indicating success or error
 */
export async function deleteEquation(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  objectId: string,
): Promise<EquationResult<void>> {
  const result = await getEquation(workbook, sheetId, objectId);
  if (!result.success) return result;

  const eq = result.value;

  workbook.setPendingUndoDescription('Delete Equation');

  const ws = workbook.getSheetById(sheetId);

  await ws.objects.remove(objectId);

  const event: FloatingObjectDeletedEvent = {
    type: 'floatingObject:deleted',
    objectId,
    objectType: 'equation',
    sheetId: eq.sheetId,
    containerId: eq.sheetId,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Update Equation Style
// =============================================================================

/**
 * Update equation style properties.
 *
 * @param workbook - Workbook API
 * @param sheetId - Sheet containing the equation
 * @param objectId - Equation object ID
 * @param style - Style properties to update
 * @returns Result indicating success or error
 */
export async function updateEquationStyle(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  objectId: string,
  style: Partial<EquationStyle>,
): Promise<EquationResult<void>> {
  const result = await getEquation(workbook, sheetId, objectId);
  if (!result.success) return result;

  workbook.setPendingUndoDescription('Update Equation Style');

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.equations.get(objectId);
  if (!handle) return objectNotFound(objectId);

  await handle.update({ style });

  const eq = result.value;
  const updates = {
    equation: {
      ...eq.equation,
      style: {
        ...eq.equation.style,
        ...style,
      },
    },
  } as Partial<FloatingObject>;

  const event: FloatingObjectUpdatedEvent = {
    type: 'floatingObject:updated',
    objectId,
    sheetId: eq.sheetId,
    containerId: eq.sheetId,
    changes: updates,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

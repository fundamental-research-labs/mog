/**
 * Equation Operations Module
 *
 * Extracted from coordinator mutations - standalone functions for equation
 * floating object operations. All functions take manager: SpreadsheetObjectManager,
 * ctx: DocumentContext, and sheetId: SheetId as the first three params, following
 * the same pattern as shape-operations.ts.
 *
 * Note: creation events (canvasObject:created) are emitted by the
 * SpreadsheetObjectManager; this module emits update/delete events
 * (floatingObject:updated, floatingObject:deleted) directly.
 *
 * Functions throw KernelError on failure instead of returning OperationResult.
 */

import type { EquationConfig, EquationUpdates } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { EquationObject } from '@mog-sdk/contracts/floating-objects';

import { equationNotFound, operationFailed } from '../../../errors/api';
import type { SpreadsheetObjectManager } from '../../../floating-objects';

import type { DocumentContext } from './shared';

// =============================================================================
// Private Helpers
// =============================================================================

export const DEFAULT_EQUATION_WIDTH = 150;
export const DEFAULT_EQUATION_HEIGHT = 50;
const EMU_PER_PX = 9525;

/**
 * Get an equation object by ID, throwing if not found or not an equation.
 */
async function requireEquation(
  manager: SpreadsheetObjectManager,
  objectId: string,
): Promise<EquationObject> {
  const existing = await manager.getObject(objectId);
  if (!existing || existing.type !== 'equation') {
    throw equationNotFound(objectId);
  }
  return existing as EquationObject;
}

// =============================================================================
// Equation Operations
// =============================================================================

/**
 * Create a new equation on a sheet.
 * Throws KernelError if creation fails.
 *
 * @returns The created equation's ID
 */
export async function createEquation(
  _manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  config: EquationConfig,
): Promise<string> {
  const anchor = config.anchorCell ?? { row: 0, col: 0 };
  const xPx = config.x ?? 0;
  const yPx = config.y ?? 0;
  const widthPx = config.width ?? DEFAULT_EQUATION_WIDTH;
  const heightPx = config.height ?? DEFAULT_EQUATION_HEIGHT;

  const equationConfig = {
    type: 'equation' as const,
    equation: config.latex,
    anchor: {
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      anchorRowOffsetEmu: Math.round(yPx * EMU_PER_PX),
      anchorColOffsetEmu: Math.round(xPx * EMU_PER_PX),
      anchorMode: 'oneCell',
      extentCxEmu: Math.round(widthPx * EMU_PER_PX),
      extentCyEmu: Math.round(heightPx * EMU_PER_PX),
    },
    width: widthPx,
    height: heightPx,
  };

  const result = await ctx.computeBridge.createFloatingObject(sheetId, equationConfig);
  const newId = result.floatingObjectChanges?.[0]?.objectId;
  if (!newId) {
    throw operationFailed('addEquation', 'creation returned no object ID');
  }

  return newId;
}

/**
 * Update an existing equation's content and/or style.
 * Throws KernelError if the equation does not exist.
 */
export async function updateEquation(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  updates: EquationUpdates,
): Promise<void> {
  const existing = await requireEquation(manager, objectId);

  // Update LaTeX content if provided
  if (updates.latex !== undefined) {
    await manager.updateEquation(objectId, updates.latex);
  }

  // Update OMML content if provided
  if (updates.omml !== undefined) {
    await manager.updateEquationOmml(objectId, updates.omml);
  }

  // Update style if provided -- apply via updateObject on the equation property
  if (updates.style) {
    await manager.updateObject(objectId, {
      equation: {
        ...existing.equation,
        style: {
          ...existing.equation.style,
          ...updates.style,
        },
      },
    });
  }

  // Emit update event for UI components and cache invalidation
  ctx.eventBus.emit({
    type: 'floatingObject:updated',
    sheetId,
    containerId: sheetId,
    objectId,
    changes: {},
    source: 'user',
    timestamp: Date.now(),
  });
}

/**
 * Delete an equation from a sheet.
 * Throws KernelError if the equation does not exist.
 */
export async function deleteEquation(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
): Promise<void> {
  await requireEquation(manager, objectId);

  await manager.deleteObject(objectId);

  // Emit deletion event for UI components and cache invalidation
  ctx.eventBus.emit({
    type: 'floatingObject:deleted',
    sheetId,
    containerId: sheetId,
    objectId,
    objectType: 'equation',
    source: 'user',
    timestamp: Date.now(),
  });
}

/**
 * Update an equation's style properties.
 * Throws KernelError if the equation does not exist.
 */
export async function updateEquationStyle(
  manager: SpreadsheetObjectManager,
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
  style: Partial<NonNullable<EquationConfig['style']>>,
): Promise<void> {
  const existing = await requireEquation(manager, objectId);

  // Update the equation style via updateObject
  await manager.updateObject(objectId, {
    equation: {
      ...existing.equation,
      style: {
        ...existing.equation.style,
        ...style,
      },
    },
  });

  // Emit update event for UI components and cache invalidation
  ctx.eventBus.emit({
    type: 'floatingObject:updated',
    sheetId,
    containerId: sheetId,
    objectId,
    changes: {},
    source: 'user',
    timestamp: Date.now(),
  });
}

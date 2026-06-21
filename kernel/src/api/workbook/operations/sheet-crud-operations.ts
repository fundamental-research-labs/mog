/**
 * Sheet CRUD Operations (Workbook-level)
 *
 * Sheet lifecycle operations: create, delete, rename, copy, move, hide.
 * Events auto-flow through the MutationResult pipeline — no manual event emission.
 *
 * @see mutations/sheets.ts (deleted) — former manual event emission layer
 */

import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../worksheet/operations/shared';
import type { MutationAdmissionOptions } from '../../../bridges/compute';

// =============================================================================
// Sheet CRUD
// =============================================================================

/**
 * Create a new sheet.
 *
 * @param ctx - Store context with computeBridge
 * @param name - Sheet name
 * @returns The new sheet ID
 */
export async function createSheet(
  ctx: DocumentContext,
  name: string,
  options?: MutationAdmissionOptions,
): Promise<SheetId> {
  const result = await ctx.computeBridge.createSheet(name, options);
  return result.sheetId;
}

/**
 * Remove a sheet.
 * Cannot delete the last remaining sheet.
 *
 * @param ctx - Store context with computeBridge
 * @param sheetId - Sheet to delete
 * @returns true if deleted, false if not (e.g., last sheet)
 */
export async function removeSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  options?: MutationAdmissionOptions,
): Promise<boolean> {
  try {
    await ctx.computeBridge.removeSheet(sheetId, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename a sheet.
 *
 * @param ctx - Store context with computeBridge
 * @param sheetId - Sheet to rename
 * @param name - New name
 */
export async function renameSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  name: string,
  options?: MutationAdmissionOptions,
): Promise<void> {
  await ctx.computeBridge.renameSheet(sheetId, name, options);
}

/**
 * Copy a sheet with all its data.
 *
 * @param ctx - Store context with computeBridge
 * @param sourceSheetId - Sheet to copy
 * @param newName - Name for the copy
 * @returns The new sheet ID, or null if source sheet not found
 */
export async function copySheet(
  ctx: DocumentContext,
  sourceSheetId: SheetId,
  newName: string,
  options?: MutationAdmissionOptions,
): Promise<SheetId | null> {
  try {
    const result = await ctx.computeBridge.copySheet(sourceSheetId, newName, options);
    return result.newSheetId;
  } catch {
    return null;
  }
}

// =============================================================================
// Sheet Reordering
// =============================================================================

/**
 * Move a sheet to a new position in the sheet order.
 *
 * @param ctx - Store context with computeBridge
 * @param sheetId - Sheet to move
 * @param toIndex - Target index (0-based)
 * @returns true if moved, false if not
 */
export async function moveSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  toIndex: number,
  options?: MutationAdmissionOptions,
): Promise<boolean> {
  try {
    await ctx.computeBridge.moveSheet(sheetId, toIndex, options);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Sheet Visibility
// =============================================================================

/**
 * Set the visibility of a sheet.
 * Cannot hide the last visible sheet.
 *
 * @param ctx - Store context with computeBridge
 * @param sheetId - Sheet ID
 * @param hidden - true to hide, false to show
 * @returns true if visibility was changed
 */
export async function setSheetHidden(
  ctx: DocumentContext,
  sheetId: SheetId,
  hidden: boolean,
): Promise<boolean> {
  try {
    await ctx.computeBridge.setSheetHidden(sheetId, hidden);
    return true;
  } catch {
    return false;
  }
}

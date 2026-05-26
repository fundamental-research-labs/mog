/**
 * Kernel API: Sheets
 *
 * @stability experimental
 *
 * Low-level function-oriented API for sheet metadata reads and view operations.
 * Available for feedback — may change across minor versions.
 *
 * External SDK consumers: prefer the high-level Workbook API for sheet mutations.
 * This namespace provides read-only metadata queries (name, order, used range)
 * plus view operations (frozen panes). Mutation operations (create, remove,
 * rename, copy, move, hide/show) live exclusively in WorkbookSheets
 * (api/workbook/sheets.ts) which handles events, cache sync, and receipts.
 *
 * All functions accept IKernelContext for a consistent public API surface.
 * Internal casts to DocumentContext are safe — callers always pass DocumentHandle.context.
 */

import type { PrintSettings, SheetId } from '@mog-sdk/contracts/core';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { FrozenPanes } from '@mog-sdk/contracts/rendering';
import type { SheetMeta, UsedRange } from '@mog-sdk/contracts/store';

import type { DocumentContext } from '../../context/types';

// Domain reads (from kernel domain)
import * as SheetMetaDomain from '../../domain/sheets/sheet-meta';

// =============================================================================
// Type Re-exports
// =============================================================================

export type { FrozenPanes } from '@mog-sdk/contracts/rendering';
export type { SheetMeta, UsedRange } from '@mog-sdk/contracts/store';
export type { PrintSettings } from '@mog-sdk/contracts/core';
export type { PageBreakEntry, PageBreaks } from '../../domain/sheets/sheet-meta';

// =============================================================================
// Reads - Delegate to domain
// =============================================================================

/** Get first sheet ID. */
export async function getFirstId(ctx: IKernelContext): Promise<SheetId> {
  return SheetMetaDomain.getFirstId(ctx as DocumentContext);
}

/** Get sheet name. */
export async function getName(ctx: IKernelContext, sheetId: SheetId): Promise<string | undefined> {
  return SheetMetaDomain.getName(ctx as DocumentContext, sheetId);
}

/** Get sheet order. */
export async function getOrder(ctx: IKernelContext): Promise<SheetId[]> {
  return SheetMetaDomain.getOrder(ctx as DocumentContext);
}

/** Get sheet metadata. */
export async function getMeta(
  ctx: IKernelContext,
  sheetId: SheetId,
): Promise<SheetMeta | undefined> {
  return SheetMetaDomain.getMeta(ctx as DocumentContext, sheetId);
}

/** Get used range end point for Ctrl+End navigation (O(1)). */
export async function getUsedRangeEnd(
  ctx: IKernelContext,
  sheetId: SheetId,
): Promise<{ row: number; col: number }> {
  return SheetMetaDomain.getUsedRangeEnd(ctx as DocumentContext, sheetId);
}

/** Get full used range metadata. */
export async function getUsedRange(
  ctx: IKernelContext,
  sheetId: SheetId,
): Promise<UsedRange | null> {
  return SheetMetaDomain.getUsedRange(ctx as DocumentContext, sheetId);
}

/** Set used range (for file import or recomputation). */
export function setUsedRange(
  ctx: IKernelContext,
  sheetId: SheetId,
  usedRange: UsedRange | null,
): void {
  SheetMetaDomain.setUsedRange(ctx as DocumentContext, sheetId, usedRange);
}

// =============================================================================
// View Operations
// =============================================================================

/** Get frozen panes. */
export async function getFrozenPanes(ctx: IKernelContext, sheetId: SheetId): Promise<FrozenPanes> {
  return SheetMetaDomain.getFrozenPanes(ctx as DocumentContext, sheetId);
}

/** Set frozen panes. */
export function setFrozenPanes(
  ctx: IKernelContext,
  sheetId: SheetId,
  rows: number,
  cols: number,
  origin: string = 'user',
): void {
  SheetMetaDomain.setFrozenPanes(ctx as DocumentContext, sheetId, rows, cols, origin);
}

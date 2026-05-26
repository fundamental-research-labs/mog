/**
 * Grouping Query Functions
 *
 * Query functions for retrieving group information.
 * All queries delegate to ComputeBridge (Rust compute core).
 *
 * Stream O: Grouping/Outline Implementation
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { GroupDefinition } from '@mog-sdk/contracts/grouping';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Group Query Operations
// =============================================================================

/**
 * Get a specific group by ID.
 * Searches both row and column groups on the given sheet.
 *
 * Delegates to ComputeBridge.getGroups() and searches locally.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID to search
 * @param groupId - Group ID to find
 * @returns Promise of group definition or undefined if not found
 */
export async function getGroup(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
): Promise<GroupDefinition | undefined> {
  const [rowGroups, colGroups] = await Promise.all([
    ctx.computeBridge.getGroups(sheetId, 'row'),
    ctx.computeBridge.getGroups(sheetId, 'column'),
  ]);

  const allGroups = [...rowGroups, ...colGroups] as GroupDefinition[];
  return allGroups.find((g) => g.id === groupId);
}

/**
 * Get all groups for a sheet on a specific axis.
 *
 * Delegates to ComputeBridge.getGroups().
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param axis - Group axis ('row' or 'column')
 * @returns Promise of group definitions
 */
export async function getGroups(
  ctx: DocumentContext,
  sheetId: SheetId,
  axis: 'row' | 'column',
): Promise<GroupDefinition[]> {
  return ctx.computeBridge.getGroups(sheetId, axis) as Promise<GroupDefinition[]>;
}

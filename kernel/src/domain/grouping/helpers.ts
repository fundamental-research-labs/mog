/**
 * Grouping Helper Functions
 *
 * Shared helper functions for grouping operations including:
 * - ID generation
 * - Level calculations
 * - Group queries via ComputeBridge
 *
 * Stream O: Grouping/Outline Implementation
 *
 * Architecture Notes:
 * - Config and group data now owned by Rust compute core
 * - Queries delegate to ComputeBridge.getGroups()
 * - Pure computation helpers (calculateGroupLevel, findParentGroup) kept for
 *   use by modules that need local computation (outline-levels, rendering)
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { GroupDefinition, SheetGroupingConfig } from '@mog-sdk/contracts/grouping';
import { DEFAULT_SHEET_GROUPING_CONFIG } from '@mog-sdk/contracts/grouping';

import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';

import { MAX_OUTLINE_LEVEL } from './types';

// Re-export for convenience
export { MAX_OUTLINE_LEVEL };

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a unique group ID.
 */
export function generateGroupId(): string {
  return `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// =============================================================================
// Grouping Config Access (via ComputeBridge)
// =============================================================================

/**
 * Get the grouping configuration for a sheet.
 * Fetches group data from ComputeBridge and builds config with defaults.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @returns Promise of SheetGroupingConfig
 */
export async function getSheetGroupingConfig(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<SheetGroupingConfig> {
  const [rowGroups, columnGroups] = await Promise.all([
    ctx.computeBridge.getGroups(sheetId, 'row'),
    ctx.computeBridge.getGroups(sheetId, 'column'),
  ]);

  return {
    rowGroups: rowGroups as GroupDefinition[],
    columnGroups: columnGroups as GroupDefinition[],
    summaryRowsBelow: DEFAULT_SHEET_GROUPING_CONFIG.summaryRowsBelow,
    summaryColumnsRight: DEFAULT_SHEET_GROUPING_CONFIG.summaryColumnsRight,
    showOutlineSymbols: DEFAULT_SHEET_GROUPING_CONFIG.showOutlineSymbols,
    showOutlineLevelButtons: DEFAULT_SHEET_GROUPING_CONFIG.showOutlineLevelButtons,
  };
}

/**
 * Get the grouping configuration for a sheet (synchronous).
 * Returns defaults with empty groups. For actual group data, use the async version.
 *
 * This synchronous version exists for backwards compatibility with rendering
 * and outline-level modules that need sync access. It returns default config
 * settings; callers that need actual group lists should use getGroups() directly.
 *
 * @param sheetId - Sheet ID (unused, config is defaults)
 * @returns SheetGroupingConfig with defaults
 */
export function getSheetGroupingConfigSync(_sheetId: SheetId): SheetGroupingConfig {
  return { ...DEFAULT_SHEET_GROUPING_CONFIG };
}

// =============================================================================
// Group Level Calculations
// =============================================================================

/**
 * Calculate the outline level for a new group based on existing groups.
 * Groups are nested when they overlap with existing groups.
 */
export function calculateGroupLevel(
  existingGroups: GroupDefinition[],
  start: number,
  end: number,
): number {
  let maxOverlappingLevel = 0;

  for (const group of existingGroups) {
    // Check if ranges overlap
    const overlaps = !(end < group.start || start > group.end);
    if (overlaps && group.level > maxOverlappingLevel) {
      maxOverlappingLevel = group.level;
    }
  }

  // New group is one level deeper than the deepest overlapping group
  const newLevel = maxOverlappingLevel + 1;

  if (newLevel > MAX_OUTLINE_LEVEL) {
    throw new KernelError(
      'DOMAIN_GROUPING_MAX_LEVEL',
      `Cannot create group: maximum outline level (${MAX_OUTLINE_LEVEL}) exceeded`,
    );
  }

  return newLevel;
}

/**
 * Find the parent group ID for a new group.
 */
export function findParentGroup(
  existingGroups: GroupDefinition[],
  start: number,
  end: number,
  level: number,
): string | undefined {
  // Parent is the innermost group that fully contains this one at level - 1
  const potentialParents = existingGroups
    .filter((g) => g.level === level - 1 && g.start <= start && g.end >= end)
    .sort((a, b) => b.end - b.start - (a.end - a.start)); // Sort by size, smallest first

  return potentialParents[0]?.id;
}

// =============================================================================
// Group Query via ComputeBridge
// =============================================================================

/**
 * Get all groups for a sheet on a specific axis.
 * Delegates to ComputeBridge.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param axis - Group axis ('row' or 'column')
 * @returns Promise of group definitions
 */
export async function getGroupsAsync(
  ctx: DocumentContext,
  sheetId: SheetId,
  axis: 'row' | 'column',
): Promise<GroupDefinition[]> {
  return ctx.computeBridge.getGroups(sheetId, axis) as Promise<GroupDefinition[]>;
}

/**
 * Get a specific group by ID.
 * Searches all axes on the given sheet.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param groupId - Group ID to find
 * @returns Promise of group definition or undefined
 */
export async function getGroupAsync(
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
 * Resolve a group's range to position-based coordinates.
 * In the ComputeBridge architecture, groups returned from Rust already have
 * resolved start/end positions. This function extracts them.
 *
 * @param group - Group definition with start/end positions
 * @returns Resolved {start, end} positions
 */
export function resolveGroupRange(group: GroupDefinition): { start: number; end: number } {
  return { start: group.start, end: group.end };
}

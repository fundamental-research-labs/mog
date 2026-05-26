/**
 * Shared Grouping Helpers
 *
 * Internal helper functions shared across grouping modules.
 * These are implementation details, not part of the public API.
 *
 * In the ComputeBridge architecture, group data is owned by Rust.
 * This module provides pure computation helpers that operate on
 * GroupDefinition arrays returned from ComputeBridge.
 *
 * Stream O: Grouping/Outline Implementation
 *
 */

import type { GroupDefinition } from '@mog-sdk/contracts/grouping';
import { KernelError } from '../../errors';

// =============================================================================
// Constants
// =============================================================================

/** Maximum outline level (Excel compatibility) */
export const MAX_OUTLINE_LEVEL = 8;

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
// Group Level Calculation
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
// Resolve Group Range
// =============================================================================

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

// =============================================================================
// Affected Rows/Columns Computation
// =============================================================================

/**
 * Compute rows that would be affected by collapsing/expanding a group.
 * For row groups, returns rows that are hidden/shown (excludes summary row).
 *
 * Pure computation on a GroupDefinition — no CRDT or ComputeBridge needed.
 *
 * @param group - Group definition
 * @param summaryRowsBelow - Whether summary row is below the detail rows
 * @returns Array of row indices that would be affected
 */
export function computeAffectedRows(
  group: GroupDefinition,
  summaryRowsBelow: boolean = true,
): number[] {
  if (group.axis !== 'row') return [];

  const rows: number[] = [];
  for (let row = group.start; row <= group.end; row++) {
    const isSummaryRow = summaryRowsBelow ? row === group.end : row === group.start;
    if (!isSummaryRow) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Compute columns that would be affected by collapsing/expanding a group.
 * For column groups, returns columns that are hidden/shown (excludes summary column).
 *
 * Pure computation on a GroupDefinition — no CRDT or ComputeBridge needed.
 *
 * @param group - Group definition
 * @param summaryColumnsRight - Whether summary column is to the right
 * @returns Array of column indices that would be affected
 */
export function computeAffectedColumns(
  group: GroupDefinition,
  summaryColumnsRight: boolean = true,
): number[] {
  if (group.axis !== 'column') return [];

  const cols: number[] = [];
  for (let col = group.start; col <= group.end; col++) {
    const isSummaryCol = summaryColumnsRight ? col === group.end : col === group.start;
    if (!isSummaryCol) {
      cols.push(col);
    }
  }
  return cols;
}

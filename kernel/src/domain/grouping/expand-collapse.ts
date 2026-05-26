/**
 * Expand/Collapse Module
 *
 * Functions for expanding and collapsing row/column groups.
 * Handles individual group toggle, level-based collapse, and bulk operations.
 * All operations delegate to ComputeBridge (Rust compute core).
 *
 * Stream O: Grouping/Outline Implementation
 *
 * Architecture Notes:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 * - No manual event emission from domain modules
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Set Group Collapsed State
// =============================================================================

/**
 * Set the collapsed state of a specific group.
 *
 * Delegates to ComputeBridge toggleGroupCollapsed. Rust handles:
 * - Updating collapsed state
 * - Hiding/unhiding affected rows/columns
 * - Emitting GroupCollapsedEvent via MutationResult
 *
 * Note: This always toggles. If the caller needs to set a specific state,
 * it should check current state first via getGroups and only call if needed.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID the group belongs to
 * @param groupId - ID of the group to collapse/expand
 * @param collapsed - Whether to collapse (true) or expand (false)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function setGroupCollapsed(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
  collapsed: boolean,
  _origin: StructureChangeSource = 'user',
): void {
  // Fetch the current state and only toggle if needed
  void (async () => {
    const rowGroups = await ctx.computeBridge.getGroups(sheetId, 'row');
    const colGroups = await ctx.computeBridge.getGroups(sheetId, 'column');
    const allGroups = [...rowGroups, ...colGroups];
    const group = allGroups.find((g: any) => g.id === groupId);

    if (!group) return;
    if (group.collapsed === collapsed) return;

    void ctx.computeBridge.toggleGroupCollapsed(sheetId, groupId);
  })();
}

// =============================================================================
// Toggle Group Collapsed
// =============================================================================

/**
 * Toggle the collapsed state of a group.
 *
 * Delegates to ComputeBridge toggleGroupCollapsed.
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID the group belongs to
 * @param groupId - ID of the group to toggle
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function toggleGroupCollapsed(
  ctx: DocumentContext,
  sheetId: SheetId,
  groupId: string,
  _origin: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.toggleGroupCollapsed(sheetId, groupId);
}

// =============================================================================
// Level-Based Collapse
// =============================================================================

/**
 * Set collapsed state for all groups at a specific level.
 * Used when clicking level buttons (1, 2, 3...).
 *
 * Behavior:
 * - Clicking level N collapses all groups at level >= N
 * - This shows only the summary rows for those levels
 * - Expanding level N expands all groups at level >= N
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param axis - 'row' or 'column'
 * @param level - Outline level (1-8)
 * @param collapsed - Whether to collapse groups at this level
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function setLevelCollapsed(
  ctx: DocumentContext,
  sheetId: SheetId,
  axis: 'row' | 'column',
  level: number,
  collapsed: boolean,
  _origin: StructureChangeSource = 'user',
): void {
  void (async () => {
    const groups = await ctx.computeBridge.getGroups(sheetId, axis);
    const toToggle = groups.filter(
      (group) => group.level >= level && group.collapsed !== collapsed,
    );
    await Promise.all(
      toToggle.map((group) => ctx.computeBridge.toggleGroupCollapsed(sheetId, group.id)),
    );
  })();
}

// =============================================================================
// Bulk Expand/Collapse
// =============================================================================

/**
 * Expand all groups (show all detail).
 * Can expand both axes or just one.
 *
 * Delegates to ComputeBridge expandAllGroups.
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _axis - Optional axis to expand (ignored; CB expands all)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function expandAll(
  ctx: DocumentContext,
  sheetId: SheetId,
  _axis?: 'row' | 'column',
  _origin: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.expandAllGroups(sheetId);
}

/**
 * Collapse all groups (hide all detail).
 * Can collapse both axes or just one.
 *
 * Delegates to ComputeBridge collapseAllGroups.
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _axis - Optional axis to collapse (ignored; CB collapses all)
 * @param _origin - Source of the change (unused, handled by CB)
 */
export function collapseAll(
  ctx: DocumentContext,
  sheetId: SheetId,
  _axis?: 'row' | 'column',
  _origin: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.collapseAllGroups(sheetId);
}

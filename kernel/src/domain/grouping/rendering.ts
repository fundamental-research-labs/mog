/**
 * Grouping Rendering Module
 *
 * Provides outline symbol data for the canvas layers.
 * This module is called by the renderer on demand to get:
 * - +/- collapse/expand button positions
 * - Level button data (1, 2, 3...)
 * - Outline bar positions
 *
 * All group data fetched from ComputeBridge (Rust compute core).
 *
 * Architecture Note:
 * - This is NOT event-driven - it's called by renderer when it needs data
 * - Async query functions delegating to ComputeBridge
 * - Groups returned from Rust already have resolved start/end positions
 *
 * Stream O: Grouping/Outline Implementation
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md Section 6
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  GroupDefinition,
  OutlineLevel,
  SheetGroupingConfig,
} from '@mog-sdk/contracts/grouping';
import { DEFAULT_SHEET_GROUPING_CONFIG } from '@mog-sdk/contracts/grouping';

import type { DocumentContext } from '../../context/types';

import { resolveGroupRange } from './helpers';
import { getColumnOutlineLevels, getMaxOutlineLevel, getRowOutlineLevels } from './outline-levels';
import { getGroups } from './queries';
import { getAdjacentSummaryIndex } from './shared';

// =============================================================================
// Types
// =============================================================================

/**
 * Viewport definition for rendering queries.
 * Describes the visible area in row/column indices.
 */
export interface Viewport {
  /** First visible row index */
  startRow: number;
  /** Last visible row index */
  endRow: number;
  /** First visible column index */
  startCol: number;
  /** Last visible column index */
  endCol: number;
}

/**
 * An outline symbol (+/- button) to render.
 * Represents a collapse/expand control for a group.
 */
export interface OutlineSymbol {
  /** Unique identifier for this symbol (same as group ID) */
  id: string;
  /** Type of symbol */
  type: 'collapse-button';
  /** Axis the symbol controls */
  axis: 'row' | 'column';
  /** Row or column index where the button appears */
  index: number;
  /** Outline level (1-8) */
  level: number;
  /** Current collapsed state */
  collapsed: boolean;
  /** Group ID this symbol controls */
  groupId: string;
}

/**
 * A level button to render (1, 2, 3...).
 * Allows users to collapse/expand all groups at a level.
 */
export interface OutlineLevelButton {
  /** Level number (1-8, plus an extra button for "show all") */
  level: number;
  /** Axis this button controls */
  axis: 'row' | 'column';
}

/**
 * Complete outline render data for a sheet.
 * Contains all information needed by the canvas layer.
 */
export interface OutlineRenderData {
  /** Grouping configuration (settings like summaryRowsBelow) */
  config: SheetGroupingConfig;
  /** Row groups with resolved positions */
  rowGroups: GroupDefinition[];
  /** Column groups with resolved positions */
  columnGroups: GroupDefinition[];
  /** Maximum row outline level (0 if no groups) */
  maxRowLevel: number;
  /** Maximum column outline level (0 if no groups) */
  maxColLevel: number;
  /** Row outline levels for the viewport */
  rowOutlineLevels: OutlineLevel[];
  /** Column outline levels for the viewport */
  columnOutlineLevels: OutlineLevel[];
  /** Collapse/expand buttons to render */
  outlineSymbols: OutlineSymbol[];
  /** Level buttons to render */
  levelButtons: OutlineLevelButton[];
}

// =============================================================================
// Main Query Functions
// =============================================================================

/**
 * Get all outline symbols (collapse/expand buttons) for the viewport.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param viewport - Visible area to get symbols for
 * @returns Promise of outline symbols to render
 */
export async function getOutlineSymbols(
  ctx: DocumentContext,
  sheetId: SheetId,
  viewport: Viewport,
): Promise<OutlineSymbol[]> {
  const symbols: OutlineSymbol[] = [];
  const summaryRowsBelow = DEFAULT_SHEET_GROUPING_CONFIG.summaryRowsBelow;
  const summaryColumnsRight = DEFAULT_SHEET_GROUPING_CONFIG.summaryColumnsRight;

  // Get row group symbols
  const rowGroups = await getGroups(ctx, sheetId, 'row');
  for (const group of rowGroups) {
    const resolved = resolveGroupRange(group);

    // Button appears at adjacent summary row position
    const buttonIndex = getAdjacentSummaryIndex(resolved.start, resolved.end, summaryRowsBelow);
    if (buttonIndex === null) continue;

    // Only include if button is in viewport
    if (buttonIndex >= viewport.startRow && buttonIndex <= viewport.endRow) {
      symbols.push({
        id: group.id,
        type: 'collapse-button',
        axis: 'row',
        index: buttonIndex,
        level: group.level,
        collapsed: group.collapsed,
        groupId: group.id,
      });
    }
  }

  // Get column group symbols
  const columnGroups = await getGroups(ctx, sheetId, 'column');
  for (const group of columnGroups) {
    const resolved = resolveGroupRange(group);

    // Button appears at adjacent summary column position
    const buttonIndex = getAdjacentSummaryIndex(resolved.start, resolved.end, summaryColumnsRight);
    if (buttonIndex === null) continue;

    // Only include if button is in viewport
    if (buttonIndex >= viewport.startCol && buttonIndex <= viewport.endCol) {
      symbols.push({
        id: group.id,
        type: 'collapse-button',
        axis: 'column',
        index: buttonIndex,
        level: group.level,
        collapsed: group.collapsed,
        groupId: group.id,
      });
    }
  }

  return symbols;
}

/**
 * Get level buttons data for a sheet.
 * Returns buttons numbered 1 through maxLevel+1 (the +1 is for "show all").
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @returns Promise of level buttons to render
 */
export async function getOutlineLevelButtons(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<OutlineLevelButton[]> {
  const buttons: OutlineLevelButton[] = [];

  const maxRowLevel = await getMaxOutlineLevel(ctx, sheetId, 'row');
  const maxColLevel = await getMaxOutlineLevel(ctx, sheetId, 'column');

  // Row level buttons (1 through maxLevel+1)
  if (maxRowLevel > 0) {
    for (let level = 1; level <= maxRowLevel + 1; level++) {
      buttons.push({ level, axis: 'row' });
    }
  }

  // Column level buttons (1 through maxLevel+1)
  if (maxColLevel > 0) {
    for (let level = 1; level <= maxColLevel + 1; level++) {
      buttons.push({ level, axis: 'column' });
    }
  }

  return buttons;
}

/**
 * Get complete outline render data for a sheet viewport.
 * This is the main entry point for the canvas layer.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param viewport - Visible area
 * @returns Promise of complete outline render data
 */
export async function getOutlineRenderData(
  ctx: DocumentContext,
  sheetId: SheetId,
  viewport: Viewport,
): Promise<OutlineRenderData> {
  const [rowGroups, columnGroups, maxRowLevel, maxColLevel] = await Promise.all([
    getGroups(ctx, sheetId, 'row'),
    getGroups(ctx, sheetId, 'column'),
    getMaxOutlineLevel(ctx, sheetId, 'row'),
    getMaxOutlineLevel(ctx, sheetId, 'column'),
  ]);

  const config: SheetGroupingConfig = {
    rowGroups,
    columnGroups,
    summaryRowsBelow: DEFAULT_SHEET_GROUPING_CONFIG.summaryRowsBelow,
    summaryColumnsRight: DEFAULT_SHEET_GROUPING_CONFIG.summaryColumnsRight,
    showOutlineSymbols: DEFAULT_SHEET_GROUPING_CONFIG.showOutlineSymbols,
    showOutlineLevelButtons: DEFAULT_SHEET_GROUPING_CONFIG.showOutlineLevelButtons,
  };

  const [rowOutlineLevels, columnOutlineLevels, outlineSymbols, levelButtons] = await Promise.all([
    getRowOutlineLevels(ctx, sheetId, viewport.startRow, viewport.endRow),
    getColumnOutlineLevels(ctx, sheetId, viewport.startCol, viewport.endCol),
    getOutlineSymbols(ctx, sheetId, viewport),
    getOutlineLevelButtons(ctx, sheetId),
  ]);

  return {
    config,
    rowGroups,
    columnGroups,
    maxRowLevel,
    maxColLevel,
    rowOutlineLevels,
    columnOutlineLevels,
    outlineSymbols,
    levelButtons,
  };
}

/**
 * Check if outline symbols should be rendered for a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @returns Promise of true if outline symbols should be rendered
 */
export async function shouldRenderOutlines(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<boolean> {
  const showOutlineSymbols = DEFAULT_SHEET_GROUPING_CONFIG.showOutlineSymbols;
  if (!showOutlineSymbols) return false;

  const [maxRowLevel, maxColLevel] = await Promise.all([
    getMaxOutlineLevel(ctx, sheetId, 'row'),
    getMaxOutlineLevel(ctx, sheetId, 'column'),
  ]);

  return maxRowLevel > 0 || maxColLevel > 0;
}

/**
 * Get outline gutter dimensions for a sheet.
 * Used by layout calculations to reserve space for outline controls.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param levelWidth - Width of each outline level in pixels
 * @param levelHeight - Height of each outline level in pixels
 * @returns Promise of gutter dimensions
 */
export async function getOutlineGutterDimensions(
  ctx: DocumentContext,
  sheetId: SheetId,
  levelWidth: number = 16,
  levelHeight: number = 16,
): Promise<{ rowGutterWidth: number; colGutterHeight: number }> {
  const showOutlineSymbols = DEFAULT_SHEET_GROUPING_CONFIG.showOutlineSymbols;

  if (!showOutlineSymbols) {
    return { rowGutterWidth: 0, colGutterHeight: 0 };
  }

  const [maxRowLevel, maxColLevel] = await Promise.all([
    getMaxOutlineLevel(ctx, sheetId, 'row'),
    getMaxOutlineLevel(ctx, sheetId, 'column'),
  ]);

  return {
    rowGutterWidth: maxRowLevel > 0 ? maxRowLevel * levelWidth : 0,
    colGutterHeight: maxColLevel > 0 ? maxColLevel * levelHeight : 0,
  };
}

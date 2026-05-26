/**
 * Split View Action Handlers
 *
 * Pure handler functions for split view actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - Split configuration is stored in SheetMeta (Yjs, collaborative)
 * - Split scroll positions are stored in UIStore (session-local)
 * - Uses Actor Access pattern: deps.accessors.* for reads, deps.commands.* for writes
 *
 * This file handles:
 * - TOGGLE_SPLIT: Toggle split view at current selection
 * - SET_SPLIT_POSITION: Update split divider position (for drag)
 * - REMOVE_SPLIT: Remove split and return to single viewport
 * - FOCUS_NEXT_SPLIT_VIEWPORT: Cycle focus forward through split viewports
 * - FOCUS_PREV_SPLIT_VIEWPORT: Cycle focus backward through split viewports
 *
 * KEY ARCHITECTURE RULES:
 * 1. Freeze and Split are MUTUALLY EXCLUSIVE - enabling one removes the other
 * 2. Split config is collaborative (Yjs), scroll positions are session-local (UIStore)
 * 3. Handlers return handled() or notHandled(reason)
 *
 * Split View Implementation
 */

import type {
  ActionDependencies,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { SplitViewportConfig } from '@mog-sdk/contracts/viewport-config';
import { createSplitViewportConfig } from '@mog/spreadsheet-utils/viewport/viewport-config';

import type { StoreApi } from 'zustand';

import type { UIState } from '../../ui-store/types';
import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// UIStore Split State Interface
// =============================================================================

/**
 * Interface for the split view slice in UIStore.
 * This matches the expected structure from
 */
interface SplitViewSlice {
  /** Focused viewport ID per sheet */
  focusedViewportId: Record<string, string>;
  /** Set the focused viewport for a sheet */
  setFocusedViewport: (sheetId: string, viewportId: string) => void;
}

/**
 * Get the split view slice from UIStore.
 */
function getSplitViewSlice(uiStore: StoreApi<UIState>): SplitViewSlice | undefined {
  const state = uiStore.getState();
  // dependency: splitView slice will be added to UIStore
  if ('splitView' in state && typeof state.splitView === 'object') {
    return state.splitView as SplitViewSlice;
  }
  return undefined;
}

// =============================================================================
// Viewport Cycling Helpers
// =============================================================================

/**
 * Get viewport IDs based on split direction.
 */
function getViewportIds(config: SplitViewportConfig): string[] {
  switch (config.direction) {
    case 'horizontal':
      return ['top', 'bottom'];
    case 'vertical':
      return ['left', 'right'];
    case 'both':
      return ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
    default:
      return ['main'];
  }
}

/**
 * Cycle to the next viewport in the list.
 */
function getNextViewportId(viewportIds: string[], currentId: string): string {
  const currentIndex = viewportIds.indexOf(currentId);
  if (currentIndex === -1) {
    return viewportIds[0];
  }
  return viewportIds[(currentIndex + 1) % viewportIds.length];
}

/**
 * Cycle to the previous viewport in the list.
 */
function getPrevViewportId(viewportIds: string[], currentId: string): string {
  const currentIndex = viewportIds.indexOf(currentId);
  if (currentIndex === -1) {
    return viewportIds[viewportIds.length - 1];
  }
  return viewportIds[(currentIndex - 1 + viewportIds.length) % viewportIds.length];
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * TOGGLE_SPLIT
 *
 * Toggle split view at the current selection.
 * - If split is active: removes split
 * - If split is not active: creates split at active cell position
 *
 * IMPORTANT: When enabling split, removes any existing freeze config first
 * (freeze and split are mutually exclusive, matching Excel behavior).
 *
 * Uses Worksheet API for split config and freeze panes.
 *
 * @param deps - Action dependencies
 */
export const TOGGLE_SPLIT: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(sheetId);
  const currentSplitConfig = await ws.view.getSplitConfig();

  if (currentSplitConfig) {
    // Remove split
    await ws.view.setSplitConfig(null);
  } else {
    // Create split at active cell position
    // First, remove freeze panes if active (mutual exclusivity)
    const frozenPanes = await ws.view.getFrozenPanes();
    if (frozenPanes.rows > 0 || frozenPanes.cols > 0) {
      await ws.view.unfreeze();
    }

    // Create split config at active cell
    // Default to 'both' direction if cell is not at row 0 or col 0
    // Otherwise, use appropriate direction
    let direction: 'horizontal' | 'vertical' | 'both';
    if (activeCell.row === 0 && activeCell.col > 0) {
      direction = 'vertical';
    } else if (activeCell.col === 0 && activeCell.row > 0) {
      direction = 'horizontal';
    } else if (activeCell.row > 0 && activeCell.col > 0) {
      direction = 'both';
    } else {
      // At A1, default to both with positions at row 1 and col 1
      direction = 'both';
    }

    const newConfig = createSplitViewportConfig(
      direction,
      activeCell.row > 0 ? activeCell.row : 1,
      activeCell.col > 0 ? activeCell.col : 1,
    );

    await ws.view.setSplitConfig(newConfig);
  }

  return handled();
};

/**
 * SET_SPLIT_POSITION
 *
 * Update split divider position.
 * Used during drag operations to adjust the split position.
 *
 * @param deps - Action dependencies
 * @param payload - New position: { horizontalPosition?, verticalPosition? }
 */
export const SET_SPLIT_POSITION: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { horizontalPosition?: number; verticalPosition?: number },
): Promise<ActionResult> => {
  if (!payload) {
    return notHandled('disabled');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const currentConfig = await ws.view.getSplitConfig();

  if (!currentConfig) {
    return notHandled('disabled');
  }

  // Update the config with new positions
  const newConfig = createSplitViewportConfig(
    currentConfig.direction,
    payload.horizontalPosition ?? currentConfig.horizontalPosition,
    payload.verticalPosition ?? currentConfig.verticalPosition,
  );

  await ws.view.setSplitConfig(newConfig);

  return handled();
};

/**
 * REMOVE_SPLIT
 *
 * Explicitly remove split view and return to single viewport.
 * Functionally equivalent to TOGGLE_SPLIT when split is active,
 * but more explicit for programmatic use.
 *
 * @param deps - Action dependencies
 */
export const REMOVE_SPLIT: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const currentConfig = await ws.view.getSplitConfig();

  if (!currentConfig) {
    // No split to remove
    return notHandled('disabled');
  }

  await ws.view.setSplitConfig(null);

  return handled();
};

/**
 * FOCUS_NEXT_SPLIT_VIEWPORT
 *
 * Move focus to the next viewport in the split cycle.
 * Viewport order depends on split direction:
 * - horizontal: top -> bottom -> top
 * - vertical: left -> right -> left
 * - both: topLeft -> topRight -> bottomLeft -> bottomRight -> topLeft
 *
 * Used for F6 keyboard navigation.
 *
 * @param deps - Action dependencies
 */
export const FOCUS_NEXT_SPLIT_VIEWPORT: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const uiStore = getUIStore(deps);
  const ws = deps.workbook.getSheetById(sheetId);
  const splitConfig = await ws.view.getSplitConfig();

  if (!splitConfig) {
    // No split active, nothing to cycle
    return notHandled('disabled');
  }

  const splitSlice = getSplitViewSlice(uiStore);
  if (!splitSlice) {
    // UIStore split slice not yet implemented
    return notHandled('not_implemented');
  }

  const viewportIds = getViewportIds(splitConfig);
  const currentViewportId = splitSlice.focusedViewportId[sheetId] ?? viewportIds[0];
  const nextViewportId = getNextViewportId(viewportIds, currentViewportId);

  splitSlice.setFocusedViewport(sheetId, nextViewportId);

  return handled();
};

/**
 * FOCUS_PREV_SPLIT_VIEWPORT
 *
 * Move focus to the previous viewport in the split cycle.
 * Viewport order depends on split direction (cycles backward).
 *
 * Used for Shift+F6 keyboard navigation.
 *
 * @param deps - Action dependencies
 */
export const FOCUS_PREV_SPLIT_VIEWPORT: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const uiStore = getUIStore(deps);
  const ws = deps.workbook.getSheetById(sheetId);
  const splitConfig = await ws.view.getSplitConfig();

  if (!splitConfig) {
    // No split active, nothing to cycle
    return notHandled('disabled');
  }

  const splitSlice = getSplitViewSlice(uiStore);
  if (!splitSlice) {
    // UIStore split slice not yet implemented
    return notHandled('not_implemented');
  }

  const viewportIds = getViewportIds(splitConfig);
  const currentViewportId = splitSlice.focusedViewportId[sheetId] ?? viewportIds[0];
  const prevViewportId = getPrevViewportId(viewportIds, currentViewportId);

  splitSlice.setFocusedViewport(sheetId, prevViewportId);

  return handled();
};

// =============================================================================
// Freeze Panes Handlers
// =============================================================================

/**
 * FREEZE_PANES
 *
 * Freeze rows/columns at the current selection position.
 * Creates freeze panes so the frozen area stays visible while scrolling.
 *
 * IMPORTANT: Freeze and split are mutually exclusive - enabling freeze
 * removes any existing split configuration (matching Excel behavior).
 *
 * @param deps - Action dependencies
 */
export const FREEZE_PANES: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(sheetId);

  // First, remove split if active (mutual exclusivity)
  const currentSplitConfig = await ws.view.getSplitConfig();
  if (currentSplitConfig) {
    await ws.view.setSplitConfig(null);
  }

  // Set freeze panes at the active cell position via Worksheet API
  // Freeze rows above the active cell and columns to the left
  await ws.view.freezePanes(activeCell.row, activeCell.col);

  return handled();
};

/**
 * FREEZE_TOP_ROW
 *
 * Freeze only the first row, clearing any existing column freeze.
 */
export const FREEZE_TOP_ROW: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const currentSplitConfig = await ws.view.getSplitConfig();
  if (currentSplitConfig) {
    await ws.view.setSplitConfig(null);
  }

  await ws.view.freezePanes(1, 0);

  return handled();
};

/**
 * FREEZE_FIRST_COLUMN
 *
 * Freeze only the first column, clearing any existing row freeze.
 */
export const FREEZE_FIRST_COLUMN: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const currentSplitConfig = await ws.view.getSplitConfig();
  if (currentSplitConfig) {
    await ws.view.setSplitConfig(null);
  }

  await ws.view.freezePanes(0, 1);

  return handled();
};

/**
 * UNFREEZE_PANES
 *
 * Remove freeze panes, returning to normal scrolling behavior.
 *
 * @param deps - Action dependencies
 */
export const UNFREEZE_PANES: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();

  // Clear freeze panes via Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  await ws.view.unfreeze();

  // Scroll viewport to show the active cell. Without this, the viewport
  // retains the unfrozen sub-pane's scroll offset — stranding the user at
  // an empty region far from their data. Excel resets to active cell.
  const activeCell = deps.accessors.selection.getActiveCell();
  if (activeCell && deps.commands.renderer) {
    deps.commands.renderer.scrollToActiveCell(activeCell);
  }

  return handled();
};

// =============================================================================
// Split View Convenience Handlers
// =============================================================================

/**
 * SPLIT_VIEW
 *
 * Enable split view at the current selection position.
 * This is a convenience handler that directly enables split (vs toggle).
 *
 * Uses Worksheet API for split config and freeze panes.
 *
 * @param deps - Action dependencies
 */
export const SPLIT_VIEW: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  // First, remove freeze panes if active (mutual exclusivity)
  const ws = deps.workbook.getSheetById(sheetId);
  const frozenPanes = await ws.view.getFrozenPanes();
  if (frozenPanes.rows > 0 || frozenPanes.cols > 0) {
    await ws.view.unfreeze();
  }

  // Determine split direction based on active cell position
  let direction: 'horizontal' | 'vertical' | 'both';
  if (activeCell.row === 0 && activeCell.col > 0) {
    direction = 'vertical';
  } else if (activeCell.col === 0 && activeCell.row > 0) {
    direction = 'horizontal';
  } else if (activeCell.row > 0 && activeCell.col > 0) {
    direction = 'both';
  } else {
    // At A1, default to both with positions at row 1 and col 1
    direction = 'both';
  }

  const newConfig = createSplitViewportConfig(
    direction,
    activeCell.row > 0 ? activeCell.row : 1,
    activeCell.col > 0 ? activeCell.col : 1,
  );

  await ws.view.setSplitConfig(newConfig);

  return handled();
};

/**
 * UNSPLIT_VIEW
 *
 * Remove split view, returning to single viewport.
 * This is a convenience handler that directly removes split (vs toggle).
 *
 * @param deps - Action dependencies
 */
export const UNSPLIT_VIEW: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Remove split configuration
  await ws.view.setSplitConfig(null);

  return handled();
};

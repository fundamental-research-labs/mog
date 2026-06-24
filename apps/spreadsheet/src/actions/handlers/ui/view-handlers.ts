/**
 * View Handlers
 *
 * Handlers for view toggle, zoom, and ribbon mode actions.
 *
 * This file contains:
 * - Formula view toggles (TOGGLE_FORMULA_VIEW, TOGGLE_FORMULA_BAR_EXPAND)
 * - Auto filter toggle (TOGGLE_AUTO_FILTER)
 * - Ribbon display modes (TOGGLE_RIBBON, SET_RIBBON_DISPLAY_MODE, etc.)
 * - Ribbon keytips (ACTIVATE_RIBBON_KEYTIPS, DEACTIVATE_RIBBON_KEYTIPS)
 * - Zoom operations (ZOOM_IN, ZOOM_OUT, SET_ZOOM)
 * - Full screen (FULL_SCREEN)
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

// G5: Zoom utilities
import {
  clampZoom,
  zoomIn,
  zoomLevelToScale,
  zoomOut,
  zoomScaleToLevel,
} from '../../../infra/utils/zoom-utils';
import { DEFAULT_ZOOM } from '@mog-sdk/contracts/rendering';
import { resolveDataCommandTarget } from '../../data-command-target';
import { getUIStore, handled, notHandled } from '../handler-utils';
import { useExtensionStore } from '../../../infra/state/extension-store';

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Get selection context (active cell and ranges) using the Actor Access Layer.
 *
 * MIGRATION: Uses deps.accessors.selection instead of direct actor access.
 */
function getSelectionContext(deps: ActionDependencies): {
  activeCell: { row: number; col: number } | null;
  ranges: CellRange[];
} {
  if (!deps.accessors?.selection) {
    return { activeCell: null, ranges: [] };
  }
  return {
    activeCell: deps.accessors.selection.getActiveCell() ?? null,
    ranges: deps.accessors.selection.getRanges() ?? [],
  };
}

// =============================================================================
// View Toggle Actions
// =============================================================================

/**
 * Toggle formula view mode.
 *
 * When enabled, cells display their formulas instead of calculated values.
 *
 * Persists as a per-sheet worksheet view option.
 */
export const TOGGLE_FORMULA_VIEW: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const showFormulas = deps.workbook.mirror.getViewOptions(sheetId).showFormulas;
  await ws.view.setShowFormulas(!showFormulas);
  return handled();
};

/**
 * Ctrl+Shift+U - Toggle formula bar expand/collapse.
 * Ctrl+Shift+U Formula Bar Expand/Collapse
 *
 * When expanded, formula bar shows multiple lines for long formulas.
 */
export const TOGGLE_FORMULA_BAR_EXPAND: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().toggleFormulaBarExpand();
  return handled();
};

/**
 * Ctrl+Shift+L - Toggle AutoFilter on current selection.
 *
 *
 * Behavior:
 * - If no AutoFilter exists overlapping the selection, create one
 * - If AutoFilter exists on the selection's header row, remove it
 * - Single cell/row selections auto-expand to the contiguous data region (Excel parity)
 *
 * Uses Cell Identity Model: createFilter accepts CellRange (position-based)
 * but internally stores CellId references for CRDT safety.
 *
 */
export const TOGGLE_AUTO_FILTER: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  // Need at least one range to create a filter
  if (ranges.length === 0) {
    return notHandled('disabled');
  }

  const userRange = ranges[0];

  // Check if an AutoFilter already exists for this range (for toggle off)
  const existingFilter = await ws.filters.getForRange(userRange);

  if (existingFilter) {
    // Filter exists - remove it
    await ws.filters.remove(existingFilter.id);
    return handled();
  }

  // No existing filter - resolve the Data-tab tabular command target and create.
  const target = await resolveDataCommandTarget(ws, userRange);

  if (!target) {
    // No data region found (empty cell selected)
    return notHandled('disabled');
  }

  await ws.filters.setAutoFilter(target.range);
  return handled();
};

// =============================================================================
// Ribbon Display Modes
// =============================================================================

/**
 * Ctrl+Shift+F1 - Toggle ribbon visibility.
 * Excel-compatible ribbon visibility toggle.
 */
export const TOGGLE_RIBBON: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().toggleRibbon();
  return handled();
};

/**
 * Set ribbon display mode.
 * Modes: 'full' | 'tabs-only' | 'auto-hide'
 */
export const SET_RIBBON_DISPLAY_MODE: ActionHandler = (
  deps,
  payload?: { mode: 'full' | 'tabs-only' | 'auto-hide' },
): ActionResult => {
  if (!payload?.mode) return notHandled('disabled');
  getUIStore(deps).getState().setDisplayMode(payload.mode);
  return handled();
};

/**
 * Ctrl+F1 - Toggle between full and tabs-only mode.
 * Does not affect auto-hide mode.
 */
export const TOGGLE_RIBBON_TABS_MODE: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().toggleTabsMode();
  return handled();
};

/**
 * Show ribbon temporarily in tabs-only or auto-hide mode.
 * Called when user clicks a tab or hovers over auto-hide trigger.
 */
export const SHOW_RIBBON_TEMPORARILY: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().showTemporarily();
  return handled();
};

/**
 * Hide temporarily shown ribbon.
 * Called when user clicks outside ribbon or moves mouse away.
 */
export const HIDE_RIBBON_TEMPORARILY: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().hideTemporarily();
  return handled();
};

/**
 * Activate KeyTips mode (F10)
 *
 * F10 activates ribbon keytips for keyboard navigation.
 * When active, pressing letter keys navigates to buttons/tabs with matching keytip.
 */
export const ACTIVATE_RIBBON_KEYTIPS: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().activateKeyTips();
  return handled();
};

/**
 * Deactivate KeyTips mode (Escape or action completion)
 *
 * Escape or completing an action exits keytip mode.
 */
export const DEACTIVATE_RIBBON_KEYTIPS: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().deactivateKeyTips();
  return handled();
};

// =============================================================================
// Zoom Actions (G5: Zoom Slider)
// =============================================================================

function getCurrentZoomLevel(deps: ActionDependencies, sheetId: SheetId): number {
  const uiStore = getUIStore(deps);
  const uiZoom = uiStore.getState().zoomLevels[sheetId];
  if (typeof uiZoom === 'number') {
    return uiZoom;
  }

  const persistedZoom = zoomScaleToLevel(deps.workbook.mirror.getViewOptions(sheetId).zoomScale);
  return persistedZoom ?? DEFAULT_ZOOM;
}

async function applyZoomLevel(
  deps: ActionDependencies,
  sheetId: SheetId,
  level: number,
): Promise<ActionResult> {
  const clampedZoom = clampZoom(level);
  await deps.workbook
    .getSheetById(sheetId)
    .settings.set('zoomScale', zoomLevelToScale(clampedZoom));
  getUIStore(deps).getState().setZoomLevel(sheetId, clampedZoom);
  return handled();
}

/**
 * Zoom In - increase zoom level by one step.
 *
 * G5: Excel parity - Zoom controls in status bar.
 */
export const ZOOM_IN: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const currentZoom = getCurrentZoomLevel(deps, sheetId);
  const newZoom = zoomIn(currentZoom);
  return applyZoomLevel(deps, sheetId, newZoom);
};

/**
 * Zoom Out - decrease zoom level by one step.
 *
 * G5: Excel parity - Zoom controls in status bar.
 */
export const ZOOM_OUT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const currentZoom = getCurrentZoomLevel(deps, sheetId);
  const newZoom = zoomOut(currentZoom);
  return applyZoomLevel(deps, sheetId, newZoom);
};

/**
 * Zoom Reset - reset zoom level to 100% (DEFAULT_ZOOM).
 *
 * Keyboard shortcut: Ctrl+0
 */
export const ZOOM_RESET: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  return applyZoomLevel(deps, sheetId, DEFAULT_ZOOM);
};

/**
 * Set Zoom - set zoom level to specific value.
 *
 * G5: Excel parity - Used by zoom slider for continuous adjustment.
 *
 * @param deps - Action dependencies
 * @param payload - { sheetId: SheetId, level: number }
 */
export const SET_ZOOM: AsyncActionHandler = async (
  deps,
  payload?: { sheetId: SheetId; level: number },
): Promise<ActionResult> => {
  if (!payload?.sheetId || typeof payload?.level !== 'number') {
    return notHandled('disabled');
  }

  return applyZoomLevel(deps, payload.sheetId, payload.level);
};

// =============================================================================
// Full Screen Action
// =============================================================================

/**
 * Toggle full screen mode.
 *
 * Toggles the browser into full screen mode for maximum spreadsheet viewing area.
 *
 * calls the browser API directly. `requestFullscreen` /
 * `exitFullscreen()` are DOM operations, not platform-mediated I/O — the
 * `IPlatform` boundary is for OS bridging (dialogs, fs, notifications), and
 * fullscreen lives in `document` regardless of host (Tauri or web).
 */
export const FULL_SCREEN: ActionHandler = (): ActionResult => {
  if (typeof document === 'undefined') {
    return notHandled('disabled');
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen();
  }
  return handled();
};

// =============================================================================
// Scroll Lock Action
// =============================================================================

/**
 * Toggle Scroll Lock mode.
 *
 * When enabled, arrow keys scroll the viewport instead of moving selection.
 * Triggered by ScrollLock key or Ctrl+Alt+L.
 */
export const TOGGLE_SCROLL_LOCK: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().toggleScrollLock();
  return handled();
};

// =============================================================================
// Extension Panel Action
// =============================================================================

/**
 * Toggle Extension Panel visibility.
 *
 * Ctrl+Shift+E toggles the side extension panel.
 * Uses the extension store directly (not UIStore).
 */
/**
 * Toggle NL Formula Bar visibility.
 *
 * Ctrl+Shift+I toggles the AI natural-language formula bar.
 */
export const TOGGLE_NL_BAR: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().toggleNLBar();
  return handled();
};

export const TOGGLE_EXTENSION_PANEL: ActionHandler = (): ActionResult => {
  useExtensionStore.getState().togglePanel();
  return handled();
};

/**
 * Chart Action Handlers
 *
 * Pure handler functions for chart operations.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - Chart actions send events to the ChartActor or mutate via the
 * workbook charts API.
 * - The seven format-dialog handlers (OPEN_MOVE_CHART_DIALOG,
 * OPEN_FORMAT_CHART_AREA, OPEN_FORMAT_PLOT_AREA, OPEN_FORMAT_DATA_SERIES,
 * OPEN_FORMAT_AXIS, OPEN_FORMAT_LEGEND, OPEN_FORMAT_CHART_TITLE) stay on
 * the legacy UI-callback shim until 04 ships their dialog
 * components. Adding UIStore state without a subscriber dialog is the
 * dead-handler anti-pattern that 01 is killing.
 *
 * This file handles:
 * - Edit chart (opens chart editor)
 * - Edit chart title (F2 inline editing)
 * - Change chart type
 * - Duplicate chart
 * - Save chart as image
 * - Delete chart
 *
 * Charts
 */

import { DEFAULT_CHART_COLORS, type ChartConfig, type SerializedChart } from '@mog/charts';
import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';
import { type SheetId, sheetId } from '@mog-sdk/contracts/core';

import { pasteChartFromClipboard } from './chart-clipboard';
import { deselectChartObjects, selectChartObject } from './chart-selection';
import { resolveChartCreationSourceRange, resolveChartSourceRange } from './chart-source-range';
import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Smart Chart Positioning
// =============================================================================

/**
 * Chart position in cell coordinates.
 */
interface ChartPosition {
  anchorRow: number;
  anchorCol: number;
}

type ChartSourceRange = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

type ChartSeriesConfig = NonNullable<ChartConfig['series']>[number];
type CellValueReader = {
  getValue?: (row: number, col: number) => unknown | Promise<unknown>;
};

/**
 * Type guard to check if coordinator exposes renderer capabilities.
 */
function hasRendererCapabilities(coordinator: unknown): coordinator is {
  renderer: {
    getGeometry: () => ISheetViewGeometry | null;
    getViewport: () => ISheetViewViewport | null;
  };
} {
  return (
    coordinator !== null &&
    coordinator !== undefined &&
    typeof coordinator === 'object' &&
    'renderer' in coordinator &&
    coordinator.renderer !== null &&
    typeof coordinator.renderer === 'object' &&
    'getGeometry' in coordinator.renderer! &&
    typeof (coordinator.renderer as any).getGeometry === 'function' &&
    'getViewport' in coordinator.renderer! &&
    typeof (coordinator.renderer as any).getViewport === 'function'
  );
}

function getChartIdFromPayloadOrSelectedObject(
  deps: ActionDependencies,
  payload: { chartId?: string } | undefined,
): string | null {
  return payload?.chartId ?? deps.accessors.object.getFirstSelectedId();
}

function isMultiCellRange(range: ChartSourceRange): boolean {
  return range.startRow !== range.endRow || range.startCol !== range.endCol;
}

function getChartSourceRanges(deps: ActionDependencies, sheetId: SheetId): ChartSourceRange[] {
  const editStartRanges = deps.accessors.editor.getEditStartSelectionRanges?.();
  if (editStartRanges?.some(isMultiCellRange)) {
    return editStartRanges;
  }

  return deps.accessors.selection.getDataBoundedRanges(sheetId);
}

function isBlankCellValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function isNumericCellValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

async function readChartSourceValue(
  worksheet: unknown,
  row: number,
  col: number,
): Promise<unknown> {
  const getValue = (worksheet as CellValueReader | null)?.getValue;
  if (typeof getValue !== 'function') return null;
  try {
    return await getValue.call(worksheet, row, col);
  } catch {
    return null;
  }
}

async function inferFirstColumnLabelSeries(
  worksheet: unknown,
  range: ChartSourceRange,
): Promise<ChartSeriesConfig[] | undefined> {
  if (range.startRow === range.endRow || range.startCol === range.endCol) return undefined;

  let firstColumnLabels = 0;
  let firstColumnNumeric = 0;
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    const value = await readChartSourceValue(worksheet, row, range.startCol);
    if (isBlankCellValue(value)) continue;
    if (isNumericCellValue(value)) {
      firstColumnNumeric += 1;
    } else {
      firstColumnLabels += 1;
    }
  }

  let firstRowValueCount = 0;
  let firstRowLabelCount = 0;
  for (let col = range.startCol + 1; col <= range.endCol; col += 1) {
    const value = await readChartSourceValue(worksheet, range.startRow, col);
    if (isBlankCellValue(value)) continue;
    if (isNumericCellValue(value)) {
      firstRowValueCount += 1;
    } else {
      firstRowLabelCount += 1;
    }
  }

  if (firstColumnLabels < 2 || firstColumnNumeric > 0) return undefined;
  if (firstRowValueCount === 0 || firstRowLabelCount > 0) return undefined;

  const categories = rangeToA1Notation({
    startRow: range.startRow,
    startCol: range.startCol,
    endRow: range.endRow,
    endCol: range.startCol,
  });
  const series: ChartSeriesConfig[] = [];

  for (let col = range.startCol + 1; col <= range.endCol; col += 1) {
    let hasNumericValues = false;
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      const value = await readChartSourceValue(worksheet, row, col);
      if (isNumericCellValue(value)) {
        hasNumericValues = true;
        break;
      }
    }
    if (!hasNumericValues) continue;

    series.push({
      values: rangeToA1Notation({
        startRow: range.startRow,
        startCol: col,
        endRow: range.endRow,
        endCol: col,
      }),
      categories,
    });
  }

  return series.length > 0 ? series : undefined;
}

/**
 * Get smart chart position that ensures visibility.
 *
 * Uses the shared smart positioning utility with chart-specific preset:
 * - Position directly below source selection (endRow + 2, startCol)
 * - Fallback to viewport-relative positioning if off-screen
 *
 * @see engine/src/state/coordinator/utils/smart-positioning.ts
 */
async function getSmartChartPosition(
  deps: ActionDependencies,
  sourceRange: ChartSourceRange | null,
  defaultPosition: ChartPosition,
  _sheetId: SheetId,
): Promise<ChartPosition> {
  // Get geometry and viewport capabilities from coordinator
  let geometry: ISheetViewGeometry | null = null;
  let viewport: ISheetViewViewport | null = null;
  if (hasRendererCapabilities(deps.coordinator)) {
    geometry = deps.coordinator.renderer.getGeometry();
    viewport = deps.coordinator.renderer.getViewport();
  }

  const { CHART_POSITION_PRESET, getSmartPosition } =
    await import('../../systems/objects/utils/smart-positioning');
  return getSmartPosition({
    sourceRange,
    geometry,
    viewport,
    defaultPosition,
    ...CHART_POSITION_PRESET,
  });
}

// =============================================================================
// Chart Editing Actions
// =============================================================================

/**
 * EDIT_CHART - Open the chart editor dialog.
 * Payload: { chartId: string }
 *
 * This is triggered by double-click on chart or Enter key when chart is selected.
 */
export const EDIT_CHART: ActionHandler = (deps, payload): ActionResult => {
  // Payload may be absent when triggered by keyboard shortcut (Enter in objectSelected context).
  // Use the object accessor because chart selection is synced asynchronously from object selection.
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  selectChartObject(deps, chartId);
  deps.commands.chart.startEdit();

  return handled();
};

/**
 * EDIT_CHART_TITLE - Start inline editing of chart title.
 * Payload: { chartId: string }
 *
 * This is triggered by F2 key when chart is selected.
 */
export const EDIT_CHART_TITLE: ActionHandler = (deps, payload): ActionResult => {
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  // Start title edit with empty string as original value (will be populated by the UI)
  selectChartObject(deps, chartId);
  deps.commands.chart.startTitleEdit('');

  return handled();
};

/**
 * CHANGE_CHART_TYPE - Change the type of a chart.
 * Payload: { chartId: string, chartType: ChartType, subType?: string }
 *
 * This is triggered from the context menu submenu.
 * Uses Mutations layer for chart type change.
 */
export const CHANGE_CHART_TYPE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  const chartType = payload?.chartType;
  const subType = payload?.subType;

  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }
  if (!chartType) {
    return { handled: false, error: 'Missing chartType in payload' };
  }

  const ws = deps.workbook.activeSheet;

  try {
    await ws.charts.update(chartId, { type: chartType, subType });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

// =============================================================================
// Chart Clipboard/Duplication Actions
// =============================================================================

/**
 * DUPLICATE_CHART - Create a copy of the chart with offset position.
 * Payload: { chartId: string }
 *
 * This is triggered from the context menu.
 * Uses the worksheet chart API so duplicate semantics stay centralized.
 */
export const DUPLICATE_CHART: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    const newChart = await ws.charts.duplicate(chartId);

    if (newChart.chart.id) {
      selectChartObject(deps, newChart.chart.id);
    }
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * DELETE_CHART - Delete the selected chart.
 * Payload: { chartId: string }
 *
 * This is triggered by Delete key when chart is selected or from context menu.
 * Uses Mutations layer for chart deletion.
 */
export const DELETE_CHART: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const ws = deps.workbook.activeSheet;

  try {
    await ws.charts.remove(chartId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  deselectChartObjects(deps);

  return handled();
};

// =============================================================================
// Chart Export Actions
// =============================================================================

/**
 * SAVE_CHART_AS_IMAGE - Export the chart as an image file.
 * Payload: { chartId: string, format?: 'png' | 'jpeg' | 'svg' }
 *
 * This is triggered from the context menu submenu.
 *
 * routes through `platform.dialogs.showSaveDialog`
 * + `handle.write(bytes)` after rendering via `ws.charts.exportImage`.
 * Replaces the unwired `onUIAction` JSON-string protocol.
 *
 * Rendering pipeline:
 * 1. `ws.charts.exportImage(chartId, { format })` returns a data-URL.
 * 2. The data-URL is decoded to Uint8Array (`base64 → bytes`).
 * 3. `dialogs.showSaveDialog(...)` returns a `PlatformFileHandle`.
 * 4. `handle.write(bytes)` persists the image (FSA / Tauri / anchor download).
 */
export const SAVE_CHART_AS_IMAGE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  const format: 'png' | 'jpeg' | 'svg' = payload?.format || 'png';

  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  if (!deps.platform?.dialogs) {
    return notHandled('disabled');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // 1. Render chart at default export dimensions; engine returns a data URL.
  let dataUrl: string;
  try {
    dataUrl = await ws.charts.exportImage(chartId, { format });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }
  if (!dataUrl) {
    return { handled: false, error: `Failed to render chart ${chartId}` };
  }

  // 2. Decode `data:image/<fmt>;base64,<...>` → Uint8Array.
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) {
    return { handled: false, error: 'Chart exporter returned malformed data URL' };
  }
  const base64 = dataUrl.slice(commaIdx + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  // 3. Prompt for destination. Default name: chart-<chartId>.<ext>.
  const ext = format === 'jpeg' ? 'jpg' : format;
  const handle = await deps.platform.dialogs.showSaveDialog({
    title: 'Save Chart as Image',
    defaultPath: `chart-${chartId}.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });
  if (!handle) {
    // User cancelled.
    return notHandled('disabled');
  }

  // 4. Persist bytes through the platform handle.
  try {
    await handle.write(bytes);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

// =============================================================================
// Select Data Dialog Actions
// =============================================================================

/**
 * OPEN_SELECT_DATA_DIALOG - Open the Select Data dialog for a chart.
 * Payload: { chartId: string }
 *
 * This allows editing chart data range, series, and options.
 */
export const OPEN_SELECT_DATA_DIALOG: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const uiStore = getUIStore(deps);
  const activeSheetId = uiStore.getState().activeSheetId;
  const ws = deps.workbook.getSheetById(activeSheetId);

  // Get chart via unified Worksheet API
  const chart = await ws.charts.get(chartId);
  if (!chart) {
    return { handled: false, error: `Chart ${chartId} not found` };
  }

  // Convert chart config to dialog state
  // For now, we'll use simple defaults - full implementation would parse series from config
  const series: Array<{ id: string; name: string; range: string; categoryRange?: string }> = [];

  // Extract series from chart config (simplified - would need proper parsing)
  if (chart.series && Array.isArray(chart.series)) {
    chart.series.forEach((s: any, index: number) => {
      series.push({
        id: `series-${index}`,
        name: s.name || `Series ${index + 1}`,
        range: chart.dataRange || '',
        categoryRange: chart.categoryRange,
      });
    });
  } else if (chart.dataRange) {
    // Default: single series from data range
    series.push({
      id: 'series-0',
      name: 'Series 1',
      range: chart.dataRange,
      categoryRange: chart.categoryRange,
    });
  }

  // Open dialog
  uiStore.getState().openSelectDataDialog(chartId, activeSheetId, {
    dataRange: chart.dataRange || '',
    series,
    orientation: chart.seriesOrientation || 'columns',
    hiddenEmptyCells: {
      emptyCells: 'gaps', // Would read from chart config
      showHiddenData: false,
    },
  });

  return handled();
};

/**
 * CLOSE_SELECT_DATA_DIALOG - Close the Select Data dialog without applying.
 */
export const CLOSE_SELECT_DATA_DIALOG: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeSelectDataDialog();
  return handled();
};

/**
 * APPLY_SELECT_DATA - Apply changes from Select Data dialog to the chart.
 *
 * Uses Mutations layer for data write to ensure proper undo description.
 */
export const APPLY_SELECT_DATA: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const dialogState = uiStore.getState().selectDataDialog;

  if (!dialogState.isOpen || !dialogState.chartId || !dialogState.sheetId) {
    return { handled: false, error: 'Dialog not open or missing chart/sheet ID' };
  }

  const ws = deps.workbook.getSheetById(sheetId(dialogState.sheetId));

  // Update chart with new data via unified Worksheet API
  try {
    await ws.charts.setSourceData(dialogState.chartId, {
      dataRange: dialogState.dataRange,
      // Note: Full implementation would update series configurations
    });
    const appModel = await ws.charts.getAppModel(dialogState.chartId, {
      materialization: 'available',
    });
    const currentOrientation = appModel?.source.orientation;
    if (
      (currentOrientation && currentOrientation !== dialogState.orientation) ||
      (!currentOrientation && dialogState.orientation === 'rows')
    ) {
      const switchReceipt = await ws.charts.switchSeriesOrientation(dialogState.chartId);
      if (switchReceipt.status !== 'applied') {
        return {
          handled: false,
          error:
            switchReceipt.diagnostics[0]?.message ??
            'Chart source binding does not support switching series orientation',
        };
      }
    }
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  // Close dialog
  uiStore.getState().closeSelectDataDialog();

  return handled();
};

// =============================================================================
// Chart Selection Actions (13.9: Multi-Select)
// =============================================================================

/**
 * SELECT_CHART - Select a single chart (deselects all others).
 * Payload: { chartId: string }
 *
 * This is the default click behavior.
 */
export const SELECT_CHART: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  selectChartObject(deps, chartId);

  return handled();
};

/**
 * DESELECT_CHART - Deselect a specific chart.
 * Payload: { chartId: string }
 */
export const DESELECT_CHART: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  deselectChartObjects(deps);

  return handled();
};

/**
 * DESELECT_ALL_CHARTS - Deselect all charts.
 * No payload required.
 */
export const DESELECT_ALL_CHARTS: ActionHandler = (deps): ActionResult => {
  deselectChartObjects(deps);

  return handled();
};

/**
 * ADD_CHART_TO_SELECTION - Add a chart to the current selection (Shift+click).
 * Payload: { chartId: string }
 */
export const ADD_CHART_TO_SELECTION: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  deps.commands.object.selectObject(chartId, true, false);

  return handled();
};

/**
 * TOGGLE_CHART_SELECTION - Toggle a chart in the selection (Ctrl/Cmd+click).
 * Payload: { chartId: string }
 */
export const TOGGLE_CHART_SELECTION: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  deps.commands.object.selectObject(chartId, false, true);

  return handled();
};

// =============================================================================
// Chart Z-Order Actions (13.3: Z-Order Commands)
// =============================================================================

/**
 * BRING_CHART_TO_FRONT - Bring a chart to the front (highest z-index).
 * Payload: { chartId: string }
 *
 * Uses the chart z-order API so the request reaches the compute z-index path.
 */
export const BRING_CHART_TO_FRONT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.charts.bringToFront(chartId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }
  return handled();
};

/**
 * SEND_CHART_TO_BACK - Send a chart to the back (lowest z-index).
 * Payload: { chartId: string }
 *
 * Uses the chart z-order API so the request reaches the compute z-index path.
 */
export const SEND_CHART_TO_BACK: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.charts.sendToBack(chartId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }
  return handled();
};

/**
 * BRING_CHART_FORWARD - Bring a chart forward by one layer.
 * Payload: { chartId: string }
 *
 * Uses the chart z-order API so the request reaches the compute z-index path.
 */
export const BRING_CHART_FORWARD: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.charts.bringForward(chartId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }
  return handled();
};

/**
 * SEND_CHART_BACKWARD - Send a chart backward by one layer.
 * Payload: { chartId: string }
 *
 * Uses the chart z-order API so the request reaches the compute z-index path.
 */
export const SEND_CHART_BACKWARD: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.charts.sendBackward(chartId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }
  return handled();
};

// =============================================================================
// Chart Clipboard Actions (13.4: Chart Copy/Paste)
// =============================================================================

/**
 * COPY_CHART - Copy a chart to the chart clipboard.
 * Payload: { chartId: string }
 *
 * This is a read operation - stores chart config in UIStore clipboard.
 * No Yjs write, so no Mutations layer needed.
 */
export const COPY_CHART: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  // When invoked via keyboard shortcut, payload is absent — fall back to the
  // currently selected object. Use deps.accessors.object.getFirstSelectedId()
  // rather than deps.accessors.chart.getSelectedChartId() because the chart
  // actor's selectedChartIds is populated via an async SYNC_SELECTION event
  // from chart-coordination.ts (it does ws.charts.list() before syncing),
  // creating a race with keyboard events. The objectInteraction actor's
  // selectedIds is set synchronously on click, so it's always current.
  const chartId = payload?.chartId ?? deps.accessors.object.getFirstSelectedId();
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.activeSheet;
  const uiStore = getUIStore(deps);

  // Read chart via unified Worksheet API
  const chart = await ws.charts.get(chartId);
  if (!chart) {
    return { handled: false, error: `Chart ${chartId} not found` };
  }

  // Store in UIStore clipboard (not a Yjs write)
  uiStore.getState().copyChartToClipboard(chart as SerializedChart, sheetId);
  return handled();
};

/**
 * CUT_CHART - Cut a chart (copy to clipboard, mark for deletion on paste).
 * Payload: { chartId: string }
 *
 * This is a read operation - stores chart config in UIStore clipboard with cut flag.
 * No Yjs write, so no Mutations layer needed. Deletion happens on paste.
 */
export const CUT_CHART: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  // Same async-race fix as COPY_CHART — use object accessor (synchronous)
  // rather than chart accessor (async-synced).
  const chartId = payload?.chartId ?? deps.accessors.object.getFirstSelectedId();
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.activeSheet;
  const uiStore = getUIStore(deps);

  // Read chart via unified Worksheet API
  const chart = await ws.charts.get(chartId);
  if (!chart) {
    return { handled: false, error: `Chart ${chartId} not found` };
  }

  // Store in UIStore clipboard with cut flag (not a Yjs write)
  uiStore.getState().cutChartToClipboard(chart as SerializedChart, sheetId);
  return handled();
};

/**
 * PASTE_CHART - Paste a chart from the chart clipboard.
 * Creates a new chart with offset position.
 * If this was a cut operation, also deletes the original chart.
 *
 * Uses Mutations layer for chart creation and deletion.
 */
export const PASTE_CHART: AsyncActionHandler = pasteChartFromClipboard;

// =============================================================================
// Chart Navigation Actions (Keyboard Shortcuts)
// =============================================================================

/**
 * CYCLE_NEXT_CHART - Select the next chart on the current sheet.
 * Used by Tab key when a chart is selected.
 * Payload: { currentChartId?: string }
 */
export const CYCLE_NEXT_CHART: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const ws = deps.workbook.activeSheet;

  // Get all charts on current sheet via unified Worksheet API
  const charts = await ws.charts.list();
  if (charts.length === 0) {
    return { handled: false, reason: 'disabled' };
  }

  // Find current chart and select next one
  const currentChartId = payload?.currentChartId;
  if (!currentChartId || charts.length === 1) {
    // No current chart or only one chart - select first
    selectChartObject(deps, charts[0].id);
    return handled();
  }

  // Find index of current chart
  const currentIndex = charts.findIndex((c) => c.id === currentChartId);
  if (currentIndex === -1) {
    // Current chart not found - select first
    selectChartObject(deps, charts[0].id);
    return handled();
  }

  // Select next chart (wrap around to first)
  const nextIndex = (currentIndex + 1) % charts.length;
  selectChartObject(deps, charts[nextIndex].id);

  return handled();
};

/**
 * CYCLE_PREVIOUS_CHART - Select the previous chart on the current sheet.
 * Used by Shift+Tab key when a chart is selected.
 * Payload: { currentChartId?: string }
 */
export const CYCLE_PREVIOUS_CHART: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const ws = deps.workbook.activeSheet;

  // Get all charts on current sheet via unified Worksheet API
  const charts = await ws.charts.list();
  if (charts.length === 0) {
    return { handled: false, reason: 'disabled' };
  }

  // Find current chart and select previous one
  const currentChartId = payload?.currentChartId;
  if (!currentChartId || charts.length === 1) {
    // No current chart or only one chart - select last
    selectChartObject(deps, charts[charts.length - 1].id);
    return handled();
  }

  // Find index of current chart
  const currentIndex = charts.findIndex((c) => c.id === currentChartId);
  if (currentIndex === -1) {
    // Current chart not found - select last
    selectChartObject(deps, charts[charts.length - 1].id);
    return handled();
  }

  // Select previous chart (wrap around to last)
  const prevIndex = currentIndex === 0 ? charts.length - 1 : currentIndex - 1;
  selectChartObject(deps, charts[prevIndex].id);

  return handled();
};

// =============================================================================
// Chart Creation Actions (F11/Alt+F1)
// =============================================================================

/**
 * CREATE_CHART_SHEET - Create a new sheet with a chart from the current selection.
 * Used by F11 key.
 *
 * Uses Mutations layer for sheet and chart creation.
 */
export const CREATE_CHART_SHEET: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.activeSheet;

  // Get selection for data range (bounded to actual data extent)
  const ranges = getChartSourceRanges(deps, sheetId);

  // Create a new sheet for the chart via unified Workbook API
  let newWs;
  try {
    newWs = await deps.workbook.sheets.add('Chart');
  } catch (e: any) {
    return { handled: false, error: e.message ?? 'Failed to create chart sheet' };
  }

  // Build data range from selection (if any)
  let dataRange = '';
  if (ranges && ranges.length > 0) {
    // Excel parity: expand single-cell / single-row selections to the
    // surrounding data region. expandToDataRegion is a no-op for multi-row
    // selections and returns null for empty cells (we keep ranges[0] then).
    const range = await resolveChartSourceRange(ws, ranges[0], { trimHiddenDetail: true });
    // Include sheet reference in data range for cross-sheet reference
    const sheetName = (await ws.getName()) || 'Sheet1';
    dataRange = `'${sheetName}'!${rangeToA1Notation(range)}`;
  }

  // Create chart on the new sheet (full-sheet chart) via unified Worksheet API
  try {
    await newWs.charts.add({
      type: 'column',
      dataRange,
      anchorRow: 0,
      anchorCol: 0,
      width: 800, // Larger chart for dedicated sheet
      height: 600,
    });
  } catch (e: any) {
    return { handled: false, error: e.message ?? 'Failed to create chart' };
  }

  return handled();
};

/**
 * CREATE_EMBEDDED_CHART - Create an embedded chart on the current sheet from selection.
 * Used by Alt+F1 key or Insert -> Charts menu.
 * Payload: { type?: ChartType, subType?: string }
 *
 * Uses Mutations layer for chart creation.
 * Uses smart positioning to ensure chart is visible when created.
 *
 */
export const CREATE_EMBEDDED_CHART: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.activeSheet;

  // Get selection for data range (bounded to actual data extent)
  const ranges = getChartSourceRanges(deps, sheetId);

  // Default chart configuration
  const chartType = payload?.type || 'column';
  const chartSubType = payload?.subType;

  const DEFAULT_WIDTH_PT = 480;
  const DEFAULT_HEIGHT_PT = 225;

  // Default position when no selection
  const DEFAULT_POSITION = { anchorRow: 2, anchorCol: 2 };

  try {
    if (!ranges || ranges.length === 0) {
      // No selection - use smart positioning with default position
      const position = await getSmartChartPosition(deps, null, DEFAULT_POSITION, sheetId);
      const newChart = await ws.charts.add({
        type: chartType,
        subType: chartSubType,
        dataRange: '',
        anchorRow: position.anchorRow,
        anchorCol: position.anchorCol,
        width: DEFAULT_WIDTH_PT,
        height: DEFAULT_HEIGHT_PT,
      });
      if (newChart.chart.id) {
        selectChartObject(deps, newChart.chart.id);
      }
      return handled();
    }

    // Excel parity: expand single-cell / single-row selections to the
    // surrounding data region. Multi-row selections pass through unchanged.
    const range = await resolveChartCreationSourceRange(ws, ranges[0], {
      trimHiddenDetail: true,
    });
    if (!range) return handled();
    const dataRange = rangeToA1Notation(range);
    const inferredSeries = await inferFirstColumnLabelSeries(ws, range);

    // Use smart positioning to ensure chart is visible
    const position = await getSmartChartPosition(deps, range, DEFAULT_POSITION, sheetId);

    const newChart = await ws.charts.add({
      type: chartType,
      subType: chartSubType,
      dataRange,
      ...(inferredSeries
        ? {
            series: inferredSeries,
            seriesOrientation: 'rows' as const,
          }
        : {}),
      anchorRow: position.anchorRow,
      anchorCol: position.anchorCol,
      width: DEFAULT_WIDTH_PT,
      height: DEFAULT_HEIGHT_PT,
    });
    if (newChart.chart.id) {
      selectChartObject(deps, newChart.chart.id);
    }
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * CREATE_CHART - Alias for CREATE_EMBEDDED_CHART.
 * Creates a chart on the current sheet from the selection.
 */
export const CREATE_CHART: AsyncActionHandler = CREATE_EMBEDDED_CHART;

// =============================================================================
// Insert Chart Wizard Dialog Actions
// =============================================================================

/**
 * Helper function to convert a range to A1 notation.
 */
function rangeToA1Notation(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  const columnToLetter = (col: number): string => {
    let result = '';
    let c = col;
    while (c >= 0) {
      result = String.fromCharCode((c % 26) + 65) + result;
      c = Math.floor(c / 26) - 1;
    }
    return result;
  };

  const startCol = columnToLetter(range.startCol);
  const endCol = columnToLetter(range.endCol);
  const startRow = range.startRow + 1;
  const endRow = range.endRow + 1;

  if (range.startRow === range.endRow && range.startCol === range.endCol) {
    return `${startCol}${startRow}`;
  }
  return `${startCol}${startRow}:${endCol}${endRow}`;
}

/**
 * OPEN_INSERT_CHART_WIZARD_DIALOG - Open the Insert Chart Wizard dialog.
 *
 * This is the multi-step wizard for creating a new chart.
 * Pre-populates the data range based on current selection if available.
 *
 */
export const OPEN_INSERT_CHART_WIZARD_DIALOG: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const sheetId = deps.getActiveSheetId();

  // Try to get the current selection to pre-populate the data range (bounded to actual data extent)
  let initialDataRange = '';
  const ranges = getChartSourceRanges(deps, sheetId);
  if (ranges && ranges.length > 0) {
    // Excel parity: expand single-cell / single-row selections to the
    // surrounding data region before seeding the wizard.
    const ws = deps.workbook.getSheetById(sheetId);
    const range = await resolveChartSourceRange(ws, ranges[0]);
    initialDataRange = rangeToA1Notation(range);
  }

  uiStore.getState().openInsertChartWizardDialog(initialDataRange);
  return handled();
};

/**
 * CLOSE_INSERT_CHART_WIZARD_DIALOG - Close the Insert Chart Wizard dialog without creating a chart.
 *
 */
export const CLOSE_INSERT_CHART_WIZARD_DIALOG: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeInsertChartWizardDialog();
  return handled();
};

/**
 * INSERT_CHART_FROM_WIZARD - Create a chart using the configuration from the wizard dialog.
 *
 * This reads all settings from the wizard dialog state and creates a new chart.
 * Uses Mutations layer for chart creation.
 * Uses smart positioning to ensure chart is visible when created.
 *
 */
export const INSERT_CHART_FROM_WIZARD: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const dialogState = uiStore.getState().insertChartWizardDialog;

  if (!dialogState.isOpen) {
    return { handled: false, error: 'Wizard dialog is not open' };
  }

  if (!dialogState.chartType || !dialogState.variantId) {
    uiStore.getState().setChartWizardError('Please select a chart type.');
    return handled();
  }

  if (!dialogState.dataRange) {
    uiStore.getState().setChartWizardError('Please specify a data range.');
    return handled();
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.activeSheet;

  // Get current selection for chart placement (bounded to actual data extent)
  const ranges = getChartSourceRanges(deps, sheetId);

  // Default position when no selection
  const DEFAULT_POSITION = { anchorRow: 2, anchorCol: 2 };

  // Use smart positioning to ensure chart is visible
  const sourceRange = ranges && ranges.length > 0 ? ranges[0] : null;
  const position = await getSmartChartPosition(deps, sourceRange, DEFAULT_POSITION, sheetId);

  const DEFAULT_WIDTH_PT = 480;
  const DEFAULT_HEIGHT_PT = 225;

  // Create chart via unified Worksheet API
  // Note: ChartConfig uses 'axis' property with xAxis/yAxis sub-properties
  try {
    const newChart = await ws.charts.add({
      type: dialogState.chartType,
      subType: dialogState.variantId as ChartConfig['subType'],
      dataRange: dialogState.dataRange,
      seriesOrientation: dialogState.seriesInRows ? 'rows' : 'columns',
      title: dialogState.title,
      axis: {
        categoryAxis: {
          axisType: 'category',
          type: 'category',
          visible: true,
          show: true,
          title: dialogState.xAxis.title || undefined,
          min: dialogState.xAxis.min,
          max: dialogState.xAxis.max,
          gridLines: dialogState.xAxis.showGridlines,
        },
        valueAxis: {
          axisType: 'value',
          type: 'value',
          visible: true,
          show: true,
          title: dialogState.yAxis.title || undefined,
          min: dialogState.yAxis.min,
          max: dialogState.yAxis.max,
          gridLines: dialogState.yAxis.showGridlines,
        },
      },
      legend: {
        show: dialogState.legend.show,
        visible: dialogState.legend.show,
        position: dialogState.legend.position,
      },
      dataLabels: { show: dialogState.showDataLabels },
      anchorRow: position.anchorRow,
      anchorCol: position.anchorCol,
      width: DEFAULT_WIDTH_PT,
      height: DEFAULT_HEIGHT_PT,
    });
    if (newChart.chart.id) {
      selectChartObject(deps, newChart.chart.id);
    }
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  // Close dialog
  uiStore.getState().closeInsertChartWizardDialog();

  return handled();
};

// =============================================================================
// Chart Nudge Actions (Arrow Keys for Chart Position)
// =============================================================================

/**
 * Nudge amount constants.
 * Standard nudge is 1 cell, large nudge (Ctrl+Arrow) is 5 cells.
 */
const NUDGE_SMALL = 1;
const NUDGE_LARGE = 5;

/**
 * Helper function to nudge a chart by the specified offset.
 * Uses Mutations layer for chart movement.
 * Payload: { chartId: string, large?: boolean }
 */
async function nudgeChart(
  deps: ActionDependencies,
  payload: { chartId?: string; large?: boolean } | undefined,
  dx: number,
  dy: number,
): Promise<ActionResult> {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const ws = deps.workbook.activeSheet;

  // Get current chart position via unified Worksheet API
  const chart = await ws.charts.get(chartId);
  if (!chart) {
    return { handled: false, error: `Chart ${chartId} not found` };
  }

  const amount = payload?.large ? NUDGE_LARGE : NUDGE_SMALL;
  const currentRow = chart.anchorRow ?? 0;
  const currentCol = chart.anchorCol ?? 0;

  // Calculate new position (ensure non-negative)
  const newRow = Math.max(0, currentRow + dy * amount);
  const newCol = Math.max(0, currentCol + dx * amount);

  try {
    await ws.charts.update(chartId, { anchorRow: newRow, anchorCol: newCol });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
}

/**
 * NUDGE_CHART_UP - Move chart up by 1px (or 10px with Ctrl).
 * Payload: { chartId: string, large?: boolean }
 *
 * Triggered by ArrowUp when chart is selected.
 * With Ctrl modifier, moves by 10px instead of 1px.
 */
export const NUDGE_CHART_UP: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  return nudgeChart(deps, payload, 0, -1);
};

/**
 * NUDGE_CHART_DOWN - Move chart down by 1px (or 10px with Ctrl).
 * Payload: { chartId: string, large?: boolean }
 *
 * Triggered by ArrowDown when chart is selected.
 * With Ctrl modifier, moves by 10px instead of 1px.
 */
export const NUDGE_CHART_DOWN: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  return nudgeChart(deps, payload, 0, 1);
};

/**
 * NUDGE_CHART_LEFT - Move chart left by 1px (or 10px with Ctrl).
 * Payload: { chartId: string, large?: boolean }
 *
 * Triggered by ArrowLeft when chart is selected.
 * With Ctrl modifier, moves by 10px instead of 1px.
 */
export const NUDGE_CHART_LEFT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  return nudgeChart(deps, payload, -1, 0);
};

/**
 * NUDGE_CHART_RIGHT - Move chart right by 1px (or 10px with Ctrl).
 * Payload: { chartId: string, large?: boolean }
 *
 * Triggered by ArrowRight when chart is selected.
 * With Ctrl modifier, moves by 10px instead of 1px.
 */
export const NUDGE_CHART_RIGHT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  return nudgeChart(deps, payload, 1, 0);
};

// =============================================================================
// Chart Context Menu Enhancements
// =============================================================================

/**
 * RESET_CHART_STYLE - Reset chart formatting to match the current theme.
 * Payload: { chartId: string }
 *
 * Removes custom formatting and applies default theme styles.
 * Uses Mutations layer for chart update.
 *
 * Chart Context Menu Enhancements
 */
export const RESET_CHART_STYLE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const ws = deps.workbook.activeSheet;

  try {
    await ws.charts.update(chartId, {
      colors: [...DEFAULT_CHART_COLORS],
    });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * OPEN_MOVE_CHART_DIALOG - Open the Move Chart dialog.
 * Payload: { chartId: string }
 *
 * Allows moving chart to a new sheet or different existing sheet.
 *
 * Chart Context Menu Enhancements
 */
// SCOPE: deferred to dialog component does not exist yet
export const OPEN_MOVE_CHART_DIALOG: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  // Delegate to UI layer to open the dialog
  if (!deps.onUIAction) {
    return notHandled('disabled');
  }

  deps.onUIAction(`OPEN_MOVE_CHART_DIALOG:${chartId}`);
  return handled();
};

/**
 * OPEN_FORMAT_CHART_AREA - Open the Format Chart Area panel/dialog.
 * Payload: { chartId: string }
 *
 * Opens formatting options for the chart area (background, border, etc.).
 *
 * Chart Context Menu Enhancements
 */
// SCOPE: deferred to dialog component does not exist yet
export const OPEN_FORMAT_CHART_AREA: ActionHandler = (deps, payload): ActionResult => {
  const chartId = getChartIdFromPayloadOrSelectedObject(deps, payload);
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().setChartEditorTab?.('style');
  selectChartObject(deps, chartId);
  deps.commands.chart.startEdit();

  deps.onUIAction?.(`OPEN_FORMAT_CHART_AREA:${chartId}`);
  return handled();
};

// =============================================================================
// Element-Specific Chart Context Menu Actions
// =============================================================================

/**
 * OPEN_FORMAT_PLOT_AREA - Open the Format Plot Area panel/dialog.
 * Payload: { chartId: string }
 *
 * Opens formatting options for the plot area (background, border, etc.).
 *
 * Element-Specific Chart Context Menu
 */
// SCOPE: deferred to dialog component does not exist yet
export const OPEN_FORMAT_PLOT_AREA: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  // Delegate to UI layer to open the format panel
  if (!deps.onUIAction) {
    return notHandled('disabled');
  }

  deps.onUIAction(`OPEN_FORMAT_PLOT_AREA:${chartId}`);
  return handled();
};

/**
 * OPEN_FORMAT_DATA_SERIES - Open the Format Data Series panel/dialog.
 * Payload: { chartId: string, seriesIndex?: number }
 *
 * Opens formatting options for a data series (fill, border, markers, etc.).
 *
 * Element-Specific Chart Context Menu
 */
// SCOPE: deferred to dialog component does not exist yet
export const OPEN_FORMAT_DATA_SERIES: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const seriesIndex = payload?.seriesIndex ?? 0;

  // Delegate to UI layer to open the format panel
  if (!deps.onUIAction) {
    return notHandled('disabled');
  }

  deps.onUIAction(`OPEN_FORMAT_DATA_SERIES:${JSON.stringify({ chartId, seriesIndex })}`);
  return handled();
};

/**
 * ADD_DATA_LABELS - Add data labels to a chart series.
 * Payload: { chartId: string, seriesIndex?: number }
 *
 * Adds value labels to each data point in the series.
 *
 * routes through the workbook charts API
 * (`ws.charts.updateSeries(chartId, seriesIndex, { dataLabels: { ... } })`).
 * Replaces the unwired `onUIAction` JSON-string protocol. Pure state
 * change — no dialog involved.
 *
 * Element-Specific Chart Context Menu
 */
export const ADD_DATA_LABELS: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const seriesIndex = payload?.seriesIndex ?? 0;
  const ws = deps.workbook.activeSheet;

  try {
    // DataLabelConfig.show toggles visibility; use minimal Excel-default
    // payload (showValue) so the labels are immediately visible after the
    // mutation lands.
    await ws.charts.updateSeries(chartId, seriesIndex, {
      dataLabels: { show: true, showValue: true },
    });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * ADD_TRENDLINE - Add a trendline to a chart series.
 * Payload: { chartId: string, seriesIndex?: number }
 *
 * Adds a default linear trendline to the series.
 *
 * routes through the workbook charts API
 * (`ws.charts.addTrendline(chartId, seriesIndex, { type: 'linear', show: true })`).
 * Replaces the unwired `onUIAction` JSON-string protocol. Pure state
 * change — opens no dialog (Excel parity for "Add Trendline" context-menu
 * item; the Format Trendline dialog is separate and deferred).
 *
 * Element-Specific Chart Context Menu
 */
export const ADD_TRENDLINE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const seriesIndex = payload?.seriesIndex ?? 0;
  const ws = deps.workbook.activeSheet;

  try {
    await ws.charts.addTrendline(chartId, seriesIndex, {
      type: 'linear',
      show: true,
    });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * OPEN_FORMAT_AXIS - Open the Format Axis panel/dialog.
 * Payload: { chartId: string, axisType: 'x' | 'y' }
 *
 * Opens formatting options for an axis (scale, labels, format, etc.).
 *
 * Element-Specific Chart Context Menu
 */
// SCOPE: deferred to dialog component does not exist yet
export const OPEN_FORMAT_AXIS: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const axisType = payload?.axisType ?? 'x';

  // Delegate to UI layer to open the format panel
  if (!deps.onUIAction) {
    return notHandled('disabled');
  }

  deps.onUIAction(`OPEN_FORMAT_AXIS:${JSON.stringify({ chartId, axisType })}`);
  return handled();
};

/**
 * TOGGLE_GRIDLINES - Toggle gridlines visibility for an axis.
 * Payload: { chartId: string, axisType: 'x' | 'y' }
 *
 * Shows or hides gridlines for the specified axis.
 *
 * reads the chart, flips the axis's `gridLines`
 * boolean, and writes back via `ws.charts.update`. `axisType` 'x' maps
 * to `axis.categoryAxis`, 'y' maps to `axis.valueAxis` (matches the
 * Excel parity convention used elsewhere in this file). Replaces the
 * unwired stringly-typed UI escape hatch.
 *
 * Element-Specific Chart Context Menu
 */
export const TOGGLE_GRIDLINES: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const axisType: 'x' | 'y' = payload?.axisType ?? 'x';
  const ws = deps.workbook.activeSheet;

  try {
    const chart = await ws.charts.get(chartId);
    if (!chart) {
      return { handled: false, error: `Chart ${chartId} not found` };
    }

    const axisKey: 'categoryAxis' | 'valueAxis' = axisType === 'x' ? 'categoryAxis' : 'valueAxis';
    const currentAxes = chart.axis ?? {};
    const currentSingle = currentAxes[axisKey] ?? { visible: true };
    const nextGridLines = !(currentSingle.gridLines ?? false);

    await ws.charts.update(chartId, {
      axis: {
        ...currentAxes,
        [axisKey]: {
          ...currentSingle,
          gridLines: nextGridLines,
        },
      },
    });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * OPEN_FORMAT_LEGEND - Open the Format Legend panel/dialog.
 * Payload: { chartId: string }
 *
 * Opens formatting options for the legend (position, font, etc.).
 *
 * Element-Specific Chart Context Menu
 */
// SCOPE: deferred to dialog component does not exist yet
export const OPEN_FORMAT_LEGEND: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  // Delegate to UI layer to open the format panel
  if (!deps.onUIAction) {
    return notHandled('disabled');
  }

  deps.onUIAction(`OPEN_FORMAT_LEGEND:${chartId}`);
  return handled();
};

/**
 * OPEN_FORMAT_CHART_TITLE - Open the Format Chart Title panel/dialog.
 * Payload: { chartId: string }
 *
 * Opens formatting options for the chart title (font, alignment, etc.).
 *
 * Element-Specific Chart Context Menu
 */
// SCOPE: deferred to dialog component does not exist yet
export const OPEN_FORMAT_CHART_TITLE: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  // Delegate to UI layer to open the format panel
  if (!deps.onUIAction) {
    return notHandled('disabled');
  }

  deps.onUIAction(`OPEN_FORMAT_CHART_TITLE:${chartId}`);
  return handled();
};

// =============================================================================
// Chart UI Slice Actions
// =============================================================================

/**
 * SHOW_CHART_TOOLTIP - Show a tooltip for a chart data point.
 * Payload: { chartId: string, data: ChartTooltipData, position: { x: number, y: number } }
 *
 * Used by chart renderers when hovering over data points.
 *
 * Chart Engine Rearchitecture
 */
export const SHOW_CHART_TOOLTIP: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  const data = payload?.data;
  const position = payload?.position;

  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }
  if (!data) {
    return { handled: false, error: 'Missing data in payload' };
  }
  if (!position) {
    return { handled: false, error: 'Missing position in payload' };
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().showChartTooltip(chartId, data, position);

  return handled();
};

/**
 * HIDE_CHART_TOOLTIP - Hide the currently shown chart tooltip.
 *
 * Chart Engine Rearchitecture
 */
export const HIDE_CHART_TOOLTIP: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().hideChartTooltip();

  return handled();
};

/**
 * SET_CHART_ERROR - Set an error for a specific chart.
 * Payload: { chartId: string, error: ChartError }
 *
 * Used when chart rendering or data extraction fails.
 *
 * Chart Engine Rearchitecture
 */
export const SET_CHART_ERROR: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;
  const error = payload?.error;

  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }
  if (!error) {
    return { handled: false, error: 'Missing error in payload' };
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().setChartError(chartId, error);

  return handled();
};

/**
 * CLEAR_CHART_ERROR - Clear the error for a specific chart.
 * Payload: { chartId: string }
 *
 * Used when a chart error is resolved.
 *
 * Chart Engine Rearchitecture
 */
export const CLEAR_CHART_ERROR: ActionHandler = (deps, payload): ActionResult => {
  const chartId = payload?.chartId;

  if (!chartId) {
    return { handled: false, error: 'Missing chartId in payload' };
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().clearChartError(chartId);

  return handled();
};

/**
 * CLEAR_ALL_CHART_ERRORS - Clear all chart errors.
 *
 * Used when switching sheets or resetting the UI state.
 *
 * Chart Engine Rearchitecture
 */
export const CLEAR_ALL_CHART_ERRORS: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().clearAllChartErrors();

  return handled();
};

/**
 * SET_CHART_EDITOR_TAB - Set the active tab in the chart editor panel.
 * Payload: { tab: 'data' | 'style' | 'layout' }
 *
 * Chart Engine Rearchitecture
 */
export const SET_CHART_EDITOR_TAB: ActionHandler = (deps, payload): ActionResult => {
  const tab = payload?.tab;

  if (!tab || !['data', 'style', 'layout'].includes(tab)) {
    return { handled: false, error: 'Invalid or missing tab in payload' };
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().setChartEditorTab(tab);

  return handled();
};

// =============================================================================
// Chart Canvas Rendering - Title Editor Actions
// =============================================================================

/**
 * OPEN_CHART_TITLE_EDITOR - Open the chart title editor modal.
 * Payload: { chartId?: string }
 *
 * If chartId is provided, opens editor for that chart.
 * If no chartId, uses the currently selected chart.
 *
 * This is triggered by double-clicking on chart title area or via context menu.
 *
 * Chart Canvas Rendering
 */
export const OPEN_CHART_TITLE_EDITOR: ActionHandler = (deps, payload): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  // Use provided chartId or fall back to selected chart
  let chartId = payload?.chartId;
  if (!chartId) {
    // Try to get selected chart from chart machine state
    const selectedChartId = uiStore.getState().tooltipChartId;
    // Fallback: Check if there's a selectedChartId in the XState chart machine
    // For now, we require explicit chartId
    if (!selectedChartId) {
      return { handled: false, error: 'No chartId provided and no chart selected' };
    }
    chartId = selectedChartId;
  }

  uiStore.getState().openChartTitleEditor(chartId);
  return handled();
};

/**
 * CLOSE_CHART_TITLE_EDITOR - Close the chart title editor modal.
 *
 * This is triggered by Cancel button, Escape key, or clicking outside.
 *
 * Chart Canvas Rendering
 */
export const CLOSE_CHART_TITLE_EDITOR: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  uiStore.getState().closeChartTitleEditor();
  return handled();
};

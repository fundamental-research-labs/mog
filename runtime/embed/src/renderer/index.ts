/**
 * EmbedRenderOrchestrator — thin wrapper over @mog-sdk/sheet-view.
 *
 * The embed renderer delegates all substrate concerns (canvas engine, grid
 * layers, VPI/VMI, viewport regions, layout, scroll, hit test) to SheetView.
 * This file owns only the embed-specific chrome: the FormulaBar on top, the
 * SheetTabs on the bottom, and the formula-bar update on cell click.
 *
 * Replaces the prior 627-line in-tree orchestrator that reimplemented the
 * substrate against the canvas-engine and grid-renderer hardware packages
 * directly, with hardcoded 20px/80px row/col dimension fallbacks.
 */

import {
  createSheetView,
  type SheetDisposable,
  type SheetEventScrollChange,
  type SheetEventScrollPositionReset,
  type SheetEventZoomChange,
  type SheetViewEvent,
  type SheetViewHandle,
} from '@mog-sdk/sheet-view';

import type { MogClient } from '../client/index';
import type { EmbedRendererOptions } from '../types';
import { TypedEventEmitter } from '../shared/event-emitter';
import { cellRef } from '../shared/column-name';
import { FormulaBar } from './formula-bar';
import { SheetTabs, type SheetTabInfo } from './sheet-tabs';

type OrchestratorEventMap = {
  sheetChange: number;
  cellSelect: { row: number; col: number };
  scrollChange: SheetEventScrollChange;
  scrollPositionReset: SheetEventScrollPositionReset;
  zoomChange: SheetEventZoomChange;
};

const DEFAULT_THEME = {
  gridlineColor: '#E2E2E2',
  headerBg: '#F8F8F8',
  background: '#FFFFFF',
};

export class EmbedRenderOrchestrator extends TypedEventEmitter<OrchestratorEventMap> {
  private readonly _container: HTMLElement;
  private readonly _canvasArea: HTMLDivElement;
  private readonly _view: SheetViewHandle;
  private readonly _formulaBar: FormulaBar | null;
  private readonly _sheetTabs: SheetTabs | null;
  private readonly _viewEvents: SheetDisposable;
  private _client: MogClient | null = null;
  private _disposed = false;

  constructor(container: HTMLElement, options?: EmbedRendererOptions) {
    super();
    this._container = container;

    const headers = options?.headers ?? true;
    const gridlines = options?.gridlines ?? true;
    const showFormulaBar = options?.formulaBar ?? true;
    const showTabs = options?.sheetTabs ?? true;
    const scrollable = options?.scrollable ?? true;
    const scrollbars = options?.scrollbars ?? true;
    const zoomControls = options?.zoomControls ?? true;
    const theme = { ...DEFAULT_THEME, ...(options?.theme ?? {}) };

    // Layout: [formula bar] [canvas area (flex)] [sheet tabs]
    this._formulaBar = showFormulaBar ? new FormulaBar(container) : null;
    this._canvasArea = document.createElement('div');
    this._canvasArea.style.cssText =
      'position: relative; width: 100%; flex: 1; min-height: 0; overflow: hidden;';
    container.appendChild(this._canvasArea);
    this._sheetTabs = showTabs ? new SheetTabs(container, theme) : null;

    // SheetView owns: canvas engine, grid layers, VPI/VMI, layout, scroll, hit-test.
    // `scrollable: true` wires SheetView's own wheel + click handlers.
    // Viewport reader resolution is handled internally by SheetView after
    // attach(workbook) — no need to supply a resolver.
    this._view = createSheetView(
      {
        container: this._canvasArea,
        showHeaders: headers,
        showGridlines: gridlines,
        scrollable,
        viewportChrome: {
          scrollbars,
          zoomControls,
        },
        dpr: options?.dpr,
      },
      {
        onCellClick: (row: number, col: number) => this._handleCellClick(row, col),
      },
    );
    this._viewEvents = this._view.events.subscribe((event: SheetViewEvent) => {
      if (event.type === 'scroll-change') this.emit('scrollChange', event);
      if (event.type === 'scroll-position-reset') this.emit('scrollPositionReset', event);
      if (event.type === 'zoom-change') this.emit('zoomChange', event);
    });
  }

  /** Attach the MogClient so the view can render the workbook. */
  attach(client: MogClient): void {
    if (this._disposed) return;
    this._client = client;
    const workbook = client.workbook;
    if (!workbook) return;
    this._view.attach({
      initialSheetId: String(
        (workbook as { activeSheet?: { sheetId?: unknown } }).activeSheet?.sheetId ?? '',
      ),
      workbook,
    });
    // SheetView.attach() deliberately does NOT start the render loop so policy
    // layers can push initial context first. Embed has no policy layer — start now.
    this._view.start();
  }

  /** Switch to a different sheet by its SheetId. Called by the web component / React wrapper. */
  updateSheet(sheetId: string): void {
    if (this._disposed) return;
    this._view.switchSheet(sheetId);
  }

  /** Populate the sheet tab bar. */
  setSheets(sheets: SheetTabInfo[], activeIndex: number): void {
    this._sheetTabs?.update(sheets, activeIndex, (index) => {
      this.emit('sheetChange', index);
    });
  }

  /** Update the formula bar to reflect the selected cell. */
  setSelectedCell(row: number, col: number): void {
    this._formulaBar?.setRef(row, col);
  }

  /** Resize the container. */
  resize(width: number, height: number): void {
    this._container.style.width = `${width}px`;
    this._container.style.height = `${height}px`;
    // SheetView's ResizeObserver handles its own canvas area sizing.
  }

  navigateToRange(range: string): void {
    if (this._disposed) return;
    const match = range.match(/^([A-Z]+)(\d+)/i);
    if (!match) return;
    const col =
      match[1]!.split('').reduce((acc, c) => acc * 26 + c.toUpperCase().charCodeAt(0) - 64, 0) - 1;
    const row = parseInt(match[2]!, 10) - 1;
    if (row >= 0 && col >= 0) this._view.scrollTo(row, col);
  }

  setScrollPosition(position: { x: number; y: number }): void {
    if (this._disposed) return;
    this._view.viewport.setScrollPosition(position, 'main');
  }

  getScrollPosition(): { x: number; y: number } {
    return this._view.viewport.getScrollPosition('main');
  }

  setZoom(zoom: number): void {
    if (this._disposed) return;
    this._view.setZoom(zoom);
  }

  getZoom(): number {
    return this._view.getZoom();
  }

  getCurrentSheetId(): string | null {
    return this._view.render.getCurrentSheetId() ?? null;
  }

  getVisibleBounds(): { startRow: number; startCol: number; endRow: number; endCol: number } {
    return this._view.getVisibleBounds();
  }

  getFrozenPanes(): { rows: number; cols: number } {
    return this._view.viewport.getFrozenPanes();
  }

  setFrozenPanes(rows: number, cols: number): void {
    if (this._disposed) return;
    this._view.viewport.setFrozenPanes({ rows, cols });
  }

  scrollTo(row: number, col: number): void {
    if (this._disposed) return;
    this._view.scrollTo(row, col);
  }

  getCellRect(
    row: number,
    col: number,
  ): { x: number; y: number; width: number; height: number } | null {
    const rect = this._view.geometry.getCellRect({ row, col });
    if (!rect) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  getViewportLayout(): unknown {
    return this._view.viewport.getLayout();
  }

  getDimensionSnapshot(limit: number = 200): {
    rowTops: number[];
    colLefts: number[];
    hiddenRows: number[];
    hiddenCols: number[];
  } {
    const rowTops: number[] = [];
    const colLefts: number[] = [];
    const hiddenRows: number[] = [];
    const hiddenCols: number[] = [];
    for (let r = 0; r < limit; r++) {
      const rowDim = this._view.geometry
        .getDimensions({ row: r, col: 0 })
        .find((d: any) => 'row' in d) as { row: number; top: number; hidden: boolean } | undefined;
      if (rowDim) {
        if (rowTops.length < 100) rowTops.push(rowDim.top);
        if (rowDim.hidden) hiddenRows.push(r);
      }
    }
    for (let c = 0; c < limit; c++) {
      const colDim = this._view.geometry
        .getDimensions({ row: 0, col: c })
        .find((d: any) => 'col' in d) as { col: number; left: number; hidden: boolean } | undefined;
      if (colDim) {
        if (colLefts.length < 100) colLefts.push(colDim.left);
        if (colDim.hidden) hiddenCols.push(c);
      }
    }
    return { rowTops, colLefts, hiddenRows, hiddenCols };
  }

  getMergesInViewport(
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number } | null,
  ): Array<{ startRow: number; startCol: number; endRow: number; endCol: number }> {
    if (!bounds) return [];
    const merges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }> =
      [];
    const seen = new Set<string>();
    const rowLimit = Math.min(bounds.endRow, bounds.startRow + 200);
    const colLimit = Math.min(bounds.endCol, bounds.startCol + 200);
    for (let r = bounds.startRow; r <= rowLimit; r++) {
      for (let c = bounds.startCol; c <= colLimit; c++) {
        const merge = this._view.geometry.getMergeAnchor(r, c);
        if (!merge) continue;
        const key = `${merge.startRow}:${merge.startCol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merges.push({
          startRow: merge.startRow,
          startCol: merge.startCol,
          endRow: merge.endRow,
          endCol: merge.endCol,
        });
        if (merges.length >= 100) return merges;
      }
    }
    return merges;
  }

  isDisposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._viewEvents.dispose();
    this._view.dispose();
    this._formulaBar?.dispose();
    this._sheetTabs?.dispose();
    this._canvasArea.remove();
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Resolve a click row/col to the merged-cell anchor (if any) and update the
   * formula bar with the anchor ref + cell data. For non-merged cells the
   * anchor is (row, col).
   */
  private _handleCellClick(row: number, col: number): void {
    const merge = this._view.geometry.getMergeAnchor(row, col);
    const anchorRow = merge ? merge.startRow : row;
    const anchorCol = merge ? merge.startCol : col;

    this._formulaBar?.setRef(anchorRow, anchorCol);
    this.emit('cellSelect', { row: anchorRow, col: anchorCol });
    void this._fetchCellInfo(anchorRow, anchorCol);
  }

  private async _fetchCellInfo(row: number, col: number): Promise<void> {
    const client = this._client;
    if (!client || client.status !== 'ready') return;
    try {
      const ws = client.getActiveSheet();
      const cell = await ws.getCell(row, col);
      const ref = cellRef(row, col);
      const formula = cell?.formula ?? cell?.value?.toString() ?? '';
      this._formulaBar?.setCellInfo({ ref, formula });
    } catch {
      // Ignore — embed is display-only.
    }
  }
}

/** Factory (back-compat with the web component + React wrapper). */
export function createEmbedRenderer(
  container: HTMLElement,
  options?: EmbedRendererOptions,
): EmbedRenderOrchestrator {
  return new EmbedRenderOrchestrator(container, options);
}

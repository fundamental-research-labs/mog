/**
 * Viewport Capability Implementation
 *
 * Wraps SheetView's scroll, frozen pane, and split operations to provide
 * the ISheetViewViewport capability interface.
 *
 * @module @mog-sdk/sheet-view/capabilities/viewport
 */

import type { ISheetViewViewport } from '../capability-interfaces';
import type { ViewportPositionIndexLike } from '@mog-sdk/contracts/rendering';
import type { ViewportLayout } from '@mog-sdk/contracts/viewport';
import type {
  CellAddress,
  FrozenPanesConfig,
  RangeAddress,
  ScrollBounds,
  ScrollPosition,
  SheetDisposable,
  SheetOverlayViewportConfig,
  SheetRect,
  SheetViewportConfig,
  SheetViewportLayout,
  SheetViewportState,
  SheetViewportSnapshot,
  SplitConfig,
} from '../public-types';
import { getLayoutAwareScrollToCell } from '../viewport-scroll-target';

type CoordinateScrollTarget = { top?: number; left?: number; x?: number; y?: number };

// =============================================================================
// Internal accessor type
// =============================================================================

/**
 * The SheetView methods that viewport needs to delegate to.
 * These are passed in from the SheetView instance so the capability
 * doesn't hold a direct reference to SheetView (avoids circular deps).
 */
export interface ViewportInternals {
  setScrollPosition(position: { x: number; y: number }, viewportId?: string): void;
  getScrollPosition(viewportId?: string): { x: number; y: number };
  getAllScrollPositions(): Map<string, { x: number; y: number }>;
  setAllScrollPositions(positions: Map<string, { x: number; y: number }>): void;
  setFrozenPanes(rows: number, cols: number): void;
  getFrozenPanes(): { rows: number; cols: number };
  setViewportConfig(config: { type: string; [key: string]: unknown }): void;
  getViewportConfig(): { type: string; [key: string]: unknown };
  addOverlayViewport(config: SheetOverlayViewportConfig): void;
  removeOverlayViewport(id: string): void;
  getViewportLayout(): SheetViewportLayout | null;
  invalidateLayout(): void;
  getVisibleBounds(): { startRow: number; startCol: number; endRow: number; endCol: number };
  getCurrentSheetId(): string;
  getZoom(): number;
  getViewportState(): SheetViewportState;
  clampScrollPosition(
    position: { x: number; y: number },
    viewportId?: string,
  ): { x: number; y: number };
  getScrollBounds(sheetId: string): { maxScrollLeft: number; maxScrollTop: number };
  getCoordinateScrollToCell(
    sheetId: string,
    cell: { row: number; col: number },
  ): CoordinateScrollTarget | null;
  getPositionIndex(): ViewportPositionIndexLike;
  getCellPageBounds(row: number, col: number): { width: number; height: number } | null;
  getViewportBounds(sheetId: string): { x: number; y: number; width: number; height: number };
}

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewViewport implements ISheetViewViewport {
  private _visibleRangeListeners: Set<(range: RangeAddress) => void> = new Set();
  private _lastVisibleRange: RangeAddress | null = null;

  constructor(private readonly _internals: ViewportInternals) {}

  /**
   * Notify all visible-range observers if the visible range has changed.
   * Called internally by SheetView after layout recomputation (scroll,
   * resize, zoom, freeze pane changes). Not part of the public interface.
   */
  notifyVisibleRangeIfChanged(): void {
    if (this._visibleRangeListeners.size === 0) return;

    const bounds = this._internals.getVisibleBounds();
    const range: RangeAddress = {
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    };

    const prev = this._lastVisibleRange;
    if (
      prev &&
      prev.startRow === range.startRow &&
      prev.startCol === range.startCol &&
      prev.endRow === range.endRow &&
      prev.endCol === range.endCol
    ) {
      return; // No change — skip notification.
    }

    this._lastVisibleRange = range;
    for (const listener of this._visibleRangeListeners) {
      try {
        listener(range);
      } catch {
        // Swallow subscriber errors to avoid breaking the notification loop.
      }
    }
  }

  /** Remove all subscribers (called on dispose). */
  clearObservers(): void {
    this._visibleRangeListeners.clear();
    this._lastVisibleRange = null;
  }

  setScrollPosition(position: ScrollPosition, viewportId?: string): void {
    this._internals.setScrollPosition({ x: position.x, y: position.y }, viewportId);
  }

  getScrollPosition(viewportId?: string): ScrollPosition {
    const pos = this._internals.getScrollPosition(viewportId);
    return { x: pos.x, y: pos.y };
  }

  getAllScrollPositions(): ReadonlyMap<string, ScrollPosition> {
    const map = this._internals.getAllScrollPositions();
    const result = new Map<string, ScrollPosition>();
    for (const [k, v] of map) {
      result.set(k, { x: v.x, y: v.y });
    }
    return result;
  }

  setAllScrollPositions(positions: ReadonlyMap<string, ScrollPosition>): void {
    const map = new Map<string, { x: number; y: number }>();
    for (const [k, v] of positions) {
      map.set(k, { x: v.x, y: v.y });
    }
    this._internals.setAllScrollPositions(map);
  }

  setConfig(config: SheetViewportConfig): void {
    this._internals.setViewportConfig({ ...config });
  }

  getConfig(): SheetViewportConfig {
    return this._internals.getViewportConfig();
  }

  addOverlay(config: SheetOverlayViewportConfig): void {
    this._internals.addOverlayViewport(config);
  }

  removeOverlay(id: string): void {
    this._internals.removeOverlayViewport(id);
  }

  getLayout(): SheetViewportLayout | null {
    return this._internals.getViewportLayout();
  }

  observeVisibleRange(listener: (range: RangeAddress) => void): SheetDisposable {
    this._visibleRangeListeners.add(listener);
    return {
      dispose: () => {
        this._visibleRangeListeners.delete(listener);
      },
    };
  }

  setFrozenPanes(panes: FrozenPanesConfig): void {
    this._internals.setFrozenPanes(panes.rows, panes.cols);
  }

  getFrozenPanes(): FrozenPanesConfig {
    const panes = this._internals.getFrozenPanes();
    return { rows: panes.rows, cols: panes.cols };
  }

  setSplit(config: SplitConfig): void {
    this._internals.setViewportConfig({
      type: 'split',
      direction: config.direction,
      horizontalPosition: config.horizontalPosition,
      verticalPosition: config.verticalPosition,
    });
  }

  clearSplit(): void {
    this._internals.setViewportConfig({ type: 'single' });
  }

  getScrollBounds(): ScrollBounds {
    const sheetId = this._internals.getCurrentSheetId();
    const bounds = this._internals.getScrollBounds(sheetId);
    return { maxScrollX: bounds.maxScrollLeft, maxScrollY: bounds.maxScrollTop };
  }

  getSnapshot(): SheetViewportSnapshot {
    const scrollPositions = this.getAllScrollPositions();
    const visibleBounds = this._internals.getVisibleBounds();
    const frozenPanes = this.getFrozenPanes();
    const sheetId = this._internals.getCurrentSheetId();
    const zoom = this._internals.getZoom();
    const vpConfig = this._internals.getViewportConfig();

    let splitConfig: SplitConfig | null = null;
    if (vpConfig.type === 'split') {
      splitConfig = {
        direction: (vpConfig.direction as SplitConfig['direction']) ?? 'both',
        horizontalPosition: (vpConfig.horizontalPosition as number) ?? 0,
        verticalPosition: (vpConfig.verticalPosition as number) ?? 0,
      };
    }

    return {
      scrollPositions,
      visibleRange: {
        startRow: visibleBounds.startRow,
        startCol: visibleBounds.startCol,
        endRow: visibleBounds.endRow,
        endCol: visibleBounds.endCol,
      },
      frozenPanes,
      splitConfig,
      sheetId,
      zoom,
    };
  }

  getViewportState(): SheetViewportState {
    return this._internals.getViewportState();
  }

  clampScrollPosition(position: ScrollPosition, viewportId?: string): ScrollPosition {
    const clamped = this._internals.clampScrollPosition(position, viewportId);
    return { x: clamped.x, y: clamped.y };
  }

  getScrollToCell(cell: CellAddress): ScrollPosition | null {
    const sheetId = this._internals.getCurrentSheetId();
    const state = this._internals.getViewportState();
    const result = getLayoutAwareScrollToCell({
      sheetId,
      cell: { row: cell.row, col: cell.col },
      layout: this._internals.getViewportLayout() as ViewportLayout | null,
      positionIndex: this._internals.getPositionIndex(),
      frozenPanes: this._internals.getFrozenPanes(),
      currentScroll: this._internals.getScrollPosition('main'),
      maxScroll: state.maxScroll,
      getCellPageBounds: (row, col) => this._internals.getCellPageBounds(row, col),
      getCoordinateScrollTarget: (targetSheetId, targetCell) =>
        this._internals.getCoordinateScrollToCell(targetSheetId, targetCell),
    });
    if (!result) return null;
    return { x: result.x, y: result.y };
  }

  getViewportBounds(): SheetRect {
    const sheetId = this._internals.getCurrentSheetId();
    const bounds = this._internals.getViewportBounds(sheetId);
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }

  invalidateLayout(): void {
    this._internals.invalidateLayout();
  }
}

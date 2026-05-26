/**
 * Viewport Wiring
 *
 * Subscribes to WorkbookViewport change events, rebuilds VPI/VMI from the
 * ViewportReader when data arrives, and forwards dirty hints to the
 * RenderScheduler (the "Write = Invalidate" contract).
 *
 * Extracted from apps/spreadsheet/src/systems/renderer/execution/renderer-execution.ts:
 *   - populateIndicesFromViewport() (L255-317)
 *   - viewportEventUnsubscribe subscription (L525-607)
 */
import type { DirtyCellExpander } from '@mog/canvas-engine';
import type { ViewportMergeIndex, ViewportPositionIndex } from '@mog/grid-renderer';
import type { ViewportChangeEvent, ViewportReader, WorkbookViewport } from '@mog-sdk/contracts/api';
import type { RenderScheduler } from '@mog-sdk/contracts/rendering';

// =============================================================================
// VPI + VMI POPULATION FROM VIEWPORT READER
// =============================================================================

/**
 * Populate ViewportPositionIndex and ViewportMergeIndex from a ViewportReader.
 *
 * Position arrays come straight off the wire buffer — Rust's `LayoutIndex`
 * computed them in O(log n) at fetch time and shipped them inline. The TS
 * side simply hands the typed-array reference to the canvas index. The wire
 * carries `viewportRows + 1` / `viewportCols + 1` entries (with a trailing
 * sentinel for deriving the last row/col's height/width).
 */
export function populateIndicesFromViewport(
  vp: ViewportReader,
  vpi: ViewportPositionIndex,
  vmi: ViewportMergeIndex,
): void {
  const bounds = vp.getBounds();
  if (!bounds) return;

  const { startRow, startCol, endRow, endCol } = bounds;
  const rowCount = Math.max(0, endRow - startRow + 1);
  const colCount = Math.max(0, endCol - startCol + 1);

  // Hand off Rust's position arrays directly — no recomputation.
  // rowPositions and colPositions may arrive independently: a viewport
  // with zero visible columns still produces valid row positions that
  // we must persist (e.g. blank-doc autofit, wrap-text, large-font
  // scenarios all have rowPositions but colPositions === null on first
  // fetch). Guard only on rowPositions so VPI is populated whenever
  // at least the row layout is available; colPositions may be null.
  const rowPositions = vp.getRowPositions();
  const colPositions = vp.getColPositions();
  if (rowPositions) {
    vpi.setPositions(
      rowPositions,
      colPositions,
      startRow,
      startCol,
      rowCount,
      colCount,
      inferDefaultRowHeight(vp, startRow, endRow, rowPositions, rowCount),
      inferDefaultColWidth(vp, startCol, endCol, colPositions, colCount),
    );
  }

  // Populate hidden state from dimension records
  const hiddenRows = new Set<number>();
  const hiddenCols = new Set<number>();
  for (let r = startRow; r <= endRow; r++) {
    const dim = vp.getRowDimension(r);
    if (dim?.hidden) hiddenRows.add(r);
  }
  for (let c = startCol; c <= endCol; c++) {
    const dim = vp.getColDimension(c);
    if (dim?.hidden) hiddenCols.add(c);
  }
  vpi.setHiddenState(hiddenRows, hiddenCols);

  // Feed merge records
  const merges = vp.getMerges();
  vmi.setMerges(merges);
}

function inferDefaultRowHeight(
  vp: ViewportReader,
  startRow: number,
  endRow: number,
  rowPositions: Float64Array | null,
  rowCount: number,
): number | undefined {
  const fromDimensions = modeDimension(startRow, endRow, (row) => {
    const dim = vp.getRowDimension(row);
    return dim && !dim.hidden ? dim.height : null;
  });
  if (fromDimensions != null) return fromDimensions;
  return uniformDelta(rowPositions, rowCount);
}

function inferDefaultColWidth(
  vp: ViewportReader,
  startCol: number,
  endCol: number,
  colPositions: Float64Array | null,
  colCount: number,
): number | undefined {
  const fromDimensions = modeDimension(startCol, endCol, (col) => {
    const dim = vp.getColDimension(col);
    return dim && !dim.hidden ? dim.width : null;
  });
  if (fromDimensions != null) return fromDimensions;
  return uniformDelta(colPositions, colCount);
}

function modeDimension(
  start: number,
  end: number,
  read: (index: number) => number | null,
): number | undefined {
  const counts = new Map<number, { value: number; count: number }>();
  for (let index = start; index <= end; index++) {
    const value = read(index);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const key = Math.round(value * 1000);
    const entry = counts.get(key);
    if (entry) {
      entry.count++;
    } else {
      counts.set(key, { value, count: 1 });
    }
  }

  let best: { value: number; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.value;
}

function uniformDelta(positions: Float64Array | null, realCount: number): number | undefined {
  if (!positions || realCount <= 0 || positions.length < realCount + 1) return undefined;
  const first = positions[1] - positions[0];
  if (!Number.isFinite(first) || first <= 0) return undefined;
  for (let i = 1; i < realCount; i++) {
    const delta = positions[i + 1] - positions[i];
    if (Math.abs(delta - first) > 0.001) return undefined;
  }
  return first;
}

// =============================================================================
// VIEWPORT WIRING
// =============================================================================

/**
 * Dependencies for ViewportWiring.
 *
 * Owned by SheetView. ViewportWiring does not manage index or scheduler lifetimes —
 * it only subscribes to viewport events and routes dimension / cell patches into
 * these injected targets.
 */
export interface ViewportWiringDeps {
  /** Workbook viewport API (provides subscribe + setRenderScheduler). */
  workbookViewport: WorkbookViewport;
  /** Viewport reader to pull dimensions/merges from on fetch/dimension events. */
  getViewportReader: () => ViewportReader | null;
  /** Position index to rebuild on fetch-committed / dimensions-patched. */
  positionIndex: ViewportPositionIndex;
  /** Merge index to rebuild on fetch-committed / dimensions-patched. */
  mergeIndex: ViewportMergeIndex;
  /** Render scheduler to forward dirty marks to. */
  scheduler: RenderScheduler;
  /**
   * Optional scheduler extensions for dirty-rect expansion (position/merge indices
   * and cell expander). Wired once at connect time.
   */
  expandableScheduler?: {
    setPositionIndex?: (index: ViewportPositionIndex) => void;
    setMergeIndex?: (index: ViewportMergeIndex) => void;
    setCellExpander?: (expander: DirtyCellExpander) => void;
  };
  /** Optional cell expander from the renderer, wired into the expandable scheduler. */
  cellExpander?: DirtyCellExpander | null;
  /**
   * Called after viewport geometry has hydrated the sheet-level position/merge
   * indices. Frozen/split layouts depend on those indices for pane boundaries.
   */
  onViewportGeometryChanged?: () => void;
  /**
   * Called after the viewport reader has a new or pre-existing buffer snapshot.
   * Geometry consumers use VPI/VMI; cell rendering also needs the buffer's binary
   * readers pushed into the renderer data-source adapters.
   */
  onViewportBufferChanged?: () => void;
}

/**
 * ViewportWiring manages the subscription between the Workbook's viewport
 * coordinator and the render pipeline's VPI/VMI/scheduler.
 *
 * Call connect() once after the renderer is ready — this sets the render
 * scheduler on the workbook viewport, subscribes to events, and wires the
 * dirty-expansion pipeline. Call disconnect() on dispose.
 *
 * The subscription must exist BEFORE the first immediateViewportRefresh(),
 * otherwise the initial fetch-committed event will not trigger a VPI rebuild.
 */
export class ViewportWiring {
  private _deps: ViewportWiringDeps;
  private _unsubscribe: (() => void) | null = null;
  private _connected = false;

  constructor(deps: ViewportWiringDeps) {
    this._deps = deps;
  }

  /**
   * Connect the wiring: set scheduler on the viewport, subscribe to events,
   * and wire the dirty-expansion pipeline on the scheduler.
   */
  connect(): void {
    if (this._connected) return;
    this._connected = true;

    const {
      workbookViewport,
      getViewportReader,
      positionIndex,
      mergeIndex,
      scheduler,
      expandableScheduler,
      cellExpander,
      onViewportGeometryChanged,
      onViewportBufferChanged,
    } = this._deps;

    // Register scheduler with the workbook viewport coordinator.
    workbookViewport.setRenderScheduler(scheduler);

    // Subscribe to viewport events: fetch-committed, dimensions-patched,
    // cells-patched. These are the three events that drive invalidation.
    this._unsubscribe = workbookViewport.subscribe((event: ViewportChangeEvent) => {
      switch (event.type) {
        case 'fetch-committed': {
          // New base snapshot from Rust — rebuild position indices and merge index.
          const reader = getViewportReader();
          if (reader) {
            populateIndicesFromViewport(reader, positionIndex, mergeIndex);
            onViewportGeometryChanged?.();
          }
          onViewportBufferChanged?.();
          // Full buffer swap invalidates all layers — schedule full repaint.
          scheduler.markAllDirty();
          break;
        }
        case 'dimensions-patched': {
          // Row/col dimension changed — rebuild position indices.
          const reader = getViewportReader();
          if (reader) {
            populateIndicesFromViewport(reader, positionIndex, mergeIndex);
            onViewportGeometryChanged?.();
          }
          // Geometry changed — schedule geometry-level repaint.
          scheduler.markGeometryDirty();
          break;
        }
        case 'cells-patched': {
          // No VPI rebuild needed. Schedule cell-level dirty marking.
          scheduler.markCellsDirty(event.cells.length > 0 ? event.cells : undefined);
          break;
        }
      }
    });

    // Wire dirty-expansion pipeline dependencies onto the scheduler (if it supports
    // them). These are optional extension points used by the expanded-dirty-rect
    // optimisation; a bare RenderScheduler does not need them.
    if (expandableScheduler) {
      expandableScheduler.setPositionIndex?.(positionIndex);
      expandableScheduler.setMergeIndex?.(mergeIndex);
      if (cellExpander) {
        expandableScheduler.setCellExpander?.(cellExpander);
      }
    }

    // Eagerly populate indices if the viewport reader already has data.
    // When multiple SheetViews share the same workbook (e.g. a sheet-slice
    // preview alongside the main view), they share viewport coordinator state.
    // The second view's region refresh may be skipped by the prefetch
    // containment check (the main view already fetched the range), so no
    // fetch-committed event fires and the VPI stays empty. Populating here
    // from the existing buffer avoids that race.
    const reader = getViewportReader();
    if (reader && reader.getBounds()) {
      populateIndicesFromViewport(reader, positionIndex, mergeIndex);
      onViewportGeometryChanged?.();
      onViewportBufferChanged?.();
    }
  }

  /** Disconnect the subscription. Safe to call multiple times. */
  disconnect(): void {
    if (!this._connected) return;
    this._connected = false;
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}

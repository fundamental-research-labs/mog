/**
 * Viewport Buffer Inspector
 *
 * Inspects viewport buffer state by reaching through window.__SHELL__
 * with zero instrumentation in kernel code.
 *
 * Access path:
 *   window.__SHELL__.store.getState().activeFileId → active file ID
 *   window.__SHELL__.documentManager.getDocument(fileId) → DocumentHandle
 *   handle.context.computeBridge → ComputeBridge
 */

const STYLES = {
  header: 'font-weight: bold; font-size: 12px;',
  dim: 'color: #888;',
  viewport: 'color: #61afef; font-weight: bold;',
  value: 'color: #98c379;',
  warning: 'color: #e5c07b;',
  error: 'color: #e06c75; font-weight: bold;',
  label: 'color: #56b6c2;',
} as const;

/**
 * Normalize devtools format readbacks to the product `CellFormat` keys while
 * preserving compatibility aliases that existing probes use.
 */
export function normalizeCellFormatReadback(
  format: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!format || typeof format !== 'object') return null;
  const normalized = { ...format };

  if ('backgroundColor' in normalized && !('fillColor' in normalized)) {
    normalized.fillColor = normalized.backgroundColor;
  } else if ('fillColor' in normalized && !('backgroundColor' in normalized)) {
    normalized.backgroundColor = normalized.fillColor;
  }

  if ('horizontalAlign' in normalized && !('horizontalAlignment' in normalized)) {
    normalized.horizontalAlignment = normalized.horizontalAlign;
  } else if ('horizontalAlignment' in normalized && !('horizontalAlign' in normalized)) {
    normalized.horizontalAlign = normalized.horizontalAlignment;
  }

  if ('verticalAlign' in normalized && !('verticalAlignment' in normalized)) {
    normalized.verticalAlignment = normalized.verticalAlign;
  } else if ('verticalAlignment' in normalized && !('verticalAlign' in normalized)) {
    normalized.verticalAlign = normalized.verticalAlignment;
  }

  return normalized;
}

/**
 * Helper to reach the compute bridge from window.__SHELL__.
 * Returns null if shell/doc not available.
 */
export function getActiveComputeBridge(): any | null {
  const shell = (window as any).__SHELL__;
  if (!shell) return null;

  const state = shell.store?.getState?.();
  if (!state) return null;

  const fileId = state.activeFileId;
  if (!fileId) return null;

  const handle = shell.documentManager?.getDocument?.(fileId);
  if (!handle) return null;

  return (handle as any).context?.computeBridge ?? null;
}

/**
 * Pretty-prints all viewport states.
 * Intended as the `__dt.viewport()` command.
 */
export function printViewportSummary(): void {
  const bridge = getActiveComputeBridge();
  if (!bridge) {
    console.log(
      '%c[viewport] %cNo active shell or compute bridge found. Is a document open?',
      STYLES.error,
      STYLES.dim,
    );
    return;
  }

  const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
  if (!states || states.size === 0) {
    console.log('%c[viewport] %cNo viewport states registered.', STYLES.warning, STYLES.dim);
    return;
  }

  console.log('%c Viewport Buffer Summary ', STYLES.header);
  console.log('%c%d viewport(s) registered', STYLES.dim, states.size);
  console.log('');

  for (const [id, vpState] of states) {
    const buf = vpState?.buffer;
    const hasBuffer = buf?.hasBuffer?.() ?? false;

    console.groupCollapsed(
      '%c%s %c(%s)',
      STYLES.viewport,
      id,
      STYLES.dim,
      hasBuffer ? 'buffered' : 'no buffer',
    );

    console.log(
      '%cscrollBehavior: %c%s',
      STYLES.label,
      STYLES.value,
      vpState?.scrollBehavior ?? 'unknown',
    );

    if (hasBuffer) {
      const startRow = buf.getStartRow?.() ?? '?';
      const startCol = buf.getStartCol?.() ?? '?';
      const rows = buf.getRows?.() ?? '?';
      const cols = buf.getCols?.() ?? '?';
      const cellCount = buf.getCellCount?.() ?? '?';
      const generation = buf.getGeneration?.() ?? '?';

      console.log('%cbuffer:', STYLES.label);
      console.log('  cellCount: %c%s', STYLES.value, cellCount);
      console.log(
        '  bounds: [%d, %d] → [%d, %d] (%d rows x %d cols)',
        startRow,
        startCol,
        startRow + rows - 1,
        startCol + cols - 1,
        rows,
        cols,
      );
      console.log('  generation: %c%s', STYLES.value, generation);
    } else {
      console.log('%cbuffer: %cnone', STYLES.label, STYLES.dim);
    }

    const prefetch = vpState?.prefetchBounds;
    if (prefetch) {
      console.log('%cprefetchBounds: %c%s', STYLES.label, STYLES.value, JSON.stringify(prefetch));
    }

    const lastVisible = vpState?.lastVisibleBounds;
    if (lastVisible) {
      console.log(
        '%clastVisibleBounds: %c%s',
        STYLES.label,
        STYLES.value,
        JSON.stringify(lastVisible),
      );
    }

    const dirtyState = vpState?.prefetchDirtyState;
    if (dirtyState !== undefined) {
      console.log('%cprefetchDirtyState: %c%s', STYLES.label, STYLES.value, String(dirtyState));
    }

    console.groupEnd();
  }
}

/**
 * Shows detailed info for one viewport including sample cells.
 * Intended as `__dt.viewport('main')`.
 */
export function printViewportDetail(viewportId: string): void {
  const bridge = getActiveComputeBridge();
  if (!bridge) {
    console.log(
      '%c[viewport] %cNo active shell or compute bridge found.',
      STYLES.error,
      STYLES.dim,
    );
    return;
  }

  const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
  const vpState = states?.get(viewportId);
  if (!vpState) {
    console.log(
      '%c[viewport] %cViewport "%s" not found. Available: %s',
      STYLES.error,
      STYLES.dim,
      viewportId,
      states ? Array.from(states.keys()).join(', ') : 'none',
    );
    return;
  }

  const buf = bridge.getViewportBuffer?.(viewportId);
  const hasBuffer = buf?.hasBuffer?.() ?? false;

  console.log('%c Viewport Detail: %s ', STYLES.header, viewportId);
  console.log('');

  console.log(
    '%cscrollBehavior: %c%s',
    STYLES.label,
    STYLES.value,
    vpState.scrollBehavior ?? 'unknown',
  );

  if (hasBuffer) {
    const startRow = buf.getStartRow?.() ?? 0;
    const startCol = buf.getStartCol?.() ?? 0;
    const rows = buf.getRows?.() ?? 0;
    const cols = buf.getCols?.() ?? 0;
    const cellCount = buf.getCellCount?.() ?? 0;
    const generation = buf.getGeneration?.() ?? 0;

    console.log('%cbuffer:', STYLES.label);
    console.log('  cellCount: %c%d', STYLES.value, cellCount);
    console.log(
      '  bounds: [%d, %d] → [%d, %d] (%d rows x %d cols)',
      startRow,
      startCol,
      startRow + rows - 1,
      startCol + cols - 1,
      rows,
      cols,
    );
    console.log('  generation: %c%d', STYLES.value, generation);

    // Sample cells: 5x5 grid from buffer start
    const accessor = bridge.getAccessorForViewport?.(viewportId);
    if (accessor) {
      console.log('');
      console.log('%cSample cells (5x5 from buffer start):', STYLES.label);

      const sampleRows = Math.min(5, rows);
      const sampleCols = Math.min(5, cols);
      const grid: string[][] = [];

      for (let r = 0; r < sampleRows; r++) {
        const row: string[] = [];
        for (let c = 0; c < sampleCols; c++) {
          const exists = accessor.moveTo?.(startRow + r, startCol + c);
          if (exists) {
            const vt = accessor.valueType ?? '?';
            const dt = accessor.displayText ?? '';
            row.push(`${vt}:${dt}`);
          } else {
            row.push('(empty)');
          }
        }
        grid.push(row);
      }

      console.table(grid);
    } else {
      console.log('%cNo cell accessor available for this viewport.', STYLES.dim);
    }
  } else {
    console.log('%cbuffer: %cnone', STYLES.label, STYLES.dim);
  }

  const prefetch = vpState.prefetchBounds;
  if (prefetch) {
    console.log('%cprefetchBounds: %c%s', STYLES.label, STYLES.value, JSON.stringify(prefetch));
  }

  const lastVisible = vpState.lastVisibleBounds;
  if (lastVisible) {
    console.log(
      '%clastVisibleBounds: %c%s',
      STYLES.label,
      STYLES.value,
      JSON.stringify(lastVisible),
    );
  }

  const dirtyState = vpState.prefetchDirtyState;
  if (dirtyState !== undefined) {
    console.log('%cprefetchDirtyState: %c%s', STYLES.label, STYLES.value, String(dirtyState));
  }
}

/**
 * Reads a single cell's format from the viewport buffer programmatically.
 * Returns the CellFormat object or null if the cell/viewport isn't available.
 */
export function readCellFormat(
  row: number,
  col: number,
  viewportId?: string,
): Record<string, unknown> | null {
  const bridge = getActiveComputeBridge();
  if (!bridge) return null;

  const tryRead = (vpId: string): Record<string, unknown> | null => {
    const accessor = bridge.getAccessorForViewport?.(vpId);
    if (!accessor) return null;
    const exists = accessor.moveTo?.(row, col);
    if (!exists) return null;
    const fmt = accessor.format;
    if (!fmt) return null;
    // Deep-copy to avoid returning a live proxy/reference
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(JSON.stringify(fmt));
    } catch {
      return null;
    }
    // Merge conditional-formatting overrides from the CF layer.
    // The viewport buffer accessor exposes getBgColorOverride() / getFontColorOverride()
    // which return the resolved CF fill/font color for the current cell (or null).
    const bgOverride = accessor.getBgColorOverride?.() ?? null;
    const fontOverride = accessor.getFontColorOverride?.() ?? null;
    if (bgOverride) {
      result.backgroundColor = bgOverride;
      result.fillColor = bgOverride;
    }
    if (fontOverride) {
      result.fontColor = fontOverride;
    }
    return normalizeCellFormatReadback(result);
  };

  if (viewportId) return tryRead(viewportId);

  const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
  if (!states) return null;
  for (const [vpId] of states) {
    const result = tryRead(vpId);
    if (result) return result;
  }
  return null;
}

/**
 * Returns the data-bar fill ratio (0..1) for a cell, or null if the cell
 * has no data-bar CF rule applied.
 *
 * The viewport binary encodes data-bar fill as a fillPercent (0..100);
 * this helper normalises it to the 0..1 range used by test assertions.
 */
export function readDataBarRatio(row: number, col: number, viewportId?: string): number | null {
  const bridge = getActiveComputeBridge();
  if (!bridge) return null;

  const tryRead = (vpId: string): number | null => {
    const accessor = bridge.getAccessorForViewport?.(vpId);
    if (!accessor) return null;
    const exists = accessor.moveTo?.(row, col);
    if (!exists) return null;
    const db = accessor.getDataBar?.();
    if (!db) return null;
    return db.fillPercent / 100;
  };

  if (viewportId) return tryRead(viewportId);

  const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
  if (!states) return null;
  for (const [vpId] of states) {
    const result = tryRead(vpId);
    if (result !== null) return result;
  }
  return null;
}

/**
 * Infer the number of icons in an icon set from its display name (e.g. "3Arrows" → 3).
 * Falls back to 3 when the leading digit cannot be parsed.
 */
function iconSetSize(setName: string): number {
  const n = parseInt(setName.charAt(0), 10);
  return Number.isFinite(n) && n >= 3 ? n : 3;
}

/**
 * Returns the icon-set bucket index (0-based) for a cell, or null if the
 * cell has no icon-set CF rule applied.
 *
 * Convention: bucket 0 = worst/lowest value, bucket (N-1) = best/highest.
 * This matches Excel's display order ("red down arrow" = bucket 0 for 3Arrows).
 *
 * The viewport binary stores iconIndex in reverse order (iconIndex 0 = first
 * icon in the set = "up arrow / best" for 3Arrows). We reverse here so callers
 * always receive a semantically-ordered bucket where 0 = worst.
 */
export function readIconBucket(row: number, col: number, viewportId?: string): number | null {
  const bridge = getActiveComputeBridge();
  if (!bridge) return null;

  const tryRead = (vpId: string): number | null => {
    const accessor = bridge.getAccessorForViewport?.(vpId);
    if (!accessor) return null;
    const exists = accessor.moveTo?.(row, col);
    if (!exists) return null;
    const icon = accessor.getIcon?.();
    if (!icon) return null;
    // Reverse so bucket 0 = worst (lowest rank), bucket N-1 = best (highest rank).
    const numBuckets = iconSetSize(icon.setName);
    return numBuckets - 1 - icon.iconIndex;
  };

  if (viewportId) return tryRead(viewportId);

  const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
  if (!states) return null;
  for (const [vpId] of states) {
    const result = tryRead(vpId);
    if (result !== null) return result;
  }
  return null;
}

/**
 * Resolve the active worksheet's sheet ID without reaching into `__SHELL__`.
 * The coordinator's workbook surface is the public façade used by the rest of
 * the app and is the right path for harness-level introspection.
 *
 * Returns null when no document is open.
 */
function getActiveSheetId(): string | null {
  try {
    const coord = (window as any).__COORDINATOR__;
    const ws = coord?.workbook?.activeSheet;
    return ws?.sheetId ?? ws?.id ?? null;
  } catch {
    return null;
  }
}

type NormalizedMergeRegion = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

function readNumericField(input: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeMergeRegion(region: unknown): NormalizedMergeRegion | null {
  if (!region || typeof region !== 'object') return null;
  const record = region as Record<string, unknown>;
  const startRow = readNumericField(record, ['startRow', 'start_row', 'row', 'anchorRow']);
  const startCol = readNumericField(record, ['startCol', 'start_col', 'col', 'anchorCol']);
  const endRow = readNumericField(record, ['endRow', 'end_row']);
  const endCol = readNumericField(record, ['endCol', 'end_col']);
  if (startRow === null || startCol === null || endRow === null || endCol === null) return null;
  return {
    startRow: Math.min(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endRow: Math.max(startRow, endRow),
    endCol: Math.max(startCol, endCol),
  };
}

function isCoveredCell(row: number, col: number, region: NormalizedMergeRegion | null): boolean {
  if (!region) return false;
  const inside =
    row >= region.startRow &&
    row <= region.endRow &&
    col >= region.startCol &&
    col <= region.endCol;
  return inside && (row !== region.startRow || col !== region.startCol);
}

function readRenderedMergeRegion(row: number, col: number): NormalizedMergeRegion | null {
  try {
    const coord = (window as any).__COORDINATOR__;
    const geometry = coord?.renderer?.getGeometry?.();
    return normalizeMergeRegion(geometry?.getMergeAnchor?.(row, col));
  } catch {
    return null;
  }
}

async function readBridgeMergeRegions(
  bridge: any,
  sheetId: string,
): Promise<NormalizedMergeRegion[]> {
  if (typeof bridge?.getAllMergesInSheet !== 'function') return [];
  try {
    const regions = await bridge.getAllMergesInSheet(sheetId);
    if (!Array.isArray(regions)) return [];
    return regions
      .map(normalizeMergeRegion)
      .filter((region): region is NormalizedMergeRegion => Boolean(region));
  } catch {
    return [];
  }
}

function emptyCellReadback(
  row: number,
  col: number,
  viewportId: string,
): import('../types').ProgrammaticCellValue {
  return {
    row,
    col,
    viewportId,
    displayText: null,
    valueType: 0,
    hasFormula: false,
    errorText: null,
  };
}

/**
 * Read a batch of cells via the compute bridge — the same path
 * production code uses for out-of-viewport range queries
 * (see kernel/src/api/worksheet/operations/range-query-operations.ts).
 *
 * Unlike `readCellValue`, this does NOT depend on the rendered viewport
 * buffer, so it works for cells outside the canvas (stress-perf scenarios
 * spot-check rows in the thousands, but the viewport only covers ~34 rows
 * at default zoom).
 *
 * Strategy:
 *  - For each requested cell, call `bridge.queryRange(sheetId, r, c, r, c)`
 *    in parallel. `queryRange` is sparse — it returns only non-empty
 *    cells — so issuing per-cell queries avoids reading the bounding
 *    rectangle (which can be ~10,000 rows tall in stress tests).
 *  - Build a `ProgrammaticCellValue` for every request, including those
 *    that came back empty (so callers can distinguish "cell was queried
 *    and is empty" from "cell was not queried"). Empty cells get
 *    `displayText: null` and `valueType: 0` (Empty).
 *
 * Resolves with an empty record when no compute bridge or active sheet is
 * available — same best-effort contract as `readCellValue`.
 */
export async function readCellsViaBridge(
  cells: ReadonlyArray<{ row: number; col: number }>,
): Promise<Record<string, import('../types').ProgrammaticCellValue>> {
  const out: Record<string, import('../types').ProgrammaticCellValue> = {};
  if (cells.length === 0) return out;

  const bridge = getActiveComputeBridge();
  if (!bridge?.queryRange) return out;

  const sheetId = getActiveSheetId();
  if (!sheetId) return out;
  const mergeRegions = await readBridgeMergeRegions(bridge, sheetId);

  // Issue one queryRange per requested cell, in parallel. Each call is sparse
  // (the result array is empty when the cell holds no value), so even very
  // distant cells (e.g. (0,0) and (9999,0)) cost two single-cell IPC reads
  // rather than a 10k-row bounding-rectangle scan.
  const settled = await Promise.all(
    cells.map(async ({ row, col }) => {
      try {
        const result = await bridge.queryRange(sheetId, row, col, row, col);
        const cell = result?.cells?.find?.(
          (c: { row: number; col: number }) => c.row === row && c.col === col,
        );
        return { row, col, cell };
      } catch {
        return { row, col, cell: undefined };
      }
    }),
  );

  for (const { row, col, cell } of settled) {
    if (mergeRegions.some((region) => isCoveredCell(row, col, region))) {
      out[`${row},${col}`] = emptyCellReadback(row, col, '__bridge__');
      continue;
    }

    const formatted: string | null =
      typeof cell?.formatted === 'string' && cell.formatted !== '' ? cell.formatted : null;
    const formula: string | undefined =
      typeof cell?.formula === 'string' && cell.formula.length > 0 ? cell.formula : undefined;

    // Map RangeCellData.value (CellValue: string | number | boolean | null |
    // {type:'error', value, message}) to a ProgrammaticCellValue numberValue /
    // valueType. The viewport-buffer flavor of valueType is a numeric enum
    // populated by the binary-buffer encoder; here we approximate it from the
    // CellValue shape so that consumers that switch on valueType continue to
    // work (Empty=0, Number=1, String=2, Bool=3, Error=4 — same conventions
    // used by readCellValue / the binary palette).
    const raw: unknown = cell?.value;
    let valueType = 0;
    let numberValue: number | undefined;
    let errorText: string | null = null;
    if (typeof raw === 'number') {
      valueType = 1;
      numberValue = raw;
    } else if (typeof raw === 'string') {
      valueType = 2;
    } else if (typeof raw === 'boolean') {
      valueType = 3;
    } else if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'error') {
      valueType = 4;
      const ev = raw as { value?: unknown; message?: unknown };
      errorText =
        (typeof ev.value === 'string' && ev.value) ||
        (typeof ev.message === 'string' && ev.message) ||
        formatted ||
        null;
    }

    out[`${row},${col}`] = {
      row,
      col,
      viewportId: '__bridge__',
      displayText: formatted,
      valueType,
      numberValue,
      hasFormula: formula !== undefined,
      formula,
      errorText,
    };
  }

  return out;
}

/**
 * Read the resolved numberFormat for a batch of cells via the compute
 * bridge. The viewport-binary palette only carries `numberFormat` when it
 * changes the rendered text — formats like `"@"` on numeric values are
 * omitted. The capture step uses this to fill those gaps so assertions
 * that read `cell.format.numberFormat` always see the kernel's source of
 * truth, not the binary-palette omission.
 *
 * Returns a map keyed by `"row,col"`. Cells with no resolved numberFormat
 * are omitted.
 */
export async function readResolvedNumberFormats(
  cells: ReadonlyArray<{ row: number; col: number }>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (cells.length === 0) return out;

  const bridge = getActiveComputeBridge();
  if (!bridge?.getResolvedFormat) return out;

  const sheetId = getActiveSheetId();
  if (!sheetId) return out;

  await Promise.all(
    cells.map(async ({ row, col }) => {
      try {
        const fmt = await bridge.getResolvedFormat(sheetId, row, col);
        const nf = (fmt as { numberFormat?: unknown } | null)?.numberFormat;
        if (typeof nf === 'string' && nf.length > 0) {
          out[`${row},${col}`] = nf;
        }
      } catch {
        // best-effort
      }
    }),
  );

  return out;
}

/**
 * Read displayed format properties for a batch of cells via the compute bridge.
 * Out-of-viewport cells are supported because `getDisplayedRangeProperties`
 * runs through Rust without depending on the rendered binary buffer.
 * Results use the same normalized readback contract as `readCellFormat`.
 *
 * Returns a map keyed by `"row,col"`. Cells with no displayed properties
 * (e.g. no CF rule fires) are omitted.
 *
 * Strategy:
 *  - One `getDisplayedRangeProperties` call over the bounding rectangle of
 *    all requested cells when that rectangle is inside the bridge limit.
 *    Sparse scale-format checks can span hundreds of thousands of rows, so
 *    larger rectangles go straight to per-cell `getDisplayedCellProperties`.
 */
export async function readDisplayedFormatsViaBridge(
  cells: ReadonlyArray<{ row: number; col: number }>,
): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (cells.length === 0) return out;

  const bridge = getActiveComputeBridge();
  if (!bridge) return out;

  const sheetId = getActiveSheetId();
  if (!sheetId) return out;

  const uniqueCells = Array.from(
    new Map(cells.map((cell) => [`${cell.row},${cell.col}`, cell])).values(),
  );

  // Range pre-fetch (single bridge call) for dense batches only.
  if (typeof bridge.getDisplayedRangeProperties === 'function') {
    try {
      const minRow = Math.min(...uniqueCells.map((c) => c.row));
      const maxRow = Math.max(...uniqueCells.map((c) => c.row));
      const minCol = Math.min(...uniqueCells.map((c) => c.col));
      const maxCol = Math.max(...uniqueCells.map((c) => c.col));
      const cellCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
      if (cellCount <= 10_000) {
        const rangeFormats = await bridge.getDisplayedRangeProperties(
          sheetId,
          minRow,
          minCol,
          maxRow,
          maxCol,
        );
        if (Array.isArray(rangeFormats)) {
          for (let ri = 0; ri < rangeFormats.length; ri++) {
            const rowFmts = rangeFormats[ri];
            if (!Array.isArray(rowFmts)) continue;
            for (let ci = 0; ci < rowFmts.length; ci++) {
              const fmt = rowFmts[ci];
              const normalized = normalizeCellFormatReadback(fmt);
              if (normalized) {
                out[`${minRow + ri},${minCol + ci}`] = normalized;
              }
            }
          }
        }
      }
    } catch {
      // best-effort — fall through to per-cell calls
    }
  }

  // Per-cell fallback for any requested cell that the range read missed.
  if (typeof bridge.getDisplayedCellProperties === 'function') {
    await Promise.all(
      uniqueCells.map(async ({ row, col }) => {
        const key = `${row},${col}`;
        if (out[key]) return;
        try {
          const fmt = await bridge.getDisplayedCellProperties(sheetId, row, col);
          const normalized = normalizeCellFormatReadback(fmt);
          if (normalized) out[key] = normalized;
        } catch {
          // best-effort
        }
      }),
    );
  }

  return out;
}

function shouldMaskLinkedUnlabeledCheckboxDisplay(
  row: number,
  col: number,
  cell: { valueType?: unknown; displayText?: unknown },
): boolean {
  if (typeof document === 'undefined') return false;

  const selector = [
    '[data-form-control-type="checkbox"]',
    `[data-form-control-linked-row="${row}"]`,
    `[data-form-control-linked-col="${col}"]`,
  ].join('');
  const wrapper = document.querySelector<HTMLElement>(selector);
  if (!wrapper) return false;

  const overlay = wrapper.querySelector<HTMLElement>('[data-testid^="form-control-checkbox-"]');
  if (!overlay) return false;

  if ((overlay.textContent ?? '').trim().length > 0) return false;

  if (cell.valueType === 3) return true;
  const displayText =
    typeof cell.displayText === 'string' ? cell.displayText.trim().toUpperCase() : '';
  return displayText === 'TRUE' || displayText === 'FALSE';
}

/**
 * Reads a single cell value from the viewport buffer programmatically.
 * Returns structured data instead of printing.
 */
export function readCellValue(
  row: number,
  col: number,
  viewportId?: string,
): import('../types').ProgrammaticCellValue | null {
  const bridge = getActiveComputeBridge();
  if (!bridge) return null;

  const tryRead = (vpId: string): import('../types').ProgrammaticCellValue | null => {
    const accessor = bridge.getAccessorForViewport?.(vpId);
    if (!accessor) return null;
    const exists = accessor.moveTo?.(row, col);
    if (!exists) return null;
    const mergeRegion =
      readRenderedMergeRegion(row, col) ??
      normalizeMergeRegion(
        accessor.mergeBounds ?? accessor.mergeRegion ?? accessor.mergedRegion ?? null,
      );
    if (isCoveredCell(row, col, mergeRegion)) return emptyCellReadback(row, col, vpId);
    const displayText = shouldMaskLinkedUnlabeledCheckboxDisplay(row, col, accessor)
      ? ''
      : (accessor.displayText ?? null);
    return {
      row,
      col,
      viewportId: vpId,
      displayText,
      valueType: accessor.valueType ?? 0,
      numberValue: accessor.numberValue,
      hasFormula: accessor.hasFormula,
      errorText: accessor.errorText ?? null,
    };
  };

  if (viewportId) return tryRead(viewportId);

  const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
  if (!states) return null;
  // Restrict the search to viewports belonging to the active sheet. Viewport
  // IDs are sheet-scoped ("main:<sheetId>"), and a stale coordinator for a
  // previously-viewed sheet can linger in this map after a sheet switch — its
  // TS-side teardown is async (an awaited IPC round-trip) and races the next
  // read. Without this filter the loop returns that stale sheet's cell: e.g.
  // reading Sheet1 A1 right after switching from Sheet2 yields Sheet2's value,
  // because the Sheet2 coordinator was inserted first. Mirrors the sheet-scoped
  // resolution in kernel viewport-reader.ts (`binaryCellReader`). When the
  // active sheet can't be resolved (no open document), fall back to the prior
  // any-viewport behavior.
  const activeSheetId = getActiveSheetId();
  for (const [vpId] of states) {
    if (activeSheetId && !vpId.endsWith(':' + activeSheetId)) continue;
    const result = tryRead(vpId);
    if (result) return result;
  }
  return null;
}

/**
 * Reads a single cell from the viewport buffer and prints all properties.
 * Intended as `__dt.cell(row, col)`.
 *
 * If viewportId is provided, uses that viewport's accessor.
 * Otherwise tries all viewports until one contains the cell.
 */
export function printViewportCell(row: number, col: number, viewportId?: string): void {
  const bridge = getActiveComputeBridge();
  if (!bridge) {
    console.log('%c[cell] %cNo active shell or compute bridge found.', STYLES.error, STYLES.dim);
    return;
  }

  const tryAccessor = (vpId: string): boolean => {
    const accessor = bridge.getAccessorForViewport?.(vpId);
    if (!accessor) return false;

    const exists = accessor.moveTo?.(row, col);
    if (!exists) return false;

    console.log(
      '%c Cell [%d, %d] %cfrom viewport %c%s',
      STYLES.header,
      row,
      col,
      STYLES.dim,
      STYLES.viewport,
      vpId,
    );
    console.log('');
    console.log(
      '%cvalueType:   %c%s',
      STYLES.label,
      STYLES.value,
      accessor.valueType ?? 'undefined',
    );
    console.log(
      '%cnumberValue: %c%s',
      STYLES.label,
      STYLES.value,
      accessor.numberValue ?? 'undefined',
    );
    console.log(
      '%cdisplayText: %c%s',
      STYLES.label,
      STYLES.value,
      accessor.displayText ?? 'undefined',
    );
    console.log(
      '%chasFormula:  %c%s',
      STYLES.label,
      STYLES.value,
      accessor.hasFormula ?? 'undefined',
    );
    console.log('%cformat:      %c%s', STYLES.label, STYLES.value, accessor.format ?? 'undefined');
    console.log('%cflags:       %c%s', STYLES.label, STYLES.value, accessor.flags ?? 'undefined');
    console.log(
      '%cerrorText:   %c%s',
      STYLES.label,
      STYLES.value,
      accessor.errorText ?? 'undefined',
    );

    return true;
  };

  if (viewportId) {
    if (!tryAccessor(viewportId)) {
      console.log(
        '%c[cell] %cCell [%d, %d] not found in viewport "%s".',
        STYLES.warning,
        STYLES.dim,
        row,
        col,
        viewportId,
      );
    }
    return;
  }

  // Try all viewports
  const states: ReadonlyMap<string, any> | undefined = bridge.getPerViewportStates?.();
  if (!states || states.size === 0) {
    console.log('%c[cell] %cNo viewports registered.', STYLES.warning, STYLES.dim);
    return;
  }

  for (const [vpId] of states) {
    if (tryAccessor(vpId)) return;
  }

  console.log(
    '%c[cell] %cCell [%d, %d] not found in any viewport buffer.',
    STYLES.warning,
    STYLES.dim,
    row,
    col,
  );
}

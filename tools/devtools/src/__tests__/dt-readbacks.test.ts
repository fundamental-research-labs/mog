/**
 * `__dt` rendered-state readback gate.
 *
 * These tests validate the four readbacks added to the console API:
 *
 *   - `getRenderedDrawings(sheetId?)`
 *   - `getRenderedRowHeight(sheet, row)`
 *   - `getRenderedColWidth(sheet, col)`
 *   - `getCanvasSnapshot(region?)`
 *
 * The contract specifies that each one observes user-visible rendered
 * state — the scene graph (drawing layer) and the grid renderer's
 * `getCellPageBounds` (canvas geometry). A kernel-side readback would
 * collapse the api-eval / app-eval boundary, so the tests build minimal
 * fakes for the scene graph + coordinator and assert that the readbacks
 * route through them rather than through any kernel API.
 *
 * Run via: `bun test tools/devtools/src/__tests__/dt-readbacks.test.ts`.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createConsoleAPI } from '../console/api';
import { EventStore } from '../event-store';
import { ActorRecorder } from '../recorders/actor-recorder';
import type { DevToolsConsoleAPI } from '../types';

// ── Fixture: one drawing + one custom row height ──

interface FakeSceneObject {
  id: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  zIndex: number;
  visible: boolean;
  groupId: string | null;
  rotation?: number;
  data?: {
    src?: string;
    chartId?: string;
    wordArt?: unknown;
    chartType?: string;
    dataRange?: string;
    sourceRange?: string;
  };
}

function makeSceneGraph(objects: FakeSceneObject[]) {
  return {
    getByZOrder() {
      return [...objects].sort((a, b) => a.zIndex - b.zIndex);
    },
  };
}

function makeRenderer(
  rowHeights: Record<number, number>,
  colWidths: Record<number, number>,
  opts: { coordinateDocumentPixelToCell?: boolean } = {},
) {
  const visibleRows = Object.keys(rowHeights)
    .map(Number)
    .sort((a, b) => a - b);
  const visibleCols = Object.keys(colWidths)
    .map(Number)
    .sort((a, b) => a - b);
  const visibleRange = {
    startRow: visibleRows[0] ?? 0,
    endRow: visibleRows[visibleRows.length - 1] ?? 0,
    startCol: visibleCols[0] ?? 0,
    endCol: visibleCols[visibleCols.length - 1] ?? 0,
  };

  return {
    getRenderer() {
      return {
        getCellPageBounds(row: number, col: number) {
          const h = rowHeights[row];
          const w = colWidths[col];
          if (h == null || w == null) return null;
          return { x: 0, y: 0, width: w, height: h };
        },
        getCoordinateSystem() {
          return {
            getVisibleRange() {
              return visibleRange;
            },
          };
        },
        getViewportLayout() {
          return {
            viewports: [{ id: 'main:sheet-1', cellRange: visibleRange }],
          };
        },
      };
    },
    getCoordinateSystem() {
      // Provide a minimal documentPixelToCell so safeCellSnap can resolve.
      return {
        getVisibleRange() {
          return visibleRange;
        },
        ...(opts.coordinateDocumentPixelToCell === false
          ? {}
          : {
              documentPixelToCell(x: number, y: number) {
                // 100px-wide columns, 24px tall rows for the test fixture.
                return { row: Math.floor(y / 24), col: Math.floor(x / 100) };
              },
            }),
      };
    },
  };
}

interface RuntimeBundle {
  api: DevToolsConsoleAPI;
  cleanup: () => void;
}

function setupRuntime(opts: {
  drawings: FakeSceneObject[];
  rowHeights: Record<number, number>;
  colWidths: Record<number, number>;
  bridgeColPositions?: Record<number, number>;
  coordinateDocumentPixelToCell?: boolean;
  renderedCellSizes?: Record<string, { width: number; height: number }>;
  charts?: Array<Record<string, unknown>>;
  viewportCells?: Record<
    string,
    {
      displayText?: string | null;
      valueType?: number;
      numberValue?: number;
      hasFormula?: boolean;
      errorText?: string | null;
    }
  >;
  bridgeCells?: Record<
    string,
    {
      formatted?: string | null;
      value?: unknown;
      formula?: string;
    }
  >;
  merges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
}): RuntimeBundle {
  const g = globalThis as { window?: Record<string, unknown>; document?: unknown };

  const sceneGraph = makeSceneGraph(opts.drawings);
  const viewportId = 'main:sheet-1';
  const computeBridge: Record<string, unknown> = {};
  if (opts.bridgeColPositions) {
    computeBridge.getColPosition = async (_sheetId: string, col: number) =>
      opts.bridgeColPositions?.[col] ?? 0;
  }
  if (opts.viewportCells) {
    computeBridge.getPerViewportStates = () => new Map([[viewportId, {}]]);
    computeBridge.getAccessorForViewport = (id: string) => {
      if (id !== viewportId) return null;
      let current:
        | {
            displayText?: string | null;
            valueType?: number;
            numberValue?: number;
            hasFormula?: boolean;
            errorText?: string | null;
          }
        | undefined;
      return {
        moveTo(row: number, col: number) {
          current = opts.viewportCells?.[`${row},${col}`];
          return current !== undefined;
        },
        get displayText() {
          return current?.displayText ?? null;
        },
        get valueType() {
          return current?.valueType ?? 0;
        },
        get numberValue() {
          return current?.numberValue;
        },
        get hasFormula() {
          return current?.hasFormula ?? false;
        },
        get errorText() {
          return current?.errorText ?? null;
        },
      };
    };
  }
  if (opts.bridgeCells || opts.merges) {
    computeBridge.queryRange = async (
      _sheetId: string,
      startRow: number,
      startCol: number,
      _endRow: number,
      _endCol: number,
    ) => {
      const cell = opts.bridgeCells?.[`${startRow},${startCol}`];
      return {
        cells: cell ? [{ row: startRow, col: startCol, ...cell }] : [],
        merges: opts.merges ?? [],
      };
    };
    computeBridge.getAllMergesInSheet = async () => opts.merges ?? [];
  }

  // __SHELL__ is still consulted by other readbacks (workbook lookup
  // fallback, principal resolution) but the scene graph is now sourced
  // from SheetView's object-scene capability — see `getRenderedDrawings`
  // in src/console/api.ts.
  const fakeShell = {
    store: { getState: () => ({ activeFileId: 'doc-1' }) },
    documentManager: {
      getDocument: (id: string) =>
        id === 'doc-1'
          ? {
              context:
                Object.keys(computeBridge).length > 0
                  ? {
                      computeBridge,
                    }
                  : {},
            }
          : null,
    },
  };

  const renderer = makeRenderer(opts.rowHeights, opts.colWidths, {
    coordinateDocumentPixelToCell: opts.coordinateDocumentPixelToCell,
  });
  const rowCount = Math.max(0, ...Object.keys(opts.rowHeights).map(Number)) + 1;
  const colCount = Math.max(0, ...Object.keys(opts.colWidths).map(Number)) + 1;
  const fakeCoordinator = {
    renderer: {
      ...renderer,
      getSheetView() {
        return {
          objects: {
            getSceneObjectsByZOrder: () => sceneGraph.getByZOrder(),
          },
        };
      },
      getGeometry() {
        return {
          getCellPageRect(cell: { row: number; col: number }) {
            const h = opts.rowHeights[cell.row];
            const w = opts.colWidths[cell.col];
            if (h == null || w == null) return null;
            return { x: 0, y: 0, width: w, height: h };
          },
          getCellRenderedSize(cell: { row: number; col: number }) {
            const explicit = opts.renderedCellSizes?.[`${cell.row},${cell.col}`];
            if (explicit) return explicit;
            const h = opts.rowHeights[cell.row];
            const w = opts.colWidths[cell.col];
            if (h == null || w == null) return null;
            return { width: w, height: h };
          },
          getVisibleRange() {
            return renderer.getCoordinateSystem().getVisibleRange();
          },
          getMergeAnchor(row: number, col: number) {
            return (
              opts.merges?.find(
                (merge) =>
                  row >= merge.startRow &&
                  row <= merge.endRow &&
                  col >= merge.startCol &&
                  col <= merge.endCol,
              ) ?? null
            );
          },
          getPositionDimensions() {
            return {
              totalRows: rowCount,
              totalCols: colCount,
              getRowTop(row: number) {
                let top = 0;
                for (let i = 0; i < row; i++) top += opts.rowHeights[i] ?? 24;
                return top;
              },
              getRowHeight(row: number) {
                return opts.rowHeights[row] ?? 24;
              },
              getColLeft(col: number) {
                let left = 0;
                for (let i = 0; i < col; i++) left += opts.colWidths[i] ?? 100;
                return left;
              },
              getColWidth(col: number) {
                return opts.colWidths[col] ?? 100;
              },
            };
          },
        };
      },
      getViewport() {
        return {
          getLayout() {
            return renderer.getRenderer().getViewportLayout();
          },
        };
      },
    },
    workbook: {
      activeSheet: {
        sheetId: 'sheet-1',
        getSheetId: () => 'sheet-1',
        charts: {
          get: async (id: string) =>
            opts.charts?.find(
              (chart) =>
                chart.id === id ||
                chart.chartId === id ||
                chart.objectId === id ||
                chart.name === id,
            ) ?? null,
          list: async () => opts.charts ?? [],
        },
        layout: {
          // No documentPixelToCell here — force fallback to coordinator's
          // coordinate system.
        },
      },
    },
  };

  // Polyfill enough window/document for the api closure.
  g.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    __SHELL__: fakeShell,
    __COORDINATOR__: fakeCoordinator,
    devicePixelRatio: 2,
  };

  const store = new EventStore();
  store.enable();
  const actorRecorder = new ActorRecorder(store);
  const api = createConsoleAPI(store, actorRecorder);
  (g.window as any).__dt = api;

  return {
    api,
    cleanup: () => {
      delete g.window;
      delete g.document;
    },
  };
}

// ── Tests ──

describe('__dt rendered-state readbacks (app-eval / app-eval rendered-state readback)', () => {
  let runtime: RuntimeBundle | null = null;
  beforeEach(() => {
    runtime = null;
  });
  afterEach(() => {
    runtime?.cleanup();
  });

  test('getRenderedDrawings reports descriptors from the scene graph (one drawing)', async () => {
    runtime = setupRuntime({
      drawings: [
        {
          id: 'pic-1',
          type: 'picture',
          bounds: { x: 100, y: 24, width: 200, height: 96 },
          zIndex: 1,
          visible: true,
          groupId: null,
          data: { src: 'mog://image/abc.png' } as any,
        },
      ],
      rowHeights: { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24 },
      colWidths: { 0: 100, 1: 100, 2: 100, 3: 100 },
    });

    const drawings = await runtime.api.getRenderedDrawings();
    expect(drawings).toHaveLength(1);
    const d = drawings[0];
    expect(d.id).toBe('pic-1');
    expect(d.kind).toBe('image');
    expect(d.boundsPx).toEqual({ x: 100, y: 24, w: 200, h: 96 });
    expect(d.visible).toBe(true);
    expect(d.src).toBe('mog://image/abc.png');
    // anchor.from snaps (100, 24) → row 1, col 1; anchor.to snaps (300, 120) → row 5, col 3.
    expect(d.anchor.from).toEqual({ row: 1, col: 1 });
    expect(d.anchor.to).toEqual({ row: 5, col: 3 });
  });

  test('getRenderedDrawings reports diagram scene bounds in document space', async () => {
    runtime = setupRuntime({
      drawings: [
        {
          id: 'diagram-1',
          type: 'diagram',
          bounds: { x: 100, y: 100, width: 400, height: 300 },
          zIndex: 1,
          visible: true,
          groupId: null,
        },
      ],
      rowHeights: { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 24, 6: 24 },
      colWidths: { 0: 100, 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 },
    });

    const drawings = await runtime.api.getRenderedDrawings();
    expect(drawings).toHaveLength(1);
    expect(drawings[0]).toMatchObject({
      id: 'diagram-1',
      kind: 'diagram',
      boundsPx: { x: 100, y: 100, w: 400, h: 300 },
    });
  });

  test('getRenderedDrawings snaps anchors through SheetView geometry dimensions', async () => {
    runtime = setupRuntime({
      drawings: [
        {
          id: 'pic-geometry',
          type: 'picture',
          bounds: { x: 192, y: 0, width: 200, height: 150 },
          zIndex: 1,
          visible: true,
          groupId: null,
          data: { src: 'mog://image/geometry.png' } as any,
        },
      ],
      rowHeights: { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 24, 6: 24 },
      colWidths: { 0: 64, 1: 64, 2: 64, 3: 64, 4: 64, 5: 64, 6: 64 },
      coordinateDocumentPixelToCell: false,
    });

    const drawings = await runtime.api.getRenderedDrawings();
    expect(drawings).toHaveLength(1);
    expect(drawings[0].anchor.from).toEqual({ row: 0, col: 3 });
  });

  test('getRenderedDrawings returns [] when no scene graph is reachable', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: {},
      colWidths: {},
    });
    // Smash the coordinator to force the scene-graph lookup to miss.
    // No coordinator → no SheetView object-scene capability → no scene graph.
    (globalThis as any).window.__COORDINATOR__ = undefined;
    const drawings = await runtime.api.getRenderedDrawings();
    expect(drawings).toEqual([]);
  });

  test('getRenderedDrawings maps scene type to user-visible drawing kind', async () => {
    runtime = setupRuntime({
      drawings: [
        {
          id: 'chart-1',
          type: 'chart',
          bounds: { x: 0, y: 0, width: 50, height: 50 },
          zIndex: 1,
          visible: true,
          groupId: null,
          data: { chartId: 'c-1' } as any,
        },
        {
          id: 'text-effect-1',
          type: 'textbox',
          bounds: { x: 0, y: 0, width: 50, height: 50 },
          zIndex: 2,
          visible: true,
          groupId: null,
          data: { textEffect: { warpPreset: 'wave' } } as any,
        },
        {
          id: 'legacy-text-effect-1',
          type: 'textbox',
          bounds: { x: 0, y: 0, width: 50, height: 50 },
          zIndex: 2,
          visible: true,
          groupId: null,
          data: { wordArt: { warpPreset: 'wave' } } as any,
        },
        {
          id: 'plain-textbox',
          type: 'textbox',
          bounds: { x: 0, y: 0, width: 50, height: 50 },
          zIndex: 3,
          visible: true,
          groupId: null,
        },
        {
          id: 'smartart-1',
          type: 'smartart',
          bounds: { x: 0, y: 0, width: 50, height: 50 },
          zIndex: 4,
          visible: true,
          groupId: null,
        },
      ],
      rowHeights: { 0: 24 },
      colWidths: { 0: 100 },
    });

    const drawings = await runtime.api.getRenderedDrawings();
    const byId = Object.fromEntries(drawings.map((d) => [d.id, d.kind]));
    expect(byId['chart-1']).toBe('chart');
    expect(byId['text-effect-1']).toBe('wordArt');
    expect(byId['legacy-text-effect-1']).toBe('wordArt');
    expect(byId['plain-textbox']).toBe('shape');
    expect(byId['smartart-1']).toBe('smartArt');
  });

  test('getRenderedDrawings enriches chart descriptors from the chart model', async () => {
    runtime = setupRuntime({
      drawings: [
        {
          id: 'chart-object-1',
          type: 'chart',
          bounds: { x: 256, y: 20, width: 512, height: 280 },
          zIndex: 1,
          visible: true,
          groupId: null,
          data: { chartId: 'chart-1' } as any,
        },
      ],
      rowHeights: Object.fromEntries(Array.from({ length: 20 }, (_v, row) => [row, 20])),
      colWidths: Object.fromEntries(Array.from({ length: 16 }, (_v, col) => [col, 64])),
      coordinateDocumentPixelToCell: false,
      charts: [
        {
          id: 'chart-1',
          type: 'combo',
          dataRange: 'Data!A2:C5',
          anchorRow: 1,
          anchorCol: 4,
        },
      ],
    });

    const drawings = await runtime.api.getRenderedDrawings();
    expect(drawings).toHaveLength(1);
    expect(drawings[0]).toMatchObject({
      id: 'chart-object-1',
      kind: 'chart',
      chartType: 'combo',
      dataRange: 'Data!A2:C5',
      sourceRange: 'Data!A2:C5',
      chartRange: 'E2:M16',
      usedSyntheticAnchorFallback: false,
      anchor: {
        from: { row: 1, col: 4 },
        to: { row: 15, col: 12 },
      },
    });
  });

  test('getRenderedDrawings includes visible DOM form-control overlays', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24, 1: 24, 2: 24 },
      colWidths: { 0: 100, 1: 100, 2: 100 },
    });

    const fakeDocument: any = {
      defaultView: {
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      },
      querySelectorAll: (selector: string) =>
        selector === '[data-form-control-id]'
          ? [
              {
                ownerDocument: fakeDocument,
                style: { left: '200px', top: '48px' },
                getAttribute: (name: string) =>
                  name === 'data-form-control-id' ? 'fc-checkbox-1' : null,
                getBoundingClientRect: () => ({
                  x: 200,
                  y: 48,
                  left: 200,
                  top: 48,
                  width: 18,
                  height: 18,
                }),
              },
            ]
          : [],
    };
    (globalThis as any).document = fakeDocument;
    (globalThis as any).window.document = fakeDocument;

    const drawings = await runtime.api.getRenderedDrawings();
    expect(drawings).toHaveLength(1);
    expect(drawings[0]).toMatchObject({
      id: 'fc-checkbox-1',
      kind: 'formControl',
      anchor: { from: { row: 1, col: 1 } },
      boundsPx: { x: 200, y: 48, w: 18, h: 18 },
      visible: true,
    });
  });

  test('getRenderedRowHeight reports the canvas-drawn row height (custom value)', async () => {
    runtime = setupRuntime({
      drawings: [],
      // Row 3 was customised to 60 px (the kernel may report 20, but the
      // canvas drew 60 — that's what scenarios assert).
      rowHeights: { 0: 24, 1: 24, 2: 24, 3: 60, 4: 24 },
      colWidths: { 0: 100 },
    });
    const h = await runtime.api.getRenderedRowHeight(null, 3);
    expect(h).toBe(60);
    expect(runtime.api.viewport.getCellBounds(3, 0)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    });
  });

  test('getRenderedRowHeight returns null when the renderer cannot resolve bounds', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24 },
      colWidths: { 0: 100 },
    });
    const h = await runtime.api.getRenderedRowHeight(null, 999); // off-screen
    expect(h).toBeNull();
  });

  test('getRenderedViewportStartRow returns first row with live renderer bounds', () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 10: 24, 11: 30, 12: 24 },
      colWidths: { 0: 100 },
    });
    expect(runtime.api.getRenderedViewportStartRow('main')).toBe(10);
  });

  test('getRenderedViewportStartRow skips compute-range rows the renderer cannot resolve', () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 11: 30, 12: 24 },
      colWidths: { 0: 100 },
    });

    const coordinator = (globalThis as any).window.__COORDINATOR__;
    const renderer = coordinator.renderer.getRenderer();
    coordinator.renderer.getRenderer = () => ({
      ...renderer,
      getViewportLayout: () => ({
        viewports: [
          {
            id: 'main:sheet-1',
            cellRange: { startRow: 10, endRow: 12, startCol: 0, endCol: 0 },
          },
        ],
      }),
    });

    expect(runtime.api.getRenderedViewportStartRow('main')).toBe(11);
  });

  test('getRenderedColWidth reports the canvas-drawn column width', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24 },
      colWidths: { 0: 100, 1: 250, 2: 100 },
    });
    const w = await runtime.api.getRenderedColWidth(null, 1);
    expect(w).toBe(250);
  });

  test('getRenderedColWidth ignores unzoomed compute layout widths when renderer bounds are available', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 30 },
      colWidths: { 0: 96 },
      bridgeColPositions: { 0: 0, 1: 64 },
    });
    const w = await runtime.api.getRenderedColWidth(null, 0);
    expect(w).toBe(96);
  });

  test('getRenderedColWidth returns null when the renderer cannot resolve bounds even if compute layout can', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24 },
      colWidths: {},
      bridgeColPositions: { 999: 0, 1000: 64 },
    });
    const w = await runtime.api.getRenderedColWidth(null, 999);
    expect(w).toBeNull();
  });

  test('getRenderedCellSize reports intrinsic size when page bounds are not visible', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: {},
      colWidths: {},
      renderedCellSizes: { '0,255': { width: 64, height: 24 } },
    });

    await expect(runtime.api.getRenderedCellSize(null, 0, 255)).resolves.toEqual({
      width: 64,
      height: 24,
    });
    await expect(runtime.api.getRenderedColWidth(null, 255)).resolves.toBeNull();
  });

  test('getCanvasSnapshot returns empty Uint8Array when no canvas exists', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: {},
      colWidths: {},
    });
    // Stub a minimal document so the api can call querySelector.
    (globalThis as any).document = {
      querySelector: (_sel: string) => null,
    };
    try {
      const snap = await runtime.api.getCanvasSnapshot();
      expect(snap.png).toBeInstanceOf(Uint8Array);
      expect(snap.png.length).toBe(0);
      // dpr falls back to 1 when no canvas is found
      expect(snap.dpr).toBe(1);
    } finally {
      delete (globalThis as any).document;
    }
  });

  test('getCellValue returns empty data for covered merged cells', () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24, 1: 24 },
      colWidths: { 0: 100, 1: 100 },
      viewportCells: {
        '0,0': { displayText: 'Merged', valueType: 2 },
        '1,1': { displayText: 'Merged', valueType: 2 },
      },
      merges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
    });

    expect(runtime.api.getCellValue(0, 0)).toMatchObject({
      row: 0,
      col: 0,
      displayText: 'Merged',
      valueType: 2,
    });
    expect(runtime.api.getCellValue(1, 1)).toMatchObject({
      row: 1,
      col: 1,
      displayText: null,
      valueType: 0,
      hasFormula: false,
    });
  });

  test('getCellValue preserves populated linked-cell display under an unlabeled checkbox overlay', () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 20: 24 },
      colWidths: { 12: 100 },
      viewportCells: {
        '20,12': {
          displayText: '34,500',
          valueType: 1,
          numberValue: 34500,
          hasFormula: false,
        },
      },
    });

    const fakeDocument: any = {
      querySelector: (selector: string) =>
        selector ===
        '[data-form-control-type="checkbox"][data-form-control-linked-row="20"][data-form-control-linked-col="12"]'
          ? {
              querySelector: (childSelector: string) =>
                childSelector === '[data-testid^="form-control-checkbox-"]'
                  ? { textContent: '' }
                  : null,
            }
          : null,
    };
    (globalThis as any).document = fakeDocument;
    (globalThis as any).window.document = fakeDocument;

    const cell = runtime.api.getCellValue(20, 12);

    expect(cell?.displayText).toBe('34,500');
    expect(cell?.valueType).toBe(1);
    expect(cell?.numberValue).toBe(34500);
  });

  test('getCellValue masks boolean linked-cell display under an unlabeled checkbox overlay', () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24 },
      colWidths: { 0: 100 },
      viewportCells: {
        '0,0': {
          displayText: 'FALSE',
          valueType: 3,
          hasFormula: false,
        },
      },
    });

    const fakeDocument: any = {
      querySelector: (selector: string) =>
        selector ===
        '[data-form-control-type="checkbox"][data-form-control-linked-row="0"][data-form-control-linked-col="0"]'
          ? {
              querySelector: (childSelector: string) =>
                childSelector === '[data-testid^="form-control-checkbox-"]'
                  ? { textContent: '' }
                  : null,
            }
          : null,
    };
    (globalThis as any).document = fakeDocument;
    (globalThis as any).window.document = fakeDocument;

    const cell = runtime.api.getCellValue(0, 0);

    expect(cell?.displayText).toBe('');
    expect(cell?.valueType).toBe(3);
  });

  test('getCellsViaBridge returns empty data for covered merged cells', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24, 1: 24 },
      colWidths: { 0: 100, 1: 100 },
      bridgeCells: {
        '0,0': { formatted: 'Merged', value: 'Merged' },
        '1,1': { formatted: 'Merged', value: 'Merged' },
      },
      merges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
    });

    const cells = await runtime.api.getCellsViaBridge([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ]);

    expect(cells['0,0']).toMatchObject({
      row: 0,
      col: 0,
      displayText: 'Merged',
      valueType: 2,
    });
    expect(cells['1,1']).toMatchObject({
      row: 1,
      col: 1,
      displayText: null,
      valueType: 0,
      hasFormula: false,
    });
  });

  test('getDisplayedFormatsForCells uses range prefetch for dense in-limit cells', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24 },
      colWidths: { 0: 100, 1: 100 },
    });
    const calls = { range: 0, cell: 0 };
    (globalThis as any).window.__SHELL__.documentManager.getDocument = () => ({
      context: {
        computeBridge: {
          getDisplayedRangeProperties: async () => {
            calls.range++;
            return [[{ bold: true }, { italic: true }]];
          },
          getDisplayedCellProperties: async () => {
            calls.cell++;
            return null;
          },
        },
      },
    });

    const formats = await runtime.api.getDisplayedFormatsForCells([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ]);

    expect(calls.range).toBe(1);
    expect(calls.cell).toBe(0);
    expect(formats['0,0']).toEqual({ bold: true });
    expect(formats['0,1']).toEqual({ italic: true });
  });

  test('getDisplayedFormatsForCells normalizes bridge format readbacks', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24 },
      colWidths: { 0: 100 },
    });
    (globalThis as any).window.__SHELL__.documentManager.getDocument = () => ({
      context: {
        computeBridge: {
          getDisplayedRangeProperties: async () => [
            [
              {
                backgroundColor: '#123456',
                horizontalAlign: 'center',
                verticalAlign: 'middle',
              },
            ],
          ],
          getDisplayedCellProperties: async () => null,
        },
      },
    });

    const formats = await runtime.api.getDisplayedFormatsForCells([{ row: 0, col: 0 }]);

    expect(formats['0,0']).toEqual({
      backgroundColor: '#123456',
      fillColor: '#123456',
      horizontalAlign: 'center',
      horizontalAlignment: 'center',
      verticalAlign: 'middle',
      verticalAlignment: 'middle',
    });
  });

  test('getDisplayedFormatsForCells skips range prefetch for sparse oversized cells', async () => {
    runtime = setupRuntime({
      drawings: [],
      rowHeights: { 0: 24 },
      colWidths: { 0: 100, 1: 100 },
    });
    const calls = { range: 0, cell: 0 };
    (globalThis as any).window.__SHELL__.documentManager.getDocument = () => ({
      context: {
        computeBridge: {
          getDisplayedRangeProperties: async () => {
            calls.range++;
            throw new Error('range should not be called');
          },
          getDisplayedCellProperties: async (_sheetId: string, row: number, col: number) => {
            calls.cell++;
            if (row === 99999) {
              return { backgroundColor: '#abcdef', horizontalAlign: 'center' };
            }
            return { row, col };
          },
        },
      },
    });

    const formats = await runtime.api.getDisplayedFormatsForCells([
      { row: 0, col: 0 },
      { row: 99999, col: 1 },
    ]);

    expect(calls.range).toBe(0);
    expect(calls.cell).toBe(2);
    expect(formats['0,0']).toEqual({ row: 0, col: 0 });
    expect(formats['99999,1']).toEqual({
      backgroundColor: '#abcdef',
      fillColor: '#abcdef',
      horizontalAlign: 'center',
      horizontalAlignment: 'center',
    });
  });
});

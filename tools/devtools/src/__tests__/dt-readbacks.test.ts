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
  data?: { src?: string; chartId?: string; wordArt?: unknown };
}

function makeSceneGraph(objects: FakeSceneObject[]) {
  return {
    getByZOrder() {
      return [...objects].sort((a, b) => a.zIndex - b.zIndex);
    },
  };
}

function makeRenderer(rowHeights: Record<number, number>, colWidths: Record<number, number>) {
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
        documentPixelToCell(x: number, y: number) {
          // 100px-wide columns, 24px tall rows for the test fixture.
          return { row: Math.floor(y / 24), col: Math.floor(x / 100) };
        },
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
}): RuntimeBundle {
  const g = globalThis as { window?: Record<string, unknown>; document?: unknown };

  const sceneGraph = makeSceneGraph(opts.drawings);
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
              context: opts.bridgeColPositions
                ? {
                    computeBridge: {
                      getColPosition: async (_sheetId: string, col: number) =>
                        opts.bridgeColPositions?.[col] ?? 0,
                    },
                  }
                : {},
            }
          : null,
    },
  };

  const renderer = makeRenderer(opts.rowHeights, opts.colWidths);
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
          getVisibleRange() {
            return renderer.getCoordinateSystem().getVisibleRange();
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
        getSheetId: () => 'sheet-1',
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
      anchor: { from: { row: 2, col: 2 } },
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
});

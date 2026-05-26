/**
 * @jest-environment jsdom
 */

import type {
  ViewportChangeEvent,
  ViewportReader,
  Workbook,
  WorkbookViewport,
} from '@mog-sdk/contracts/api';
import type { RenderScheduler } from '@mog-sdk/contracts/rendering';

const updateContext = jest.fn();
const switchSheet = jest.fn();
const setViewportLayout = jest.fn();
const invalidateAll = jest.fn();
const resize = jest.fn();
const setScroll = jest.fn();
const setZoom = jest.fn();
const pause = jest.fn();
const resume = jest.fn();
const dispose = jest.fn();
const start = jest.fn();
const getCellExpander = jest.fn(() => null);
const getRenderScheduler = jest.fn();

const scheduler: RenderScheduler = {
  markCellsDirty: jest.fn(),
  markGeometryDirty: jest.fn(),
  markAllDirty: jest.fn(),
};

jest.mock('@mog/grid-canvas', () => ({
  computeViewportLayout: jest.fn((input: { scrollPosition?: { x: number; y: number } }) => ({
    viewports: [
      {
        id: 'main',
        bounds: { x: 0, y: 0, width: 640, height: 360 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: input.scrollPosition ?? { x: 0, y: 0 },
        scrollBehavior: { type: 'free' },
        cellRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 10 },
        zoom: 1,
      },
    ],
  })),
  createGridRenderer: jest.fn(() => ({
    switchSheet,
    updateContext,
    setViewportLayout,
    invalidateAll,
    resize,
    setScroll,
    setZoom,
    pause,
    resume,
    dispose,
    getCellExpander,
    getRenderScheduler,
    getCurrentSheetId: () => 'sheet-1',
    getEngine: () => ({ start }),
    getCoordinateSystem: () => ({
      getOutlineGutter: () => ({ rowGutterWidth: 0, colGutterHeight: 0 }),
      getHeaderVisibility: () => ({ showRowHeaders: true, showColumnHeaders: true }),
      getScrollBounds: () => ({ maxScrollLeft: 1000, maxScrollTop: 1000 }),
      getViewportBounds: () => ({ x: 0, y: 0, width: 640, height: 360 }),
    }),
    getInteractiveElementCollector: () => null,
    getGridLayers: () => null,
    hitTest: () => ({ type: 'empty' }),
  })),
}));

import { SheetView } from '../sheet-view';

class MockResizeObserver {
  observe = jest.fn();
  disconnect = jest.fn();
}

function makeViewportReader(
  binaryCellReader: unknown,
  binaryCellReaderForViewport: (viewportId: string) => unknown,
): ViewportReader {
  return {
    getBounds: () => ({ startRow: 0, startCol: 0, endRow: 20, endCol: 10 }),
    getRowPositions: () => new Float64Array([0, 24, 48]),
    getColPositions: () => new Float64Array([0, 80, 160]),
    getRowDimension: () => null,
    getColDimension: () => null,
    getMerges: () => [],
    get binaryCellReader() {
      return binaryCellReader;
    },
    binaryCellReaderForViewport,
  } as unknown as ViewportReader;
}

describe('SheetView workbook data sources', () => {
  let viewportListener: ((event: ViewportChangeEvent) => void) | null;
  let container: HTMLElement;
  let regionRefresh: jest.Mock<Promise<void>, [string]>;
  let reader: ViewportReader;

  beforeEach(() => {
    jest.clearAllMocks();
    getRenderScheduler.mockReturnValue(scheduler);
    viewportListener = null;
    container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360 }),
    });
    document.body.appendChild(container);
    (
      globalThis as typeof globalThis & { ResizeObserver: typeof MockResizeObserver }
    ).ResizeObserver = MockResizeObserver;

    regionRefresh = jest.fn(async () => {
      viewportListener?.({ type: 'fetch-committed' } as ViewportChangeEvent);
    });
    reader = makeViewportReader({ kind: 'binary-reader' }, (viewportId) => ({
      kind: 'viewport-reader',
      viewportId,
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as typeof globalThis & { ResizeObserver?: typeof MockResizeObserver })
      .ResizeObserver;
  });

  it('pushes active worksheet viewport readers into the grid renderer', async () => {
    const workbookViewport = {
      setRenderScheduler: jest.fn(),
      subscribe: jest.fn((listener: (event: ViewportChangeEvent) => void) => {
        viewportListener = listener;
        return jest.fn();
      }),
      createRegion: jest.fn(() => ({
        id: 'main:sheet-1',
        updateBounds: jest.fn(),
        refresh: regionRefresh,
        dispose: jest.fn(),
      })),
      resetSheetRegions: jest.fn(),
    } as unknown as WorkbookViewport;
    const workbook = {
      activeSheet: { sheetId: 'sheet-1' },
      viewport: workbookViewport,
      getSheetById: jest.fn(() => ({ viewport: reader })),
    } as unknown as Workbook;

    const view = new SheetView({ container, scrollable: false });
    view.attach(workbook);

    expect(updateContext).toHaveBeenCalledWith({
      binaryCellReader: reader.binaryCellReader,
      binaryCellReaderForViewport: reader.binaryCellReaderForViewport,
    });

    updateContext.mockClear();
    viewportListener?.({ type: 'fetch-committed' } as ViewportChangeEvent);

    expect(updateContext).toHaveBeenCalledWith({
      binaryCellReader: reader.binaryCellReader,
      binaryCellReaderForViewport: reader.binaryCellReaderForViewport,
    });

    await Promise.resolve();
    view.dispose();
  });

  it('cancels a stale viewport refresh when switchSheet disposes the old region', async () => {
    let resolveRefresh: (() => void) | null = null;
    const staleRefresh = jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          resolveRefresh = () => reject(new Error('Handle is disposed'));
        }),
    );
    const freshRefresh = jest.fn(async () => undefined);
    let createCount = 0;
    const workbookViewport = {
      setRenderScheduler: jest.fn(),
      subscribe: jest.fn((listener: (event: ViewportChangeEvent) => void) => {
        viewportListener = listener;
        return jest.fn();
      }),
      createRegion: jest.fn(() => {
        createCount += 1;
        return {
          id: createCount === 1 ? 'main:sheet-1' : 'main:sheet-2',
          updateBounds: jest.fn(),
          refresh: createCount === 1 ? staleRefresh : freshRefresh,
          dispose: jest.fn(),
        };
      }),
      resetSheetRegions: jest.fn(),
    } as unknown as WorkbookViewport;
    const workbook = {
      activeSheet: { sheetId: 'sheet-1' },
      viewport: workbookViewport,
      getSheetById: jest.fn(() => ({ viewport: reader })),
    } as unknown as Workbook;

    const view = new SheetView({ container, scrollable: false });
    view.attach(workbook);

    const staleInFlight = (
      view as unknown as { _executeViewportRefresh(): Promise<void> }
    )._executeViewportRefresh();
    view.switchSheet('sheet-2');
    resolveRefresh?.();

    await staleInFlight;
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(freshRefresh).toHaveBeenCalled();
    expect(invalidateAll).toHaveBeenCalled();
    view.dispose();
  });

  it('coalesces scheduled viewport refreshes without starving during repeated scroll updates', async () => {
    jest.useFakeTimers();
    try {
      const workbookViewport = {
        setRenderScheduler: jest.fn(),
        subscribe: jest.fn((listener: (event: ViewportChangeEvent) => void) => {
          viewportListener = listener;
          return jest.fn();
        }),
        createRegion: jest.fn(() => ({
          id: 'main:sheet-1',
          updateBounds: jest.fn(),
          refresh: regionRefresh,
          dispose: jest.fn(),
        })),
        resetSheetRegions: jest.fn(),
      } as unknown as WorkbookViewport;
      const workbook = {
        activeSheet: { sheetId: 'sheet-1' },
        viewport: workbookViewport,
        getSheetById: jest.fn(() => ({ viewport: reader })),
      } as unknown as Workbook;

      const view = new SheetView({ container, scrollable: false });
      view.attach(workbook);
      await Promise.resolve();
      regionRefresh.mockClear();

      const internals = view as unknown as { _scheduleViewportRefresh(): void };
      internals._scheduleViewportRefresh();
      internals._scheduleViewportRefresh();
      internals._scheduleViewportRefresh();

      jest.advanceTimersByTime(15);
      await Promise.resolve();
      expect(regionRefresh).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();

      expect(regionRefresh).toHaveBeenCalledTimes(1);
      view.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses scroll-only layout invalidation for scroll position changes', () => {
    const workbookViewport = {
      setRenderScheduler: jest.fn(),
      subscribe: jest.fn((listener: (event: ViewportChangeEvent) => void) => {
        viewportListener = listener;
        return jest.fn();
      }),
      createRegion: jest.fn(() => ({
        id: 'main:sheet-1',
        updateBounds: jest.fn(),
        refresh: regionRefresh,
        dispose: jest.fn(),
      })),
      resetSheetRegions: jest.fn(),
    } as unknown as WorkbookViewport;
    const workbook = {
      activeSheet: { sheetId: 'sheet-1' },
      viewport: workbookViewport,
      getSheetById: jest.fn(() => ({ viewport: reader })),
    } as unknown as Workbook;

    const view = new SheetView({ container, scrollable: false });
    view.attach(workbook);
    view.setScrollPosition({ x: 0, y: 0 });
    setScroll.mockClear();
    setViewportLayout.mockClear();
    invalidateAll.mockClear();

    view.setScrollPosition({ x: 120, y: 0 });

    expect(setScroll).toHaveBeenCalledWith(0, 120);
    expect(setViewportLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        viewports: [expect.objectContaining({ scrollOffset: { x: 120, y: 0 } })],
      }),
      { invalidation: 'scroll' },
    );
    expect(invalidateAll).not.toHaveBeenCalled();
    view.dispose();
  });
});

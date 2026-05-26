import type { ViewportChangeEvent, ViewportReader, WorkbookViewport } from '@mog-sdk/contracts/api';
import type { RenderScheduler } from '@mog-sdk/contracts/rendering';

import { ViewportWiring } from '../viewport-wiring';

function makeReader(): ViewportReader {
  return {
    getBounds: () => ({ startRow: 0, startCol: 0, endRow: 10, endCol: 10 }),
    getRowPositions: () => new Float64Array([0, 10, 25, 40, 55, 70, 88]),
    getColPositions: () => new Float64Array([0, 20, 55, 80]),
    getRowDimension: () => null,
    getColDimension: () => null,
    getMerges: () => [],
  } as unknown as ViewportReader;
}

describe('ViewportWiring', () => {
  let listener: ((event: ViewportChangeEvent) => void) | null = null;
  let positionIndex: {
    setPositions: jest.Mock;
    setHiddenState: jest.Mock;
    getRowTop: (row: number) => number;
    getColLeft: (col: number) => number;
  };
  let mergeIndex: { setMerges: jest.Mock };
  let scheduler: jest.Mocked<RenderScheduler>;
  let workbookViewport: jest.Mocked<WorkbookViewport>;

  beforeEach(() => {
    listener = null;
    let rows: Float64Array | null = null;
    let cols: Float64Array | null = null;
    let startRow = 0;
    let startCol = 0;
    positionIndex = {
      setPositions: jest.fn(
        (r: Float64Array | null, c: Float64Array | null, sr: number, sc: number) => {
          rows = r;
          cols = c;
          startRow = sr;
          startCol = sc;
        },
      ),
      setHiddenState: jest.fn(),
      getRowTop: (row: number) => rows?.[row - startRow] ?? row * 21,
      getColLeft: (col: number) => cols?.[col - startCol] ?? col * 64,
    };
    mergeIndex = { setMerges: jest.fn() };
    scheduler = {
      markAllDirty: jest.fn(),
      markGeometryDirty: jest.fn(),
      markCellsDirty: jest.fn(),
    } as unknown as jest.Mocked<RenderScheduler>;
    workbookViewport = {
      setRenderScheduler: jest.fn(),
      subscribe: jest.fn((cb: (event: ViewportChangeEvent) => void) => {
        listener = cb;
        return jest.fn();
      }),
    } as unknown as jest.Mocked<WorkbookViewport>;
  });

  it('eagerly populates VPI at connect time when reader already has data', () => {
    const onViewportGeometryChanged = jest.fn();
    const wiring = new ViewportWiring({
      workbookViewport,
      getViewportReader: makeReader,
      positionIndex: positionIndex as never,
      mergeIndex: mergeIndex as never,
      scheduler,
      onViewportGeometryChanged,
    });

    wiring.connect();

    // Eager population fires once during connect
    expect(positionIndex.setPositions).toHaveBeenCalledTimes(1);
    expect(onViewportGeometryChanged).toHaveBeenCalledTimes(1);
    // Eager population does not mark scheduler dirty (no render loop yet)
    expect(scheduler.markAllDirty).not.toHaveBeenCalled();
  });

  it('skips eager population when reader has no bounds', () => {
    const emptyReader = {
      ...makeReader(),
      getBounds: () => null,
    } as unknown as ViewportReader;
    const onViewportGeometryChanged = jest.fn();
    const wiring = new ViewportWiring({
      workbookViewport,
      getViewportReader: () => emptyReader,
      positionIndex: positionIndex as never,
      mergeIndex: mergeIndex as never,
      scheduler,
      onViewportGeometryChanged,
    });

    wiring.connect();

    expect(positionIndex.setPositions).not.toHaveBeenCalled();
    expect(onViewportGeometryChanged).not.toHaveBeenCalled();
  });

  it('notifies SheetView after fetch geometry hydrates the position index', () => {
    const onViewportGeometryChanged = jest.fn(() => {
      expect(positionIndex.getRowTop(6)).toBe(88);
      expect(positionIndex.getColLeft(2)).toBe(55);
    });
    const onViewportBufferChanged = jest.fn();
    const wiring = new ViewportWiring({
      workbookViewport,
      getViewportReader: makeReader,
      positionIndex: positionIndex as never,
      mergeIndex: mergeIndex as never,
      scheduler,
      onViewportGeometryChanged,
      onViewportBufferChanged,
    });

    wiring.connect();
    listener?.({ type: 'fetch-committed' } as ViewportChangeEvent);

    // 1 from eager population + 1 from fetch-committed event
    expect(onViewportGeometryChanged).toHaveBeenCalledTimes(2);
    expect(onViewportBufferChanged).toHaveBeenCalledTimes(2);
    expect(scheduler.markAllDirty).toHaveBeenCalledTimes(1);
  });

  it('notifies on dimension patches but not cell-only patches', () => {
    const onViewportGeometryChanged = jest.fn();
    const wiring = new ViewportWiring({
      workbookViewport,
      getViewportReader: makeReader,
      positionIndex: positionIndex as never,
      mergeIndex: mergeIndex as never,
      scheduler,
      onViewportGeometryChanged,
    });

    wiring.connect();
    listener?.({ type: 'dimensions-patched' } as ViewportChangeEvent);
    listener?.({ type: 'cells-patched', cells: [{ row: 0, col: 0 }] } as ViewportChangeEvent);

    // 1 from eager population + 1 from dimensions-patched
    expect(onViewportGeometryChanged).toHaveBeenCalledTimes(2);
    expect(scheduler.markGeometryDirty).toHaveBeenCalledTimes(1);
    expect(scheduler.markCellsDirty).toHaveBeenCalledTimes(1);
  });
});

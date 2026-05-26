import { createViewportReader } from '../viewport-reader';

function makeBuffer(
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  rows: number[],
  cols: number[],
) {
  return {
    hasBuffer: () => true,
    getBounds: () => ({ sheetId: 'sheet-1', ...bounds }),
    getRowPositions: () => new Float64Array(rows),
    getColPositions: () => new Float64Array(cols),
    getMerges: () => [],
    getRowDimension: () => null,
    getColDimension: () => null,
  };
}

function makeBridge(buffers: Record<string, ReturnType<typeof makeBuffer>>) {
  return {
    getPerViewportStates: () => new Map(Object.keys(buffers).map((id) => [id, {}])),
    getViewportBuffer: (id: string) => buffers[id] ?? null,
    getAccessorForViewport: () => undefined,
    getActiveCellData: () => null,
  };
}

describe('createViewportReader geometry buffer selection', () => {
  it('prefers the main viewport over earlier frozen panes for sheet-level positions', () => {
    const bridge = makeBridge({
      'frozen-corner:sheet-1': makeBuffer(
        { startRow: 0, startCol: 0, endRow: 5, endCol: 1 },
        [0, 22, 48, 70, 92, 114, 136],
        [0, 22, 180],
      ),
      'frozen-cols:sheet-1': makeBuffer(
        { startRow: 0, startCol: 0, endRow: 40, endCol: 1 },
        [0, 22, 48, 70, 92, 114, 136, 158, 180],
        [0, 22, 180],
      ),
      'main:sheet-1': makeBuffer(
        { startRow: 0, startCol: 0, endRow: 40, endCol: 23 },
        [0, 22, 48, 70, 92, 114, 136, 158, 180],
        [0, 22, 180, 229, 307],
      ),
    });

    const reader = createViewportReader('sheet-1', bridge as never);

    expect(Array.from(reader.getRowPositions() ?? [])).toEqual([
      0, 22, 48, 70, 92, 114, 136, 158, 180,
    ]);
    expect(Array.from(reader.getColPositions() ?? [])).toEqual([0, 22, 180, 229, 307]);
    expect(reader.getBounds()).toEqual({
      sheetId: 'sheet-1',
      startRow: 0,
      startCol: 0,
      endRow: 40,
      endCol: 23,
    });
  });

  it('falls back to the largest buffered viewport when main is not ready yet', () => {
    const bridge = makeBridge({
      'frozen-corner:sheet-1': makeBuffer(
        { startRow: 0, startCol: 0, endRow: 5, endCol: 1 },
        [0, 22, 48, 70, 92, 114, 136],
        [0, 22, 180],
      ),
      'frozen-cols:sheet-1': makeBuffer(
        { startRow: 0, startCol: 0, endRow: 40, endCol: 1 },
        [0, 22, 48, 70, 92, 114, 136, 158, 180],
        [0, 22, 180],
      ),
    });

    const reader = createViewportReader('sheet-1', bridge as never);

    expect(reader.getBounds()).toEqual({
      sheetId: 'sheet-1',
      startRow: 0,
      startCol: 0,
      endRow: 40,
      endCol: 1,
    });
  });
});

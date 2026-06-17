import { jest } from '@jest/globals';

import { ResizeCoordinator } from '../resize-coordination';

function makeState(
  state: 'idle' | 'resizingHeader',
  contextOverrides: Record<string, unknown> = {},
) {
  return {
    status: 'active',
    matches: (value: string) => value === state,
    context: {
      resizeType: null,
      resizeIndex: null,
      resizeIndexes: [],
      resizeStartPosition: null,
      resizeStartSize: null,
      resizeStartSizes: new Map<number, number>(),
      resizeCurrentSize: null,
      ...contextOverrides,
    },
  };
}

function createHarness(initialState: ReturnType<typeof makeState>) {
  let onState: ((state: ReturnType<typeof makeState>) => void) | null = null;
  const setColumnWidth = jest.fn(async () => undefined);
  const setColumnWidths = jest.fn(async () => undefined);
  const setRowHeight = jest.fn(async () => undefined);
  const send = jest.fn();
  const coordinator = new ResizeCoordinator();

  coordinator.setDependencies({
    selectionActor: {
      getSnapshot: jest.fn(() => initialState),
      send,
      subscribe: jest.fn((callback: (state: ReturnType<typeof makeState>) => void) => {
        onState = callback;
        return { unsubscribe: jest.fn() };
      }),
    } as never,
    workbook: {
      getSheetById: jest.fn(() => ({
        layout: {
          setColumnWidth,
          setColumnWidths,
          setRowHeight,
        },
      })),
    } as never,
    getActiveSheetId: jest.fn(() => 'sheet1' as never),
  });

  return {
    emit: (state: ReturnType<typeof makeState>) => onState?.(state),
    send,
    setColumnWidth,
    setColumnWidths,
    setRowHeight,
  };
}

async function flushAsyncResize(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ResizeCoordinator', () => {
  it('does not write a multi-column resize when the pointer did not move', async () => {
    const harness = createHarness(
      makeState('resizingHeader', {
        resizeType: 'column',
        resizeIndex: 0,
        resizeIndexes: [0, 1],
        resizeStartPosition: 100,
        resizeStartSize: 64,
        resizeStartSizes: new Map([
          [0, 64],
          [1, 64],
        ]),
        resizeCurrentSize: 64,
      }),
    );

    harness.emit(makeState('idle'));
    await flushAsyncResize();

    expect(harness.setColumnWidths).not.toHaveBeenCalled();
    expect(harness.send).toHaveBeenCalledWith({ type: 'CLEAR_RESIZE' });
  });

  it('does not write a fallback single-row resize when the pointer did not move', async () => {
    const harness = createHarness(
      makeState('resizingHeader', {
        resizeType: 'row',
        resizeIndex: 3,
        resizeStartPosition: 200,
        resizeStartSize: 22,
        resizeCurrentSize: 22,
      }),
    );

    harness.emit(makeState('idle'));
    await flushAsyncResize();

    expect(harness.setRowHeight).not.toHaveBeenCalled();
    expect(harness.send).toHaveBeenCalledWith({ type: 'CLEAR_RESIZE' });
  });

  it('writes changed columns for a real multi-column resize', async () => {
    const harness = createHarness(
      makeState('resizingHeader', {
        resizeType: 'column',
        resizeIndex: 2,
        resizeIndexes: [2, 3],
        resizeStartPosition: 100,
        resizeStartSize: 64,
        resizeStartSizes: new Map([
          [2, 64],
          [3, 80],
        ]),
        resizeCurrentSize: 70,
      }),
    );

    harness.emit(makeState('idle'));
    await flushAsyncResize();

    expect(harness.setColumnWidths).toHaveBeenCalledWith([
      [2, 70],
      [3, 86],
    ]);
    expect(harness.send).toHaveBeenCalledWith({ type: 'CLEAR_RESIZE' });
    expect(harness.setColumnWidth).not.toHaveBeenCalled();
  });
});

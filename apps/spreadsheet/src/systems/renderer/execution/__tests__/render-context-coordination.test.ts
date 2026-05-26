import { jest } from '@jest/globals';
import {
  setupRenderContextCoordination,
  type RenderContextCoordinationConfig,
} from '../render-context-coordination';

type Subscription = { unsubscribe: () => void };

function createActor<T>(initial: T): {
  getSnapshot: () => T;
  subscribe: (fn: (state: T) => void) => Subscription;
  emit: (next?: T) => void;
} {
  let state = initial;
  const listeners = new Set<(state: T) => void>();

  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return { unsubscribe: () => listeners.delete(fn) };
    },
    emit: (next) => {
      if (next !== undefined) state = next;
      for (const listener of listeners) listener(state);
    },
  };
}

function selectionSnapshot(activeCell = { row: 0, col: 0 }) {
  const pendingRange = {
    startRow: activeCell.row,
    startCol: activeCell.col,
    endRow: activeCell.row,
    endCol: activeCell.col,
  };

  return {
    value: 'idle',
    matches: () => false,
    context: {
      committedRanges: [],
      pendingRange,
      modes: { end: false, extend: false, additive: false },
      activeCell,
      anchor: null,
      fillHandleStart: null,
      fillHandleEnd: null,
      fillSourceRange: null,
      direction: 'none',
      anchorCol: null,
      anchorRow: null,
      dragSourceRange: null,
      dragTargetCell: null,
      dragMode: 'move',
      resizeType: null,
      resizeIndex: null,
      resizeCurrentSize: null,
      tableResizeId: null,
      tableResizeStartBounds: null,
      tableResizeTargetRow: null,
      tableResizeTargetCol: null,
    },
  };
}

function editorSnapshot() {
  return {
    value: 'inactive',
    matches: (state: string) => state === 'inactive',
    context: {
      editingCell: null,
      sheetId: 'sheet-1',
      mergeBounds: null,
      value: '',
      hasConflict: false,
      cursorPosition: 0,
      isPickerOpen: false,
    },
  };
}

function clipboardSnapshot() {
  return {
    value: 'empty',
    matches: (state: string) => state === 'empty',
    context: {
      sourceRanges: null,
      data: null,
      isCut: false,
      pastePreviewTarget: null,
      marchingAntsPhase: 0,
      errorMessage: null,
      pasteOptions: null,
      skipSizeCheck: false,
      isStale: false,
    },
  };
}

function rendererSnapshot() {
  return {
    value: 'ready',
    status: 'active',
    context: { currentSheetId: 'sheet-1' },
  };
}

function makeConfig(
  overrides: Partial<RenderContextCoordinationConfig> = {},
): RenderContextCoordinationConfig & {
  selectionActor: ReturnType<typeof createActor>;
  rendererActor: ReturnType<typeof createActor>;
  onContextUpdate: ReturnType<typeof jest.fn>;
} {
  const selectionActor = createActor(selectionSnapshot());
  const editorActor = createActor(editorSnapshot());
  const clipboardActor = createActor(clipboardSnapshot());
  const rendererActor = createActor(rendererSnapshot());
  const onContextUpdate = jest.fn();

  return {
    workbook: {} as RenderContextCoordinationConfig['workbook'],
    selectionActor: selectionActor as RenderContextCoordinationConfig['selectionActor'],
    editorActor: editorActor as RenderContextCoordinationConfig['editorActor'],
    clipboardActor: clipboardActor as RenderContextCoordinationConfig['clipboardActor'],
    rendererActor: rendererActor as RenderContextCoordinationConfig['rendererActor'],
    onContextUpdate,
    getRemoteCursors: () => [],
    getCellValue: () => null,
    getCellFormat: () => undefined,
    getPageBreakPreviewMode: () => false,
    getPageBreakDragState: () => null,
    getSparklineRenderData: () => undefined,
    hasValidationErrors: () => false,
    getFloatingObjectState: () => ({
      selectedObjectIds: [],
      hoveredObjectId: null,
      mode: 'idle',
      dragState: null,
      resizeState: null,
      rotateState: null,
    }),
    getFloatingObjects: () => [],
    getFloatingObjectBounds: () => null,
    getAllObjectBounds: () => new Map(),
    getGroupingConfig: () => null,
    getRowGroups: () => [],
    getColumnGroups: () => [],
    getTraceArrows: () => [],
    getPreviewFont: () => null,
    ...overrides,
  } as RenderContextCoordinationConfig & {
    selectionActor: ReturnType<typeof createActor>;
    rendererActor: ReturnType<typeof createActor>;
    onContextUpdate: ReturnType<typeof jest.fn>;
  };
}

describe('setupRenderContextCoordination lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('cancels pending follower refresh reads on cleanup', () => {
    const getPrintArea = jest.fn(() => {
      throw new Error('disposed bridge should not be read');
    });
    const config = makeConfig({ getPrintArea });

    const cleanup = setupRenderContextCoordination(config);
    cleanup();

    jest.advanceTimersByTime(120);

    expect(getPrintArea).not.toHaveBeenCalled();
  });

  it('does not run superseded follower refresh reads', () => {
    const getPrintArea = jest.fn(() => null);
    const config = makeConfig({ getPrintArea });

    const cleanup = setupRenderContextCoordination(config);
    config.rendererActor.emit();
    jest.advanceTimersByTime(120);

    expect(getPrintArea).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does not publish in-flight follower refresh results after cleanup', async () => {
    let resolvePrintArea: (value: null) => void = () => {};
    const getPrintArea = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          resolvePrintArea = resolve;
        }),
    );
    const config = makeConfig({ getPrintArea });

    const cleanup = setupRenderContextCoordination(config);
    expect(config.onContextUpdate).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(120);
    expect(getPrintArea).toHaveBeenCalledTimes(1);

    cleanup();
    resolvePrintArea(null);
    await Promise.resolve();

    expect(config.onContextUpdate).toHaveBeenCalledTimes(1);
  });
});

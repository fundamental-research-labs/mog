import { jest } from '@jest/globals';

import type { WorkbookHistory } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';

import type { SelectionActor } from '../cross-coordination';
import { setupUndoSelectionCoordination } from '../undo-selection-coordination';

type UndoTrigger = 'undo' | 'redo' | 'push' | 'clear' | 'external';

interface SelectionSnapshot {
  context: {
    activeCell: { row: number; col: number };
    anchor: { row: number; col: number } | null;
    direction: 'down-right' | 'down-left' | 'up-right' | 'up-left';
    committedRanges: CellRange[];
    pendingRange: CellRange;
  };
}

function snapshot(row: number, col: number): SelectionSnapshot {
  return {
    context: {
      activeCell: { row, col },
      anchor: null,
      direction: 'down-right',
      committedRanges: [],
      pendingRange: { startRow: row, startCol: col, endRow: row, endCol: col },
    },
  };
}

function createHistory() {
  let listener:
    | ((event: Parameters<Parameters<WorkbookHistory['subscribe']>[0]>[0]) => void)
    | null = null;

  const history = {
    subscribe: jest.fn((next) => {
      listener = next;
      return jest.fn();
    }),
  } as unknown as WorkbookHistory;

  return {
    history,
    emit: (trigger: UndoTrigger) => {
      listener?.({
        trigger,
        state: {
          canUndo: true,
          canRedo: true,
          undoStackSize: 1,
          redoStackSize: 0,
          nextUndoDescription: null,
          nextRedoDescription: null,
        },
      });
    },
  };
}

function createSelectionActor(initialSnapshot: SelectionSnapshot) {
  let currentSnapshot = initialSnapshot;
  const sent: unknown[] = [];

  const selectionActor = {
    getSnapshot: () => currentSnapshot,
    send: (event: unknown) => {
      sent.push(event);
    },
  } as unknown as SelectionActor;

  return {
    selectionActor,
    sent,
    setSnapshot: (nextSnapshot: SelectionSnapshot) => {
      currentSnapshot = nextSnapshot;
    },
  };
}

describe('setupUndoSelectionCoordination', () => {
  it('captures the active sheet with undo checkpoints and restores across sheets', () => {
    const { history, emit } = createHistory();
    const { selectionActor, sent } = createSelectionActor(snapshot(1, 0));
    let activeSheetId = toSheetId('sheet-1');
    const setActiveSheet = jest.fn((sheetId: SheetId) => {
      activeSheetId = sheetId;
    });
    const primeSheetViewState = jest.fn();

    const cleanup = setupUndoSelectionCoordination({
      history,
      selectionActor,
      getActiveSheetId: () => activeSheetId,
      setActiveSheet,
      primeSheetViewState,
    });

    emit('push');

    activeSheetId = toSheetId('sheet-2');
    emit('undo');

    expect(primeSheetViewState).toHaveBeenCalledTimes(1);
    expect(primeSheetViewState.mock.calls[0][0]).toBe(toSheetId('sheet-1'));
    expect(primeSheetViewState.mock.calls[0][1]).toMatchObject<SelectionCheckpoint>({
      sheetId: toSheetId('sheet-1'),
      activeCell: { row: 1, col: 0 },
      anchor: null,
      direction: 'down-right',
      ranges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 0 }],
    });
    expect(setActiveSheet).toHaveBeenCalledWith(toSheetId('sheet-1'));
    expect(sent).toEqual([
      {
        type: 'SET_SELECTION',
        ranges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 0 }],
        activeCell: { row: 1, col: 0 },
        anchor: null,
      },
    ]);

    cleanup();
  });

  it('prefers pending checkpoints captured before the mutation', () => {
    const { history, emit } = createHistory();
    const { selectionActor, sent } = createSelectionActor(snapshot(0, 0));
    let activeSheetId = toSheetId('sheet-2');
    const setActiveSheet = jest.fn((sheetId: SheetId) => {
      activeSheetId = sheetId;
    });
    const pendingCheckpoint: SelectionCheckpoint = {
      sheetId: toSheetId('sheet-1'),
      ranges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 0 }],
      activeCell: { row: 1, col: 0 },
      anchor: null,
      direction: 'down-right',
    };
    const consumePendingSelectionCheckpoint = jest
      .fn<() => SelectionCheckpoint | null>()
      .mockReturnValueOnce(pendingCheckpoint);

    const cleanup = setupUndoSelectionCoordination({
      history,
      selectionActor,
      getActiveSheetId: () => activeSheetId,
      setActiveSheet,
      primeSheetViewState: jest.fn(),
      consumePendingSelectionCheckpoint,
    });

    emit('push');
    emit('undo');

    expect(consumePendingSelectionCheckpoint).toHaveBeenCalledTimes(1);
    expect(setActiveSheet).toHaveBeenCalledWith(toSheetId('sheet-1'));
    expect(sent).toEqual([
      {
        type: 'SET_SELECTION',
        ranges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 0 }],
        activeCell: { row: 1, col: 0 },
        anchor: null,
      },
    ]);

    cleanup();
  });

  it('reuses the original operation checkpoint for redo instead of the current cursor', () => {
    const { history, emit } = createHistory();
    const { selectionActor, sent, setSnapshot } = createSelectionActor(snapshot(1, 0));
    let activeSheetId = toSheetId('sheet-1');
    const setActiveSheet = jest.fn((sheetId: SheetId) => {
      activeSheetId = sheetId;
    });

    const cleanup = setupUndoSelectionCoordination({
      history,
      selectionActor,
      getActiveSheetId: () => activeSheetId,
      setActiveSheet,
      primeSheetViewState: jest.fn(),
    });

    emit('push');
    activeSheetId = toSheetId('sheet-2');
    setSnapshot(snapshot(0, 0));
    emit('undo');

    activeSheetId = toSheetId('sheet-2');
    setSnapshot(snapshot(4, 3));
    emit('redo');

    expect(setActiveSheet).toHaveBeenNthCalledWith(1, toSheetId('sheet-1'));
    expect(setActiveSheet).toHaveBeenNthCalledWith(2, toSheetId('sheet-1'));
    expect(sent).toEqual([
      {
        type: 'SET_SELECTION',
        ranges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 0 }],
        activeCell: { row: 1, col: 0 },
        anchor: null,
      },
      {
        type: 'SET_SELECTION',
        ranges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 0 }],
        activeCell: { row: 1, col: 0 },
        anchor: null,
      },
    ]);

    cleanup();
  });
});

import { jest } from '@jest/globals';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SelectionState } from '@mog-sdk/contracts/actors/selection';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import { createSpreadsheetEmbedAppBridge } from '../create-spreadsheet-embed-app-bridge';

function createSelectionState(): SelectionState {
  return {
    context: {
      activeCell: { row: 0, col: 0 },
      anchor: { row: 0, col: 0 },
      pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      committedRanges: [],
      modes: { end: false, extend: false, additive: false },
      direction: 'none',
      formulaRangeColor: null,
    },
  } as SelectionState;
}

describe('createSpreadsheetEmbedAppBridge', () => {
  it('scrolls to a selected range without replacing the range selection with its first cell', async () => {
    const state = createSelectionState();
    const scrollToActiveCell = jest.fn();
    const selectionSend = jest.fn(
      (event: { type: string; ranges?: typeof state.context.committedRanges }) => {
        if (event.type !== 'SET_SELECTION' || !event.ranges?.[0]) return;
        state.context.pendingRange = event.ranges[0];
        state.context.activeCell = {
          row: event.ranges[0].startRow,
          col: event.ranges[0].startCol,
        };
      },
    );

    const bridge = createSpreadsheetEmbedAppBridge({
      documentId: 'doc-1',
      workbook: {
        findSheet: jest.fn(async () => null),
        getSheetById: jest.fn(() => ({ name: 'Sheet1' })),
      } as unknown as WorkbookInternal,
      uiStore: {
        getState: () => ({
          activeSheetId: toSheetId('sheet-1'),
          setActiveSheet: jest.fn(),
        }),
        subscribe: jest.fn(() => jest.fn()),
      },
      coordinator: {
        grid: {
          startEditing: jest.fn(),
          access: {
            actors: {
              selection: {
                getSnapshot: () => state,
                send: selectionSend,
                subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
              },
            },
            commands: {
              editor: {
                commit: jest.fn(),
                cancel: jest.fn(),
              },
            },
          },
        },
        renderer: {
          access: {
            commands: {
              renderer: {
                scrollToActiveCell,
              },
            },
          },
        },
      },
    });

    await bridge.select({ range: 'N1:N5' });
    expect(bridge.getSelection().selectedRanges).toEqual(['N1:N5']);

    await bridge.scrollTo({ range: 'N1:N5' });

    expect(scrollToActiveCell).toHaveBeenCalledWith({ row: 0, col: 13 });
    expect(selectionSend).toHaveBeenCalledTimes(1);
    expect(bridge.getSelection().selectedRanges).toEqual(['N1:N5']);
  });
});

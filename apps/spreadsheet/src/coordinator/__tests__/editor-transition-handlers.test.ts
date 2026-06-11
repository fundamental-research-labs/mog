import { jest } from '@jest/globals';
import type { StoreApi } from 'zustand';
import { createActor } from 'xstate';

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { UIState } from '../../ui-store';
import { editorMachine } from '../../systems/grid-editing/machines/grid-editor-machine';
import { EditorEvents } from '../../systems/grid-editing/machines/editor/events';
import { wireReturnToOriginSheet } from '../editor-transition-handlers';

function createUiStore(activeSheetId: string): StoreApi<UIState> {
  let currentActiveSheetId = toSheetId(activeSheetId);
  const setActiveSheet = jest.fn((sheetId: SheetId) => {
    currentActiveSheetId = sheetId;
  });
  const getSheetViewState = jest.fn(() => null);
  const saveSheetViewState = jest.fn();

  const store = {
    getState: () => ({
      activeSheetId: currentActiveSheetId,
      setActiveSheet,
      getSheetViewState,
      saveSheetViewState,
    }),
  };

  return store as unknown as StoreApi<UIState>;
}

describe('wireReturnToOriginSheet', () => {
  it('returns to the origin sheet when a cross-sheet formula is cancelled from validation error state', () => {
    const actor = createActor(editorMachine);
    actor.start();

    const uiStore = createUiStore('sheet-2');
    const cleanup = wireReturnToOriginSheet(actor, uiStore);

    actor.send(
      EditorEvents.startEditing(
        { row: 0, col: 0 },
        'sheet-1',
        '=SUM(',
        undefined,
        'typing',
        '=SUM('.length,
      ),
    );
    expect(actor.getSnapshot().matches('formulaEditing')).toBe(true);

    actor.send(EditorEvents.commit('none'));
    actor.send(EditorEvents.validationError('expected a function argument'));
    expect(actor.getSnapshot().matches('error')).toBe(true);

    actor.send(EditorEvents.cancel());

    expect(uiStore.getState().setActiveSheet).toHaveBeenCalledWith(toSheetId('sheet-1'));

    cleanup();
    actor.stop();
  });
});

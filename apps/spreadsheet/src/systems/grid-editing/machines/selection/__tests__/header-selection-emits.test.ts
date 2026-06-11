import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { createActor } from 'xstate';

import { selectionMachine } from '../../grid-selection-machine';
import type { SelectionEmitted } from '../types';

describe('header selection emits', () => {
  it('does not emit viewport-follow for mouse column header selection', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({ type: 'SELECT_COLUMN', col: 13, shiftKey: false, ctrlKey: false });

    expect(emitted).toHaveLength(0);
    expect(actor.getSnapshot().context.activeCell).toEqual({ row: 0, col: 13 });
    expect(actor.getSnapshot().context.pendingRange).toEqual({
      startRow: 0,
      startCol: 13,
      endRow: MAX_ROWS - 1,
      endCol: 13,
      isFullColumn: true,
    });

    subscription.unsubscribe();
    actor.stop();
  });

  it('does not emit viewport-follow for mouse row header selection', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({ type: 'SELECT_ROW', row: 12, shiftKey: false, ctrlKey: false });

    expect(emitted).toHaveLength(0);
    expect(actor.getSnapshot().context.activeCell).toEqual({ row: 12, col: 0 });
    expect(actor.getSnapshot().context.pendingRange).toEqual({
      startRow: 12,
      startCol: 0,
      endRow: 12,
      endCol: MAX_COLS - 1,
      isFullRow: true,
    });

    subscription.unsubscribe();
    actor.stop();
  });

  it('keeps keyboard column selection on viewport-follow', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({
      type: 'SELECT_COLUMN',
      col: 13,
      shiftKey: false,
      ctrlKey: false,
      fromKeyboard: true,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      activeCell: { row: 0, col: 13 },
      followCell: { row: 0, col: 13 },
    });

    subscription.unsubscribe();
    actor.stop();
  });
});

import { createActor } from 'xstate';

import { selectionMachine } from '../../grid-selection-machine';
import type { SelectionEmitted } from '../types';

describe('page navigation emits', () => {
  it('annotates page-left movement with horizontal previous page-scroll intent', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 50, endRow: 0, endCol: 50 }],
      activeCell: { row: 0, col: 50 },
      source: 'user',
    });
    emitted.length = 0;

    actor.send({ type: 'PAGE_LEFT', visibleCols: 27, shiftKey: false });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      activeCell: { row: 0, col: 23 },
      followCell: { row: 0, col: 23 },
      scrollIntent: { type: 'page', axis: 'horizontal', direction: 'previous' },
    });

    subscription.unsubscribe();
    actor.stop();
  });

  it('leaves ordinary direct selection movement on minimal viewport-follow', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 0, startCol: 3, endRow: 0, endCol: 3 }],
      activeCell: { row: 0, col: 3 },
      source: 'user',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].scrollIntent).toBeUndefined();

    subscription.unsubscribe();
    actor.stop();
  });

  it('direct range selection follows the active cell rather than the opposite corner', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 6, startCol: 13, endRow: 6, endCol: 27 }],
      activeCell: { row: 6, col: 13 },
      source: 'user',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      activeCell: { row: 6, col: 13 },
      followCell: { row: 6, col: 13 },
    });
    expect(emitted[0].scrollIntent).toBeUndefined();

    subscription.unsubscribe();
    actor.stop();
  });

  it('explicit-anchor range selection still follows the moving edge', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 6, startCol: 13, endRow: 6, endCol: 27 }],
      activeCell: { row: 6, col: 13 },
      anchor: { row: 6, col: 13 },
      source: 'user',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      activeCell: { row: 6, col: 13 },
      followCell: { row: 6, col: 27 },
    });
    expect(emitted[0].scrollIntent).toBeUndefined();

    subscription.unsubscribe();
    actor.stop();
  });

  it('annotates Ctrl+Home with a top-left origin scroll intent', () => {
    const actor = createActor(selectionMachine);
    const emitted: SelectionEmitted[] = [];
    const subscription = actor.on('userSelectionChanged', (event) => emitted.push(event));

    actor.start();
    actor.send({
      type: 'SET_SELECTION',
      ranges: [{ startRow: 120, startCol: 8, endRow: 120, endCol: 8 }],
      activeCell: { row: 120, col: 8 },
      source: 'user',
    });
    emitted.length = 0;

    actor.send({ type: 'KEY_HOME', ctrlKey: true, shiftKey: false });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      activeCell: { row: 0, col: 0 },
      followCell: { row: 0, col: 0 },
      scrollIntent: { type: 'origin', axis: 'both' },
    });

    subscription.unsubscribe();
    actor.stop();
  });
});

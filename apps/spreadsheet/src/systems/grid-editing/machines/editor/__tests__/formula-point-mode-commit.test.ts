import { createActor } from 'xstate';

import { editorMachine } from '../../grid-editor-machine';
import { EditorEvents } from '../events';

function startFormulaEditing(initial: string) {
  const actor = createActor(editorMachine);
  actor.start();
  actor.send(
    EditorEvents.startEditing(
      { row: 0, col: 0 },
      'sheet-1',
      initial,
      undefined,
      'typing',
      initial.length,
    ),
  );
  return actor;
}

describe('Formula point-mode commit', () => {
  it('closes open function parentheses when committing a point-mode reference', () => {
    const actor = startFormulaEditing('=SUM(');

    actor.send(
      EditorEvents.formulaRangeSelected(
        { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
        '#4285f4',
      ),
    );

    expect(actor.getSnapshot().context.value).toBe('=SUM(A1:A2');

    actor.send(EditorEvents.commit('none'));

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches('validating')).toBe(true);
    expect(snapshot.context.value).toBe('=SUM(A1:A2)');
    expect(snapshot.context.cursorPosition).toBe('=SUM(A1:A2)'.length);

    actor.stop();
  });

  it('leaves manually typed incomplete function formulas for validation', () => {
    const actor = startFormulaEditing('=SUM(A1:A2');

    actor.send(EditorEvents.commit('none'));

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches('validating')).toBe(true);
    expect(snapshot.context.value).toBe('=SUM(A1:A2');

    actor.stop();
  });
});

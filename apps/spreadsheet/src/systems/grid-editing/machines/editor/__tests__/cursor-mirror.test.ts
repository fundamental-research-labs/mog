/**
 * INPUT cursor-mirror invariant
 *
 * The editor machine MUST mirror the DOM textarea's `selectionStart` for
 * every INPUT event — it must NOT invent a cursor position from
 * `value.length`. Inventing the cursor mid-typing races the
 * `useLayoutEffect` in `InlineCellEditor.tsx`, which writes the machine's
 * cursor back onto the DOM, corrupting every "type in the middle of an
 * existing cell value" interaction.
 *
 * These tests pin every cursor-location class (start, middle, end, replace
 * selection) plus the IME path so a future change to `insertRangeAtCursor`
 * or `commitIMEComposition` is caught by the unit suite, not by the slower
 * `app-eval` gate.
 *
 */

import { createActor } from 'xstate';
import { editorMachine } from '../../grid-editor-machine';
import { EditorEvents } from '../events';

type EditorActor = ReturnType<typeof createActor<typeof editorMachine>>;

/** Drive the machine into the regular editing state with `initial`. */
function startEditing(initial: string, cursor: number = initial.length): EditorActor {
  const actor = createActor(editorMachine);
  actor.start();
  actor.send(
    EditorEvents.startEditing(
      { row: 0, col: 0 },
      'sheet1',
      initial,
      undefined,
      'F2', // editMode entry — keeps caret arrows in-cell
      cursor,
    ),
  );
  // F2 enters editing.editMode; also set the explicit caret since
  // `initializeEditing` honors event.cursorPosition when provided.
  return actor;
}

describe('Editor INPUT — cursor mirrors DOM selectionStart', () => {
  // ---------------------------------------------------------------------------
  // Pure cursor-class tests
  // ---------------------------------------------------------------------------

  it('Type at start: "50" cursor 0 → INPUT "850" cursor 1 → context cursor 1', () => {
    const actor = startEditing('50', 0);
    actor.send(EditorEvents.input('850', 1));
    const ctx = actor.getSnapshot().context;
    expect(ctx.value).toBe('850');
    // Was 3 (length-of-value invented) before the fix — must be 1 now.
    expect(ctx.cursorPosition).toBe(1);
    actor.stop();
  });

  it('Type in middle: "abcde" cursor 2 → INPUT "abXcde" cursor 3 → context cursor 3', () => {
    const actor = startEditing('abcde', 2);
    actor.send(EditorEvents.input('abXcde', 3));
    const ctx = actor.getSnapshot().context;
    expect(ctx.value).toBe('abXcde');
    expect(ctx.cursorPosition).toBe(3);
    actor.stop();
  });

  it('Type at end: "abc" cursor 3 → INPUT "abcd" cursor 4 → context cursor 4', () => {
    const actor = startEditing('abc', 3);
    actor.send(EditorEvents.input('abcd', 4));
    const ctx = actor.getSnapshot().context;
    expect(ctx.value).toBe('abcd');
    expect(ctx.cursorPosition).toBe(4);
    actor.stop();
  });

  it('Replace selection: "abcde" with selection → INPUT "aXe" cursor 2 → context cursor 2', () => {
    // Models native textarea's setRangeText / typing-to-replace-selection
    // semantics: the DOM reports the post-insert caret, machine must mirror.
    const actor = startEditing('abcde', 1);
    actor.send(EditorEvents.input('aXe', 2));
    const ctx = actor.getSnapshot().context;
    expect(ctx.value).toBe('aXe');
    expect(ctx.cursorPosition).toBe(2);
    actor.stop();
  });

  it('Retry-select-all restores rejected text as a replaceable selection', () => {
    const actor = startEditing('99');

    actor.send(EditorEvents.commit('none'));
    actor.send(EditorEvents.validationError('Invalid value'));
    actor.send(EditorEvents.retrySelectAll());

    const ctx = actor.getSnapshot().context;
    expect(ctx.value).toBe('99');
    expect(ctx.cursorPosition).toBe(2);
    expect(ctx.selectionAnchor).toBe(0);
    expect(ctx.hasSelection).toBe(true);
    actor.stop();
  });

  it('INPUT and SET_CURSOR clear stale retry selections', () => {
    const actor = startEditing('99');

    actor.send(EditorEvents.commit('none'));
    actor.send(EditorEvents.validationError('Invalid value'));
    actor.send(EditorEvents.retrySelectAll());
    actor.send(EditorEvents.input('7', 1));

    let ctx = actor.getSnapshot().context;
    expect(ctx.value).toBe('7');
    expect(ctx.cursorPosition).toBe(1);
    expect(ctx.selectionAnchor).toBe(1);
    expect(ctx.hasSelection).toBe(false);

    actor.send(EditorEvents.setCursor(0));
    ctx = actor.getSnapshot().context;
    expect(ctx.cursorPosition).toBe(0);
    expect(ctx.selectionAnchor).toBe(0);
    expect(ctx.hasSelection).toBe(false);
    actor.stop();
  });

  // ---------------------------------------------------------------------------
  // IME composition end after mid-string caret
  //
  // Pins that `commitIMEComposition` uses the *real* (mirrored) caret
  // rather than the previously-invented end-of-string position. Without
  // –3 the cursor would have been forced to value.length on the
  // most recent INPUT, and the IME commit would have inserted at the end.
  // ---------------------------------------------------------------------------

  it('IME composition end after mid-string caret: "hello" cursor 2 → "he你好llo" cursor 4', () => {
    const actor = startEditing('hello', 5);

    // User clicked / arrow-keyed back to position 2 — modeled as SET_CURSOR.
    actor.send(EditorEvents.setCursor(2));
    expect(actor.getSnapshot().context.cursorPosition).toBe(2);

    actor.send(EditorEvents.imeStart());
    actor.send(EditorEvents.imeUpdate('你好'));
    actor.send(EditorEvents.imeEnd('你好'));

    const ctx = actor.getSnapshot().context;
    expect(ctx.value).toBe('he你好llo');
    expect(ctx.cursorPosition).toBe(4); // 2 (start) + 2 (composition length)
    actor.stop();
  });
});

import {
  isEditableKeyboardTarget,
  isGlobalShortcut,
  isNativeEditableShortcut,
  isSpreadsheetEditorKeyboardTarget,
} from '../focus-utils';

function keyboardEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('focus utils global shortcuts', () => {
  it.each([
    ['Ctrl+F1', { key: 'F1', ctrlKey: true }],
    ['Ctrl+Shift+F1', { key: 'F1', ctrlKey: true, shiftKey: true }],
    ['Meta+F1', { key: 'F1', metaKey: true }],
    ['Meta+Shift+F1', { key: 'F1', metaKey: true, shiftKey: true }],
    ['Ctrl+G', { key: 'g', ctrlKey: true }],
    ['Meta+G', { key: 'g', metaKey: true }],
  ] satisfies Array<[string, KeyboardEventInit]>)('routes %s globally', (_name, init) => {
    expect(isGlobalShortcut(keyboardEvent(init))).toBe(true);
  });

  it('does not match missing modifiers or shifted unshifted-only shortcuts', () => {
    expect(isGlobalShortcut(keyboardEvent({ key: 'F1', shiftKey: true }))).toBe(false);
    expect(isGlobalShortcut(keyboardEvent({ key: 'F1' }))).toBe(false);
    expect(isGlobalShortcut(keyboardEvent({ key: 's', ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
  });
});

describe('focus utils keyboard targets', () => {
  it('identifies editable controls', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    const textbox = document.createElement('div');
    const child = document.createElement('span');

    textbox.setAttribute('role', 'textbox');
    textbox.append(child);

    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(textbox)).toBe(true);
    expect(isEditableKeyboardTarget(child)).toBe(true);
    expect(isEditableKeyboardTarget(button)).toBe(false);
  });

  it('allows native shortcuts in editable controls', () => {
    const input = document.createElement('input');

    expect(isNativeEditableShortcut(keyboardEvent({ key: 'z', ctrlKey: true }), input)).toBe(true);
    expect(isNativeEditableShortcut(keyboardEvent({ key: 'b', ctrlKey: true }), input)).toBe(
      false,
    );
  });

  it('distinguishes spreadsheet editor inputs from other chrome inputs', () => {
    const nameBox = document.createElement('input');
    const formulaInput = document.createElement('input');
    const inlineEditor = document.createElement('textarea');

    nameBox.dataset.testid = 'name-box';
    formulaInput.dataset.testid = 'formula-bar-input';
    inlineEditor.dataset.testid = 'inline-cell-editor';

    expect(isSpreadsheetEditorKeyboardTarget(nameBox)).toBe(false);
    expect(isSpreadsheetEditorKeyboardTarget(formulaInput)).toBe(true);
    expect(isSpreadsheetEditorKeyboardTarget(inlineEditor)).toBe(true);
  });
});

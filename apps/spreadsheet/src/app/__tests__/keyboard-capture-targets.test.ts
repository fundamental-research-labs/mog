import {
  isNativeEditableShortcut,
  isSpreadsheetEditorKeyboardTarget,
  shouldDeferEditingKeyboardCapture,
  shouldDeferNonEditingKeyboardCapture,
} from '../keyboard-capture-targets';

describe('keyboard capture target routing', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('defers non-editing capture for native text entry controls', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const contentEditable = document.createElement('div');
    contentEditable.setAttribute('contenteditable', 'true');
    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');

    for (const element of [input, textarea, select, contentEditable, textbox]) {
      document.body.appendChild(element);
      expect(shouldDeferNonEditingKeyboardCapture(element)).toBe(true);
    }
  });

  it('defers non-editing capture for dialog descendants', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    document.body.appendChild(dialog);

    expect(shouldDeferNonEditingKeyboardCapture(button)).toBe(true);
  });

  it('does not defer ordinary spreadsheet chrome buttons', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    expect(shouldDeferNonEditingKeyboardCapture(button)).toBe(false);
  });

  it('defers editing capture for native chrome text inputs', () => {
    const input = document.createElement('input');
    input.setAttribute('data-testid', 'name-box');
    document.body.appendChild(input);

    expect(shouldDeferEditingKeyboardCapture(input)).toBe(true);
  });

  it('keeps spreadsheet editor inputs on the editor keyboard path', () => {
    const formulaBarInput = document.createElement('textarea');
    formulaBarInput.setAttribute('data-testid', 'formula-bar-input');
    const inlineCellEditor = document.createElement('textarea');
    inlineCellEditor.setAttribute('data-testid', 'inline-cell-editor');

    for (const element of [formulaBarInput, inlineCellEditor]) {
      document.body.appendChild(element);
      expect(isSpreadsheetEditorKeyboardTarget(element)).toBe(true);
      expect(shouldDeferEditingKeyboardCapture(element)).toBe(false);
    }
  });

  it('defers editing capture for dialog descendants', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    dialog.appendChild(input);
    document.body.appendChild(dialog);

    expect(shouldDeferEditingKeyboardCapture(input)).toBe(true);
  });

  it('preserves native clipboard and undo shortcuts in editable targets', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    expect(isNativeEditableShortcut(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }), input)).toBe(
      true,
    );
    expect(isNativeEditableShortcut(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }), input)).toBe(
      false,
    );
  });
});

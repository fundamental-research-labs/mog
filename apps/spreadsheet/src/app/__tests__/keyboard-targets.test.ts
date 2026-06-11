import {
  isChromeKeyboardTarget,
  isEditableKeyboardTarget,
  isNativeEditableShortcut,
} from '../keyboard-targets';

describe('keyboard target classification', () => {
  it('lets chrome-owned inputs handle their own navigation keys', () => {
    document.body.innerHTML =
      '<div data-mog-keyboard-scope="chrome-input"><input id="name-box" /></div>';

    const input = document.getElementById('name-box');

    expect(isChromeKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(input)).toBe(true);
  });

  it('does not classify ordinary editable fields as chrome-owned', () => {
    document.body.innerHTML = '<input id="plain-input" />';

    const input = document.getElementById('plain-input');

    expect(isChromeKeyboardTarget(input)).toBe(false);
    expect(isEditableKeyboardTarget(input)).toBe(true);
  });

  it('keeps native copy and undo shortcuts inside editable fields', () => {
    document.body.innerHTML = '<input id="plain-input" />';
    const input = document.getElementById('plain-input');
    const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
    const undo = new KeyboardEvent('keydown', { key: 'z', metaKey: true });

    expect(isNativeEditableShortcut(copy, input)).toBe(true);
    expect(isNativeEditableShortcut(undo, input)).toBe(true);
  });
});

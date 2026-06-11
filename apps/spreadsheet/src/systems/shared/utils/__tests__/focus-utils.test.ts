import { isGlobalShortcut, shouldDeferNavigationKeyToEditableTarget } from '../focus-utils';

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

describe('focus utils editable navigation targets', () => {
  it('defers Enter for chrome inputs inside the formula bar container', () => {
    const formulaBar = document.createElement('div');
    formulaBar.setAttribute('data-formula-bar', '');
    const input = document.createElement('input');
    input.setAttribute('data-testid', 'name-box');
    formulaBar.appendChild(input);

    expect(shouldDeferNavigationKeyToEditableTarget(keyboardEvent({ key: 'Enter' }), input)).toBe(
      true,
    );
  });

  it('does not defer Enter for the formula bar editor input', () => {
    const input = document.createElement('input');
    input.setAttribute('data-testid', 'formula-bar-input');

    expect(shouldDeferNavigationKeyToEditableTarget(keyboardEvent({ key: 'Enter' }), input)).toBe(
      false,
    );
  });
});

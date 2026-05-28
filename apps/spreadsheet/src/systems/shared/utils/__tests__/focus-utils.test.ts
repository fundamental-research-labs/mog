import { isGlobalShortcut } from '../focus-utils';

function keyboardEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('focus utils global shortcuts', () => {
  it.each([
    ['Ctrl+F1', { key: 'F1', ctrlKey: true }],
    ['Ctrl+Shift+F1', { key: 'F1', ctrlKey: true, shiftKey: true }],
    ['Meta+F1', { key: 'F1', metaKey: true }],
    ['Meta+Shift+F1', { key: 'F1', metaKey: true, shiftKey: true }],
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

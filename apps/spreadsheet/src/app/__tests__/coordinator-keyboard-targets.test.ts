import {
  isNameBoxKeyboardTarget,
  shouldYieldEditingNavigationKeyToTarget,
} from '../coordinator-keyboard-targets';

function keyEvent(key: string): Pick<KeyboardEvent, 'key'> {
  return { key };
}

describe('coordinator keyboard target helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('recognizes the editable Name Box target', () => {
    const input = document.createElement('input');
    input.dataset.testid = 'name-box';
    document.body.appendChild(input);

    expect(isNameBoxKeyboardTarget(input)).toBe(true);
  });

  it('yields Enter and Escape to the Name Box while editing', () => {
    const input = document.createElement('input');
    input.dataset.testid = 'name-box';
    document.body.appendChild(input);

    expect(shouldYieldEditingNavigationKeyToTarget(keyEvent('Enter'), input)).toBe(true);
    expect(shouldYieldEditingNavigationKeyToTarget(keyEvent('Escape'), input)).toBe(true);
  });

  it('keeps other targets and keys on the coordinator path', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    expect(shouldYieldEditingNavigationKeyToTarget(keyEvent('Enter'), input)).toBe(false);

    input.dataset.testid = 'name-box';
    expect(shouldYieldEditingNavigationKeyToTarget(keyEvent('Tab'), input)).toBe(false);
  });
});

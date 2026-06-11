import { isNameBoxKeyboardTarget } from '../coordinator-keyboard-targets';

describe('coordinator keyboard targets', () => {
  it('lets name box edit input handle its own navigation keys', () => {
    document.body.innerHTML = '<div><input data-testid="name-box" /></div>';

    const input = document.querySelector('input');

    expect(isNameBoxKeyboardTarget(input)).toBe(true);
  });

  it('does not treat the formula bar input as the name box', () => {
    document.body.innerHTML = '<input data-testid="formula-bar-input" />';

    const input = document.querySelector('input');

    expect(isNameBoxKeyboardTarget(input)).toBe(false);
  });

  it('does not treat the name box display button as an edit target', () => {
    document.body.innerHTML = '<button data-testid="name-box">A1</button>';

    const button = document.querySelector('button');

    expect(isNameBoxKeyboardTarget(button)).toBe(false);
  });
});

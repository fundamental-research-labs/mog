import { isNameBoxKeyboardTarget } from '../keyboard-event-targets';

describe('keyboard event target classification', () => {
  it('lets the name-box input own keyboard submission', () => {
    document.body.innerHTML = '<input data-testid="name-box" />';
    const input = document.querySelector('input');

    expect(isNameBoxKeyboardTarget(input)).toBe(true);
  });

  it('does not treat the collapsed name-box button as an editable name-box target', () => {
    document.body.innerHTML = '<button data-testid="name-box"><span>A1</span></button>';
    const label = document.querySelector('span');

    expect(isNameBoxKeyboardTarget(label)).toBe(false);
  });
});

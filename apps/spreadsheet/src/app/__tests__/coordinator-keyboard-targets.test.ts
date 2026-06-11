import { isNameBoxKeyboardTarget } from '../coordinator-keyboard-targets';

describe('coordinator keyboard target routing', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lets the Name Box input own keyboard events', () => {
    document.body.innerHTML = '<div><input data-testid="name-box" /></div>';

    const input = document.querySelector('input');

    expect(isNameBoxKeyboardTarget(input)).toBe(true);
  });

  it('recognizes child targets inside the Name Box display control', () => {
    document.body.innerHTML =
      '<button data-testid="name-box"><span data-child="label">A1</span></button>';

    const child = document.querySelector('[data-child="label"]');

    expect(isNameBoxKeyboardTarget(child as HTMLElement)).toBe(true);
  });

  it('does not bypass spreadsheet keyboard routing for other inputs', () => {
    document.body.innerHTML = '<input data-testid="formula-bar-input" />';

    const input = document.querySelector('input');

    expect(isNameBoxKeyboardTarget(input)).toBe(false);
    expect(isNameBoxKeyboardTarget(null)).toBe(false);
  });
});

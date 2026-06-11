import { isNameBoxKeyboardTarget } from '../coordinator-keydown-capture';

describe('coordinator keydown capture target checks', () => {
  it('recognizes name box controls and descendants', () => {
    document.body.innerHTML = `
      <button data-testid="name-box"><span id="label">A1</span></button>
      <input data-testid="name-box" id="editor" />
    `;

    expect(isNameBoxKeyboardTarget(document.getElementById('label'))).toBe(true);
    expect(isNameBoxKeyboardTarget(document.getElementById('editor'))).toBe(true);
  });

  it('does not classify the formula bar input as the name box', () => {
    document.body.innerHTML = '<input data-testid="formula-bar-input" id="formula-bar" />';

    expect(isNameBoxKeyboardTarget(document.getElementById('formula-bar'))).toBe(false);
  });
});

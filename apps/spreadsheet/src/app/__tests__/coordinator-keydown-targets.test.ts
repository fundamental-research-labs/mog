import { shouldLetEditableTargetHandleEditingNavigationKey } from '../coordinator-keydown-targets';

describe('coordinator keydown target routing', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lets the name box handle navigation keys while a cell edit is active', () => {
    document.body.innerHTML = '<div data-formula-bar><input data-testid="name-box" /></div>';
    const input = document.querySelector('[data-testid="name-box"]') as HTMLElement;

    expect(shouldLetEditableTargetHandleEditingNavigationKey(input)).toBe(true);
  });

  it('keeps formula bar navigation keys on the spreadsheet editor path', () => {
    document.body.innerHTML = '<div data-formula-bar><input /></div>';
    const input = document.querySelector('input') as HTMLElement;

    expect(shouldLetEditableTargetHandleEditingNavigationKey(input)).toBe(false);
  });

  it('keeps inline cell editor navigation keys on the spreadsheet editor path', () => {
    document.body.innerHTML = '<input data-testid="inline-cell-editor" />';
    const input = document.querySelector('[data-testid="inline-cell-editor"]') as HTMLElement;

    expect(shouldLetEditableTargetHandleEditingNavigationKey(input)).toBe(false);
  });
});

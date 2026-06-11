import {
  isSpreadsheetManagedEditableTarget,
  shouldDeferToExternalEditableTarget,
} from '../coordinator-keydown-capture';

describe('coordinator keydown capture target routing', () => {
  it('lets chrome text inputs handle Enter outside grid editing surfaces', () => {
    document.body.innerHTML = '<input data-testid="name-box" />';
    const input = document.querySelector('[data-testid="name-box"]') as HTMLInputElement;

    expect(shouldDeferToExternalEditableTarget(input)).toBe(true);
    expect(isSpreadsheetManagedEditableTarget(input)).toBe(false);
  });

  it('keeps formula bar input under spreadsheet keyboard management', () => {
    document.body.innerHTML = '<input data-testid="formula-bar-input" />';
    const input = document.querySelector('[data-testid="formula-bar-input"]') as HTMLInputElement;

    expect(shouldDeferToExternalEditableTarget(input)).toBe(false);
    expect(isSpreadsheetManagedEditableTarget(input)).toBe(true);
  });

  it('keeps inline grid editors under spreadsheet keyboard management', () => {
    document.body.innerHTML = [
      '<div data-spreadsheet-container>',
      '  <input data-testid="inline-cell-editor" />',
      '</div>',
    ].join('');
    const input = document.querySelector(
      '[data-testid="inline-cell-editor"]',
    ) as HTMLInputElement;

    expect(shouldDeferToExternalEditableTarget(input)).toBe(false);
    expect(isSpreadsheetManagedEditableTarget(input)).toBe(true);
  });
});

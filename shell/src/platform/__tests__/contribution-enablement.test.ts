import { evaluateEnablementPredicate, type EnablementContext } from '../contribution-enablement';

describe('evaluateEnablementPredicate', () => {
  const ctx: EnablementContext = {
    activeAppId: 'spreadsheet',
    activeResourceKind: 'workbook',
    selectionCount: 5,
    hasClipboard: true,
  };

  it('simple equality: activeAppId == "spreadsheet"', () => {
    expect(evaluateEnablementPredicate("activeAppId == 'spreadsheet'", ctx)).toBe(true);
    expect(evaluateEnablementPredicate("activeAppId == 'crm'", ctx)).toBe(false);
  });

  it('inequality: selectionCount > 0', () => {
    expect(evaluateEnablementPredicate('selectionCount > 0', ctx)).toBe(true);
    expect(evaluateEnablementPredicate('selectionCount > 10', ctx)).toBe(false);
  });

  it('boolean property: hasClipboard', () => {
    expect(evaluateEnablementPredicate('hasClipboard', ctx)).toBe(true);
    expect(evaluateEnablementPredicate('hasClipboard', { ...ctx, hasClipboard: false })).toBe(
      false,
    );
  });

  it('negation: !hasClipboard', () => {
    expect(evaluateEnablementPredicate('!hasClipboard', ctx)).toBe(false);
    expect(evaluateEnablementPredicate('!hasClipboard', { ...ctx, hasClipboard: false })).toBe(
      true,
    );
  });

  it('AND: activeAppId == "spreadsheet" && selectionCount > 0', () => {
    expect(
      evaluateEnablementPredicate("activeAppId == 'spreadsheet' && selectionCount > 0", ctx),
    ).toBe(true);
    expect(evaluateEnablementPredicate("activeAppId == 'crm' && selectionCount > 0", ctx)).toBe(
      false,
    );
  });

  it('OR: activeAppId == "crm" || activeAppId == "spreadsheet"', () => {
    expect(
      evaluateEnablementPredicate("activeAppId == 'crm' || activeAppId == 'spreadsheet'", ctx),
    ).toBe(true);
    expect(
      evaluateEnablementPredicate("activeAppId == 'crm' || activeAppId == 'database'", ctx),
    ).toBe(false);
  });

  it('always true: "true"', () => {
    expect(evaluateEnablementPredicate('true', ctx)).toBe(true);
    expect(evaluateEnablementPredicate('true', {})).toBe(true);
  });

  it('always false: "false"', () => {
    expect(evaluateEnablementPredicate('false', ctx)).toBe(false);
  });

  it('invalid predicate returns false (safe failure)', () => {
    expect(evaluateEnablementPredicate('', ctx)).toBe(false);
    expect(evaluateEnablementPredicate('===', ctx)).toBe(false);
    expect(evaluateEnablementPredicate('foo()', ctx)).toBe(false);
    expect(evaluateEnablementPredicate("'unterminated", ctx)).toBe(false);
  });

  it('less-than and less-than-or-equal', () => {
    expect(evaluateEnablementPredicate('selectionCount < 10', ctx)).toBe(true);
    expect(evaluateEnablementPredicate('selectionCount <= 5', ctx)).toBe(true);
    expect(evaluateEnablementPredicate('selectionCount < 5', ctx)).toBe(false);
  });

  it('not-equal operator', () => {
    expect(evaluateEnablementPredicate("activeAppId != 'crm'", ctx)).toBe(true);
    expect(evaluateEnablementPredicate("activeAppId != 'spreadsheet'", ctx)).toBe(false);
  });

  it('parenthesized expressions', () => {
    expect(
      evaluateEnablementPredicate("(activeAppId == 'spreadsheet') && (selectionCount > 0)", ctx),
    ).toBe(true);
  });
});

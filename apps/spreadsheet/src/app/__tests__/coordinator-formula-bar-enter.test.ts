import { shouldCommitFormulaBarEnterInPlace } from '../CoordinatorProvider';

function key(
  overrides: Partial<
    Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>
  > = {},
): Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'> {
  return {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

describe('formula bar Enter routing', () => {
  it('commits plain Enter in place while the formula bar owns focus', () => {
    expect(shouldCommitFormulaBarEnterInPlace(key(), 'formulaBar')).toBe(true);
  });

  it('leaves modified Enter and non-formula-bar focus on the shared keyboard route', () => {
    expect(shouldCommitFormulaBarEnterInPlace(key({ shiftKey: true }), 'formulaBar')).toBe(false);
    expect(shouldCommitFormulaBarEnterInPlace(key({ ctrlKey: true }), 'formulaBar')).toBe(false);
    expect(shouldCommitFormulaBarEnterInPlace(key(), 'grid')).toBe(false);
  });
});

import { shouldNormalizeEnteredZeroFormat } from '../interactive-format-normalization';

const ACCOUNTING_WITH_DASH_ZERO = '_(* #,##0.0_);_(* \\(#,##0.0\\);_(* "-"??_);_(@_)';

describe('interactive edit number-format normalization', () => {
  it('normalizes literal zero over formulas with placeholder-only accounting zero sections', () => {
    expect(
      shouldNormalizeEnteredZeroFormat('0', {
        hasFormula: true,
        format: { numberFormat: ACCOUNTING_WITH_DASH_ZERO },
      }),
    ).toBe(true);
  });

  it('does not normalize non-zero literals', () => {
    expect(
      shouldNormalizeEnteredZeroFormat('1', {
        hasFormula: true,
        format: { numberFormat: ACCOUNTING_WITH_DASH_ZERO },
      }),
    ).toBe(false);
  });

  it('does not normalize non-formula cells', () => {
    expect(
      shouldNormalizeEnteredZeroFormat('0', {
        hasFormula: false,
        format: { numberFormat: ACCOUNTING_WITH_DASH_ZERO },
      }),
    ).toBe(false);
  });

  it('keeps accounting formats whose zero section contains mandatory digits', () => {
    expect(
      shouldNormalizeEnteredZeroFormat('0', {
        hasFormula: true,
        format: {
          numberFormat: '_(* #,##0.0_);_(* \\(#,##0.0\\);_(* 0.0_);_(@_)',
        },
      }),
    ).toBe(false);
  });
});

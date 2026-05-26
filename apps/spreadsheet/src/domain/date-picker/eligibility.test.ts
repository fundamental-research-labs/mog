import { getDatePickerEligibility, normalizeDateValidationBounds } from './eligibility';

describe('date picker eligibility', () => {
  const base = {
    row: 0,
    col: 0,
    value: null,
    displayKind: 'blank' as const,
    resolvedNumberFormat: null,
    validationRule: null,
    schemaType: null,
    protectedOrReadOnly: false,
    dateSystem: '1900' as const,
  };

  it('prefers date validation over format', () => {
    expect(
      getDatePickerEligibility({
        ...base,
        displayKind: 'text',
        value: 'not a date',
        validationRule: {
          type: 'date',
          operator: 'between',
          formula1: '2026-01-01',
          formula2: '2026-12-31',
        },
      }),
    ).toMatchObject({ eligible: true, source: 'validation', kind: 'date' });
  });

  it('does not enable text that merely looks like a date', () => {
    expect(
      getDatePickerEligibility({ ...base, displayKind: 'text', value: '2026-03-01' }),
    ).toMatchObject({ eligible: false, reason: 'text-without-date-contract' });
  });

  it('enables finite serials under date and datetime formats', () => {
    expect(
      getDatePickerEligibility({
        ...base,
        displayKind: 'number',
        value: 46100.5,
        resolvedNumberFormat: 'yyyy-mm-dd hh:mm',
      }),
    ).toMatchObject({ eligible: true, kind: 'datetime', source: 'format-and-serial' });
  });

  it('rejects time-only formats', () => {
    expect(
      getDatePickerEligibility({
        ...base,
        displayKind: 'number',
        value: 0.5,
        resolvedNumberFormat: 'h:mm AM/PM',
      }),
    ).toMatchObject({ eligible: false, reason: 'time-only-format' });
  });

  it('normalizes static bounds with inclusive/exclusive semantics', () => {
    expect(
      normalizeDateValidationBounds({
        type: 'date',
        operator: 'greaterThan',
        formula1: '2026-03-01',
        errorStyle: 'stop',
      }),
    ).toMatchObject({ lower: { iso: '2026-03-01', inclusive: false } });
  });
});

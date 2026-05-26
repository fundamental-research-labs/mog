import { classifyDateFormat } from '../src/number-formats/date-classification';

describe('classifyDateFormat', () => {
  test.each([
    ['m/d/yyyy', 'date', true, false],
    ['yyyy-mm-dd', 'date', true, false],
    ['d-mmm-yy', 'date', true, false],
    ['m/d/yy h:mm', 'datetime', true, true],
    ['yyyy-mm-dd hh:mm:ss', 'datetime', true, true],
    ['h:mm AM/PM', 'time', false, true],
    ['h:mm:ss', 'time', false, true],
    ['m:ss', 'time', false, true],
    ['0', 'other', false, false],
    ['#,##0.00', 'other', false, false],
    ['0\\d', 'other', false, false],
    ['0 "days"', 'other', false, false],
    ['[Red]#,##0', 'other', false, false],
    ['General', 'other', false, false],
    ['@', 'other', false, false],
  ])('%s -> %s', (format, kind, hasDatePart, hasTimePart) => {
    expect(classifyDateFormat(format)).toMatchObject({
      kind,
      hasDatePart,
      hasTimePart,
      supported: kind !== 'other',
    });
  });
});

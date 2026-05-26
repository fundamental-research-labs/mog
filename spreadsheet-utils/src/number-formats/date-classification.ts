export interface DateFormatClassification {
  kind: 'date' | 'datetime' | 'time' | 'other';
  hasDatePart: boolean;
  hasTimePart: boolean;
  supported: boolean;
}

function stripLiteralFormatSections(formatCode: string): string {
  let out = '';
  let inQuote = false;
  let inBracket = false;
  for (let i = 0; i < formatCode.length; i++) {
    const ch = formatCode[i];
    if (inQuote) {
      if (ch === '"') inQuote = false;
      continue;
    }
    if (inBracket) {
      if (ch === ']') inBracket = false;
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (ch === '[') {
      inBracket = true;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '_') {
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

export function classifyDateFormat(
  formatCode: string | null | undefined,
): DateFormatClassification {
  if (
    !formatCode ||
    formatCode.trim() === '' ||
    /^general$/i.test(formatCode) ||
    formatCode === '@'
  ) {
    return { kind: 'other', hasDatePart: false, hasTimePart: false, supported: false };
  }

  const cleaned = stripLiteralFormatSections(formatCode);
  const upper = cleaned.toUpperCase();
  const hasYearOrDay = /[YD]/.test(upper);
  const hasHour = /H/.test(upper);
  const hasSecond = /(?<![#0])S/.test(upper);
  const hasAmPm = upper.includes('AM/PM') || upper.includes('A/P');
  const hasDatePart = hasYearOrDay;
  const hasTimePart = hasHour || hasSecond || hasAmPm;

  if (hasDatePart && hasTimePart) {
    return { kind: 'datetime', hasDatePart, hasTimePart, supported: true };
  }
  if (hasDatePart) {
    return { kind: 'date', hasDatePart, hasTimePart, supported: true };
  }
  if (hasTimePart) {
    return { kind: 'time', hasDatePart, hasTimePart, supported: true };
  }

  return { kind: 'other', hasDatePart: false, hasTimePart: false, supported: false };
}

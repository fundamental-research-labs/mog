import { detectFormatType } from './format-utils';
import { formatDateSerial } from './date-serial';

type FormatSection = {
  raw: string;
  index: number;
  condition?: FormatCondition;
  color?: ExcelNumberFormatColor;
};

type FormatCondition = {
  op: '<' | '<=' | '>' | '>=' | '=' | '<>';
  value: number;
};

export type ExcelNumberFormatSection =
  | 'general'
  | 'positive'
  | 'negative'
  | 'zero'
  | 'text'
  | 'conditional';

export type ExcelNumberFormatColor =
  | { kind: 'named'; name: ExcelNumberFormatColorName; color: string }
  | { kind: 'indexed'; name: `Color${number}`; index: number; color: string };

export type ExcelNumberFormatColorName =
  | 'Black'
  | 'Blue'
  | 'Cyan'
  | 'Green'
  | 'Magenta'
  | 'Red'
  | 'White'
  | 'Yellow';

export interface ExcelNumberFormatResult {
  text: string;
  color?: string;
  colorName?: string;
  colorIndex?: number;
  section?: ExcelNumberFormatSection;
  sectionIndex?: number;
}

const CONDITION_RE = /^\s*\[(<=|>=|<>|<|>|=)\s*(-?\d+(?:\.\d+)?)\]/;
const COLOR_OR_LOCALE_RE = /^\s*\[(?!<=|>=|<>|<|>|=)[^\]]+\]/;
const LEADING_BRACKET_DIRECTIVE_RE = /^\s*\[([^\]]+)\]/;

const NAMED_FORMAT_COLORS: Record<string, ExcelNumberFormatColorName> = {
  BLACK: 'Black',
  BLUE: 'Blue',
  CYAN: 'Cyan',
  GREEN: 'Green',
  MAGENTA: 'Magenta',
  RED: 'Red',
  WHITE: 'White',
  YELLOW: 'Yellow',
};

const NAMED_FORMAT_COLOR_HEX: Record<ExcelNumberFormatColorName, string> = {
  Black: '#000000',
  Blue: '#0000FF',
  Cyan: '#00FFFF',
  Green: '#008000',
  Magenta: '#FF00FF',
  Red: '#FF0000',
  White: '#FFFFFF',
  Yellow: '#FFFF00',
};

const EXCEL_INDEXED_FORMAT_COLORS = [
  '#000000',
  '#FFFFFF',
  '#FF0000',
  '#00FF00',
  '#0000FF',
  '#FFFF00',
  '#FF00FF',
  '#00FFFF',
  '#800000',
  '#008000',
  '#000080',
  '#808000',
  '#800080',
  '#008080',
  '#C0C0C0',
  '#808080',
  '#9999FF',
  '#993366',
  '#FFFFCC',
  '#CCFFFF',
  '#660066',
  '#FF8080',
  '#0066CC',
  '#CCCCFF',
  '#000080',
  '#FF00FF',
  '#FFFF00',
  '#00FFFF',
  '#800080',
  '#800000',
  '#008080',
  '#0000FF',
  '#00CCFF',
  '#CCFFFF',
  '#CCFFCC',
  '#FFFF99',
  '#99CCFF',
  '#FF99CC',
  '#CC99FF',
  '#FFCC99',
  '#3366FF',
  '#33CCCC',
  '#99CC00',
  '#FFCC00',
  '#FF9900',
  '#FF6600',
  '#666699',
  '#969696',
  '#003366',
  '#339966',
  '#003300',
  '#333300',
  '#993300',
  '#993366',
  '#333399',
  '#333333',
];

export function formatExcelValue(value: unknown, formatCode?: string): string {
  return formatExcelValueResult(value, formatCode).text;
}

export function formatExcelValueResult(
  value: unknown,
  formatCode?: string,
): ExcelNumberFormatResult {
  if (value === null || value === undefined) return { text: '', section: 'general' };
  if (value instanceof Date) return { text: value.toLocaleDateString(), section: 'general' };

  const numericValue = numericScalar(value);
  if (!Number.isFinite(numericValue)) return { text: String(value), section: 'general' };

  const normalized = formatCode?.trim();
  if (!normalized || normalized === 'General') {
    return { text: formatGeneralNumber(numericValue), section: 'general' };
  }

  const formatType = detectFormatType(normalized);
  const sections = splitSections(normalized).map(parseSection);
  const section = selectSection(numericValue, sections);
  if (!section) return { text: formatGeneralNumber(numericValue), section: 'general' };

  if (formatType === 'date' || formatType === 'time') {
    const formatted = formatDateSerial(numericValue, section.raw);
    return formatResult(formatted || String(value), section, numericValue, sections.length);
  }

  return formatResult(
    formatNumberSection(numericValue, section.raw),
    section,
    numericValue,
    sections.length,
  );
}

function numericScalar(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function formatGeneralNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(15)).toString();
}

function selectSection(value: number, sections: FormatSection[]): FormatSection | undefined {
  const conditional = sections.find(
    (section) => section.condition && matchesCondition(value, section.condition),
  );
  if (conditional) return conditional;

  if (sections.length === 1) return sections[0];
  if (value > 0) return sections[0];
  if (value < 0) return sections[1] ?? sections[0];
  return sections[2] ?? sections[0];
}

function splitSections(formatCode: string): string[] {
  const sections: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < formatCode.length; i += 1) {
    const char = formatCode[i];
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === '\\') {
      current += char;
      if (i + 1 < formatCode.length) current += formatCode[++i];
      continue;
    }
    if (char === ';' && !quoted) {
      sections.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  sections.push(current);
  return sections;
}

function parseSection(raw: string, index: number): FormatSection {
  let section = raw;
  let condition: FormatCondition | undefined;
  let color: ExcelNumberFormatColor | undefined;

  while (true) {
    const directiveMatch = section.match(LEADING_BRACKET_DIRECTIVE_RE);
    if (!directiveMatch) break;

    const conditionMatch = section.match(CONDITION_RE);
    if (conditionMatch) {
      condition ??= {
        op: conditionMatch[1] as FormatCondition['op'],
        value: Number(conditionMatch[2]),
      };
      section = section.slice(conditionMatch[0].length);
      continue;
    }

    const parsedColor = parseFormatColorDirective(directiveMatch[1]);
    if (!parsedColor) break;
    color ??= parsedColor;
    section = section.slice(directiveMatch[0].length);
  }

  return {
    raw: section,
    index,
    ...(condition !== undefined ? { condition } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

function matchesCondition(value: number, condition: FormatCondition): boolean {
  switch (condition.op) {
    case '<':
      return value < condition.value;
    case '<=':
      return value <= condition.value;
    case '>':
      return value > condition.value;
    case '>=':
      return value >= condition.value;
    case '=':
      return value === condition.value;
    case '<>':
      return value !== condition.value;
  }
}

function formatNumberSection(value: number, section: string): string {
  const stripped = stripDirectives(section);
  const percentCount = countUnquoted(stripped, '%');
  const scaled = value * Math.pow(100, percentCount);
  const isNegative = scaled < 0;
  const magnitude = Math.abs(scaled) / Math.pow(1000, trailingScaleCommas(stripped));
  const placeholders = placeholderRuns(stripped);

  if (placeholders.length === 0) return renderLiterals(stripped);

  if (isFractionPattern(stripped)) {
    return applyFractionToPattern(stripped, formatFraction(magnitude, stripped), isNegative);
  }

  if (/e[+-]?0+/i.test(stripped)) {
    return applyNumberToPattern(stripped, formatScientific(magnitude, stripped), isNegative);
  }

  const decimalPlaces = decimalPlacesForPattern(stripped);
  const useGrouping = /[#0?],[#0?]{3}/.test(stripped);
  const numeric = magnitude.toLocaleString('en-US', {
    useGrouping,
    minimumFractionDigits: decimalPlaces.required,
    maximumFractionDigits: decimalPlaces.maximum,
  });

  return applyNumberToPattern(stripped, numeric, isNegative);
}

function formatResult(
  text: string,
  section: FormatSection,
  value: number,
  sectionCount: number,
): ExcelNumberFormatResult {
  return {
    text,
    ...(section.color
      ? {
          color: section.color.color,
          colorName: section.color.name,
          ...(section.color.kind === 'indexed' ? { colorIndex: section.color.index } : {}),
        }
      : {}),
    section: sectionName(section, value, sectionCount),
    sectionIndex: section.index,
  };
}

function sectionName(
  section: FormatSection,
  value: number,
  sectionCount: number,
): ExcelNumberFormatSection {
  if (section.condition) return 'conditional';
  if (sectionCount >= 4 && section.index === 3) return 'text';
  if (sectionCount >= 3 && section.index === 2) return 'zero';
  if (sectionCount >= 2 && section.index === 1) return 'negative';
  if (value < 0 && sectionCount === 1) return 'negative';
  if (value === 0) return 'zero';
  return 'positive';
}

function parseFormatColorDirective(raw: string): ExcelNumberFormatColor | undefined {
  const directive = raw.trim();
  const named = NAMED_FORMAT_COLORS[directive.toUpperCase()];
  if (named) {
    return { kind: 'named', name: named, color: NAMED_FORMAT_COLOR_HEX[named] };
  }

  const indexed = directive.match(/^Color([1-9]|[1-4]\d|5[0-6])$/i);
  if (!indexed) return undefined;
  const index = Number(indexed[1]);
  return {
    kind: 'indexed',
    name: `Color${index}`,
    index,
    color: EXCEL_INDEXED_FORMAT_COLORS[index - 1] ?? '#000000',
  };
}

function stripDirectives(section: string): string {
  let result = section;
  while (COLOR_OR_LOCALE_RE.test(result)) {
    result = result.replace(COLOR_OR_LOCALE_RE, '');
  }
  return result;
}

function countUnquoted(pattern: string, target: string): number {
  let count = 0;
  forEachPatternChar(pattern, (char) => {
    if (char === target) count += 1;
  });
  return count;
}

function trailingScaleCommas(pattern: string): number {
  const cleaned = stripLiterals(pattern).replace(/[%_\*]/g, '');
  const match = cleaned.match(/[0#?](,+)(?:[^0#?]|$)/);
  return match?.[1].length ?? 0;
}

function placeholderRuns(pattern: string): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  let quoted = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '"') {
      if (start !== undefined) {
        runs.push({ start, end: i });
        start = undefined;
      }
      quoted = !quoted;
    }
    if (char === '\\') {
      if (start !== undefined) {
        runs.push({ start, end: i });
        start = undefined;
      }
      i += 1;
      continue;
    }
    const isPlaceholder = !quoted && /[0#?,.Ee+\-/]/.test(char);
    if (isPlaceholder && start === undefined) start = i;
    if (!isPlaceholder && start !== undefined) {
      runs.push({ start, end: i });
      start = undefined;
    }
  }
  if (start !== undefined) runs.push({ start, end: pattern.length });
  return runs.filter((run) => /[0#?]/.test(pattern.slice(run.start, run.end)));
}

function isFractionPattern(pattern: string): boolean {
  return /[0#?]\s+[?#0]+\/[?#0]+/.test(stripLiterals(pattern));
}

function fractionPatternRange(pattern: string): { start: number; end: number } | undefined {
  const match = pattern.match(/[0#?][0#? ]*\/[0#?]+|[0#?]+[ ]+[0#?]+\/[0#?]+/);
  return match?.index === undefined
    ? undefined
    : { start: match.index, end: match.index + match[0].length };
}

function applyFractionToPattern(
  pattern: string,
  formattedNumber: string,
  isNegative: boolean,
): string {
  const range = fractionPatternRange(pattern);
  if (!range) return applyNumberToPattern(pattern, formattedNumber, isNegative);
  let prefix = renderLiterals(pattern.slice(0, range.start));
  const suffix = renderLiterals(pattern.slice(range.end));
  if (isNegative && prefix === '$(') prefix = '($';
  const sign = isNegative && !prefix.includes('(') && !prefix.includes('-') ? '-' : '';
  return `${prefix}${sign}${formattedNumber}${suffix}`;
}

function formatFraction(value: number, pattern: string): string {
  const denominatorPattern = stripLiterals(pattern).match(/\/([?#0]+)/)?.[1] ?? '?';
  const fixedDenominator = Number(denominatorPattern.replace(/[?#]/g, ''));
  const maxDenominator =
    Number.isFinite(fixedDenominator) && fixedDenominator > 0
      ? fixedDenominator
      : Math.pow(10, denominatorPattern.length) - 1;
  const whole = Math.floor(value);
  const fraction = value - whole;
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Infinity;

  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(fraction * denominator);
    const error = Math.abs(fraction - numerator / denominator);
    if (error < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
    }
  }

  if (bestNumerator === 0) return String(whole);
  if (bestNumerator === bestDenominator) return String(whole + 1);
  return `${whole} ${bestNumerator}/${bestDenominator}`;
}

function formatScientific(value: number, pattern: string): string {
  const decimalPlaces = decimalPlacesForPattern(pattern).maximum;
  return value
    .toExponential(decimalPlaces)
    .replace(/e([+-])(\d+)$/i, (_match, sign: string, exponent: string) => {
      const width = pattern.match(/e[+-]?(0+)/i)?.[1].length ?? 2;
      return `E${sign}${exponent.padStart(width, '0')}`;
    });
}

function decimalPlacesForPattern(pattern: string): { required: number; maximum: number } {
  const cleaned = stripLiterals(pattern);
  const decimal = cleaned.match(/\.([0#?]+)/)?.[1] ?? '';
  return {
    required: [...decimal].filter((char) => char === '0').length,
    maximum: decimal.length,
  };
}

function applyNumberToPattern(
  pattern: string,
  formattedNumber: string,
  isNegative: boolean,
): string {
  const runs = placeholderRuns(pattern);
  const numberRun = runs[0];
  if (!numberRun) return renderLiterals(pattern);

  let prefix = renderLiterals(pattern.slice(0, numberRun.start));
  const suffix = renderLiterals(pattern.slice(numberRun.end));
  if (isNegative && prefix === '$(') prefix = '($';
  const sign = isNegative && !prefix.includes('(') && !prefix.includes('-') ? '-' : '';
  return `${prefix}${sign}${formattedNumber}${suffix}`;
}

function renderLiterals(pattern: string): string {
  let result = '';
  let quoted = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === '\\') {
      if (i + 1 < pattern.length) result += pattern[++i];
      continue;
    }
    if (!quoted && char === '_') {
      i += 1;
      continue;
    }
    if (!quoted && char === '*') {
      i += 1;
      continue;
    }
    if (!quoted && /[0#?,.Ee+]/.test(char)) continue;
    result += char;
  }

  return result.trim();
}

function stripLiterals(pattern: string): string {
  let result = '';
  forEachPatternChar(pattern, (char) => {
    result += char;
  });
  return result;
}

function forEachPatternChar(pattern: string, callback: (char: string) => void): void {
  let quoted = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (!quoted) callback(char);
  }
}

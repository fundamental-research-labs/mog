import type { CellFormat } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

type FormatRecord = Record<string, unknown>;

const FLAT_FORMAT_KEYS = new Set([
  'numberFormat',
  'numberFormatType',
  'fontFamily',
  'fontSize',
  'fontColor',
  'fontColorTint',
  'bold',
  'italic',
  'underlineType',
  'strikethrough',
  'superscript',
  'subscript',
  'fontOutline',
  'fontShadow',
  'fontTheme',
  'horizontalAlign',
  'verticalAlign',
  'wrapText',
  'indent',
  'textRotation',
  'shrinkToFit',
  'readingOrder',
  'autoIndent',
  'backgroundColor',
  'backgroundColorTint',
  'patternType',
  'patternForegroundColor',
  'patternForegroundColorTint',
  'gradientFill',
  'borders',
  'locked',
  'hidden',
  'forcedTextMode',
  'extensions',
]);

const COMPAT_CONTAINER_KEYS = new Set(['font', 'fill', 'alignment', 'protection', 'border']);
const BORDER_KEYS = new Set([
  'top',
  'right',
  'bottom',
  'left',
  'diagonal',
  'diagonalUp',
  'diagonalDown',
  'vertical',
  'horizontal',
  'outline',
  'start',
  'end',
]);
const BORDER_SIDE_KEYS = new Set(['style', 'color', 'colorTint', 'direction']);

export function normalizeCellFormatInput(format: unknown, path = 'format'): CellFormat {
  const source = asRecord(format, path);
  const result: FormatRecord = {};
  const compatEntries: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(source)) {
    if (FLAT_FORMAT_KEYS.has(key)) {
      result[key] =
        key === 'borders' && isRecord(value) ? normalizeBorders(value, [path, key]) : value;
    } else if (COMPAT_CONTAINER_KEYS.has(key)) {
      compatEntries.push([key, value]);
    } else {
      throwUnsupported([path, key]);
    }
  }

  for (const [key, value] of compatEntries) {
    switch (key) {
      case 'font':
        mergeFont(result, value, [path, key]);
        break;
      case 'fill':
        mergeFill(result, value, [path, key]);
        break;
      case 'alignment':
        mergeAlignment(result, value, [path, key]);
        break;
      case 'protection':
        mergeProtection(result, value, [path, key]);
        break;
      case 'border':
        assignIfUnset(result, 'borders', normalizeCompatBorder(value, [path, key]));
        break;
    }
  }

  return result as CellFormat;
}

export function normalizeCellFormatMapInput(
  updates: Map<number, unknown>,
  path: string,
): Map<number, CellFormat> {
  return new Map(
    Array.from(updates.entries(), ([index, format]) => [
      index,
      normalizeCellFormatInput(format, `${path}[${index}]`),
    ]),
  );
}

function mergeFont(result: FormatRecord, value: unknown, path: string[]): void {
  const font = asRecord(value, path.join('.'));
  for (const [key, nested] of Object.entries(font)) {
    switch (key) {
      case 'bold':
      case 'italic':
      case 'strikethrough':
      case 'superscript':
      case 'subscript':
      case 'fontOutline':
      case 'fontShadow':
      case 'fontTheme':
        assignIfUnset(result, key, nested);
        break;
      case 'name':
      case 'fontFamily':
        assignIfUnset(result, 'fontFamily', nested);
        break;
      case 'size':
      case 'fontSize':
        assignIfUnset(result, 'fontSize', nested);
        break;
      case 'color':
      case 'fontColor':
        assignIfUnset(result, 'fontColor', nested);
        break;
      case 'tintAndShade':
      case 'colorTint':
      case 'fontColorTint':
        assignIfUnset(result, 'fontColorTint', nested);
        break;
      case 'underline':
        assignIfUnset(result, 'underlineType', normalizeUnderline(nested));
        break;
      case 'underlineType':
        assignIfUnset(result, 'underlineType', nested);
        break;
      case 'outline':
        assignIfUnset(result, 'fontOutline', nested);
        break;
      case 'shadow':
        assignIfUnset(result, 'fontShadow', nested);
        break;
      default:
        throwUnsupported([...path, key]);
    }
  }
}

function mergeFill(result: FormatRecord, value: unknown, path: string[]): void {
  const fill = asRecord(value, path.join('.'));
  for (const [key, nested] of Object.entries(fill)) {
    switch (key) {
      case 'color':
      case 'backgroundColor':
        assignIfUnset(result, 'backgroundColor', nested);
        break;
      case 'tintAndShade':
      case 'backgroundColorTint':
        assignIfUnset(result, 'backgroundColorTint', nested);
        break;
      case 'pattern':
      case 'patternType':
        assignIfUnset(result, 'patternType', nested);
        break;
      case 'patternColor':
      case 'patternForegroundColor':
        assignIfUnset(result, 'patternForegroundColor', nested);
        break;
      case 'patternTintAndShade':
      case 'patternForegroundColorTint':
        assignIfUnset(result, 'patternForegroundColorTint', nested);
        break;
      case 'gradientFill':
        assignIfUnset(result, 'gradientFill', nested);
        break;
      default:
        throwUnsupported([...path, key]);
    }
  }
}

function mergeAlignment(result: FormatRecord, value: unknown, path: string[]): void {
  const alignment = asRecord(value, path.join('.'));
  for (const [key, nested] of Object.entries(alignment)) {
    switch (key) {
      case 'horizontalAlignment':
      case 'horizontalAlign':
        assignIfUnset(result, 'horizontalAlign', normalizeHorizontalAlign(nested));
        break;
      case 'verticalAlignment':
      case 'verticalAlign':
        assignIfUnset(result, 'verticalAlign', normalizeVerticalAlign(nested));
        break;
      case 'wrapText':
      case 'shrinkToFit':
      case 'readingOrder':
      case 'autoIndent':
        assignIfUnset(result, key, nested);
        break;
      case 'indent':
      case 'indentLevel':
        assignIfUnset(result, 'indent', nested);
        break;
      case 'textRotation':
      case 'textOrientation':
        assignIfUnset(result, 'textRotation', nested);
        break;
      default:
        throwUnsupported([...path, key]);
    }
  }
}

function mergeProtection(result: FormatRecord, value: unknown, path: string[]): void {
  const protection = asRecord(value, path.join('.'));
  for (const [key, nested] of Object.entries(protection)) {
    switch (key) {
      case 'locked':
      case 'hidden':
        assignIfUnset(result, key, nested);
        break;
      default:
        throwUnsupported([...path, key]);
    }
  }
}

function normalizeCompatBorder(value: unknown, path: string[]): FormatRecord {
  const border = asRecord(value, path.join('.'));
  const sideDefaults: FormatRecord = {};
  const borderEntries: FormatRecord = {};

  for (const [key, nested] of Object.entries(border)) {
    if (key === 'style' || key === 'color' || key === 'colorTint') {
      sideDefaults[key] = nested;
    } else if (BORDER_KEYS.has(key)) {
      borderEntries[key] = nested;
    } else {
      throwUnsupported([...path, key]);
    }
  }

  const hasSideDefaults = Object.keys(sideDefaults).length > 0;
  const normalizedBorders = normalizeBorders(borderEntries, path);

  if (hasSideDefaults) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      normalizedBorders[side] = {
        ...sideDefaults,
        ...(isRecord(normalizedBorders[side]) ? normalizedBorders[side] : {}),
      };
    }
  }

  return normalizedBorders;
}

function normalizeBorders(value: FormatRecord, path: string[]): FormatRecord {
  const result: FormatRecord = {};
  for (const [key, nested] of Object.entries(value)) {
    if (!BORDER_KEYS.has(key)) {
      throwUnsupported([...path, key]);
    }
    if (
      key === 'top' ||
      key === 'right' ||
      key === 'bottom' ||
      key === 'left' ||
      key === 'diagonal' ||
      key === 'vertical' ||
      key === 'horizontal' ||
      key === 'start' ||
      key === 'end'
    ) {
      result[key] = nested == null ? nested : normalizeBorderSide(nested, [...path, key]);
    } else {
      result[key] = nested;
    }
  }
  return result;
}

function normalizeBorderSide(value: unknown, path: string[]): FormatRecord {
  const side = asRecord(value, path.join('.'));
  const result: FormatRecord = {};
  for (const [key, nested] of Object.entries(side)) {
    if (!BORDER_SIDE_KEYS.has(key)) {
      throwUnsupported([...path, key]);
    }
    result[key] = nested;
  }
  return result;
}

function normalizeUnderline(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 'single' : 'none';
  }
  if (typeof value !== 'string') return value;

  const token = value.replace(/[\s_-]/g, '').toLowerCase();
  switch (token) {
    case 'none':
      return 'none';
    case 'single':
      return 'single';
    case 'double':
      return 'double';
    case 'singleaccounting':
      return 'singleAccounting';
    case 'doubleaccounting':
      return 'doubleAccounting';
    default:
      return value;
  }
}

function normalizeHorizontalAlign(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const token = value.replace(/[\s_-]/g, '').toLowerCase();
  switch (token) {
    case 'general':
    case 'left':
    case 'center':
    case 'right':
    case 'fill':
    case 'justify':
    case 'distributed':
      return token;
    case 'centercontinuous':
      return 'centerContinuous';
    default:
      return value;
  }
}

function normalizeVerticalAlign(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const token = value.replace(/[\s_-]/g, '').toLowerCase();
  switch (token) {
    case 'center':
      return 'middle';
    case 'top':
    case 'middle':
    case 'bottom':
    case 'justify':
    case 'distributed':
      return token;
    default:
      return value;
  }
}

function assignIfUnset(target: FormatRecord, key: string, value: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = value;
  }
}

function asRecord(value: unknown, path: string): FormatRecord {
  if (!isRecord(value)) {
    throw new KernelError('API_INVALID_ARGUMENT', `Expected ${path} to be an object.`, {
      path: path.split('.'),
    });
  }
  return value;
}

function isRecord(value: unknown): value is FormatRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function throwUnsupported(path: string[]): never {
  const joined = path.join('.');
  throw new KernelError('API_INVALID_ARGUMENT', `Unsupported format property "${joined}".`, {
    path,
    suggestion:
      'Use canonical CellFormat keys, or supported compatibility containers: font, fill, alignment, protection, and border.',
  });
}

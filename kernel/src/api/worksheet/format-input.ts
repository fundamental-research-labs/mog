import type { CellFormat, ResolvedCellFormat } from '@mog-sdk/contracts/core';
import { detectFormatType } from '@mog/spreadsheet-utils/number-formats';
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
  'fontCharset',
  'fontFamilyType',
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
  'pivotButton',
  'forcedTextMode',
  'extensions',
]);

const PUBLIC_FORMAT_KEYS = [
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
  'fontCharset',
  'fontFamilyType',
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
  'pivotButton',
  'forcedTextMode',
  'extensions',
] as const satisfies readonly (keyof CellFormat)[];

const PUBLIC_TO_PERSISTED_KEY: Partial<Record<keyof CellFormat, string>> = {
  forcedTextMode: 'quotePrefix',
};

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

export interface NormalizedCellFormatPatch {
  format: CellFormat;
  clearFields: string[];
}

export function normalizeCellFormatInput(
  format: unknown,
  path = 'format',
): NormalizedCellFormatPatch {
  const source = asRecord(format, path);
  const result: FormatRecord = {};
  const clearFields = new Set<string>();
  const compatEntries: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(source)) {
    if (FLAT_FORMAT_KEYS.has(key)) {
      if (key === 'numberFormatType') continue;
      const persistedKey = PUBLIC_TO_PERSISTED_KEY[key as keyof CellFormat] ?? key;
      assignPatch(
        result,
        clearFields,
        persistedKey,
        key === 'borders' && isRecord(value) ? normalizeBorders(value, [path, key]) : value,
      );
    } else if (COMPAT_CONTAINER_KEYS.has(key)) {
      compatEntries.push([key, value]);
    } else {
      throwUnsupported([path, key]);
    }
  }

  for (const [key, value] of compatEntries) {
    switch (key) {
      case 'font':
        mergeFont(result, clearFields, value, [path, key]);
        break;
      case 'fill':
        mergeFill(result, clearFields, value, [path, key]);
        break;
      case 'alignment':
        mergeAlignment(result, clearFields, value, [path, key]);
        break;
      case 'protection':
        mergeProtection(result, clearFields, value, [path, key]);
        break;
      case 'border':
        assignPatchIfUnset(
          result,
          clearFields,
          'borders',
          normalizeCompatBorder(value, [path, key]),
        );
        break;
    }
  }

  validateNumberFormatType(source, result, clearFields, path);
  return { format: result as CellFormat, clearFields: Array.from(clearFields) };
}

export function normalizeCellFormatMapInput(
  updates: Map<number, unknown>,
  path: string,
): Map<number, NormalizedCellFormatPatch> {
  return new Map(
    Array.from(updates.entries(), ([index, format]) => [
      index,
      normalizeCellFormatInput(format, `${path}[${index}]`),
    ]),
  );
}

function mergeFont(
  result: FormatRecord,
  clearFields: Set<string>,
  value: unknown,
  path: string[],
): void {
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
      case 'fontCharset':
      case 'fontFamilyType':
        assignPatchIfUnset(result, clearFields, key, nested);
        break;
      case 'name':
      case 'fontFamily':
        assignPatchIfUnset(result, clearFields, 'fontFamily', nested);
        break;
      case 'size':
      case 'fontSize':
        assignPatchIfUnset(result, clearFields, 'fontSize', nested);
        break;
      case 'color':
      case 'fontColor':
        assignPatchIfUnset(result, clearFields, 'fontColor', nested);
        break;
      case 'tintAndShade':
      case 'colorTint':
      case 'fontColorTint':
        assignPatchIfUnset(result, clearFields, 'fontColorTint', nested);
        break;
      case 'underline':
        assignPatchIfUnset(result, clearFields, 'underlineType', normalizeUnderline(nested));
        break;
      case 'underlineType':
        assignPatchIfUnset(result, clearFields, 'underlineType', nested);
        break;
      case 'outline':
        assignPatchIfUnset(result, clearFields, 'fontOutline', nested);
        break;
      case 'shadow':
        assignPatchIfUnset(result, clearFields, 'fontShadow', nested);
        break;
      default:
        throwUnsupported([...path, key]);
    }
  }
}

function mergeFill(
  result: FormatRecord,
  clearFields: Set<string>,
  value: unknown,
  path: string[],
): void {
  const fill = asRecord(value, path.join('.'));
  for (const [key, nested] of Object.entries(fill)) {
    switch (key) {
      case 'color':
      case 'backgroundColor':
        assignPatchIfUnset(result, clearFields, 'backgroundColor', nested);
        break;
      case 'tintAndShade':
      case 'backgroundColorTint':
        assignPatchIfUnset(result, clearFields, 'backgroundColorTint', nested);
        break;
      case 'pattern':
      case 'patternType':
        assignPatchIfUnset(result, clearFields, 'patternType', nested);
        break;
      case 'patternColor':
      case 'patternForegroundColor':
        assignPatchIfUnset(result, clearFields, 'patternForegroundColor', nested);
        break;
      case 'patternTintAndShade':
      case 'patternForegroundColorTint':
        assignPatchIfUnset(result, clearFields, 'patternForegroundColorTint', nested);
        break;
      case 'gradientFill':
        assignPatchIfUnset(result, clearFields, 'gradientFill', nested);
        break;
      default:
        throwUnsupported([...path, key]);
    }
  }
}

function mergeAlignment(
  result: FormatRecord,
  clearFields: Set<string>,
  value: unknown,
  path: string[],
): void {
  const alignment = asRecord(value, path.join('.'));
  for (const [key, nested] of Object.entries(alignment)) {
    switch (key) {
      case 'horizontalAlignment':
      case 'horizontalAlign':
        assignPatchIfUnset(
          result,
          clearFields,
          'horizontalAlign',
          normalizeHorizontalAlign(nested),
        );
        break;
      case 'verticalAlignment':
      case 'verticalAlign':
        assignPatchIfUnset(result, clearFields, 'verticalAlign', normalizeVerticalAlign(nested));
        break;
      case 'wrapText':
      case 'shrinkToFit':
      case 'readingOrder':
      case 'autoIndent':
        assignPatchIfUnset(result, clearFields, key, nested);
        break;
      case 'indent':
      case 'indentLevel':
        assignPatchIfUnset(result, clearFields, 'indent', nested);
        break;
      case 'textRotation':
      case 'textOrientation':
        assignPatchIfUnset(result, clearFields, 'textRotation', nested);
        break;
      default:
        throwUnsupported([...path, key]);
    }
  }
}

function mergeProtection(
  result: FormatRecord,
  clearFields: Set<string>,
  value: unknown,
  path: string[],
): void {
  const protection = asRecord(value, path.join('.'));
  for (const [key, nested] of Object.entries(protection)) {
    switch (key) {
      case 'locked':
      case 'hidden':
        assignPatchIfUnset(result, clearFields, key, nested);
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

export function projectCellFormat(format: unknown): CellFormat {
  return projectFormat(format, false) as CellFormat;
}

export function projectResolvedCellFormat(format: unknown): ResolvedCellFormat {
  return projectFormat(format, true) as ResolvedCellFormat;
}

function projectFormat(format: unknown, dense: boolean): FormatRecord {
  const source = asRecord(format, 'format result');
  const result: FormatRecord = {};

  for (const publicKey of PUBLIC_FORMAT_KEYS) {
    if (publicKey === 'numberFormatType') continue;
    const persistedKey = PUBLIC_TO_PERSISTED_KEY[publicKey] ?? publicKey;
    if (Object.prototype.hasOwnProperty.call(source, persistedKey)) {
      result[publicKey] = source[persistedKey];
    } else if (dense) {
      result[publicKey] = null;
    }
  }

  if (typeof result.numberFormat === 'string') {
    result.numberFormatType = detectFormatType(result.numberFormat);
  } else if (dense) {
    result.numberFormatType = null;
  }

  return result;
}

function validateNumberFormatType(
  source: FormatRecord,
  result: FormatRecord,
  clearFields: Set<string>,
  path: string,
): void {
  if (!Object.prototype.hasOwnProperty.call(source, 'numberFormatType')) return;

  const category = source.numberFormatType;
  const setsFormat = typeof result.numberFormat === 'string';
  const clearsFormat = clearFields.has('numberFormat');
  if (!setsFormat && !clearsFormat) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${path}.numberFormatType is derived and must accompany numberFormat.`,
      { path: [...path.split('.'), 'numberFormatType'] },
    );
  }
  if (clearsFormat) {
    if (category !== null) {
      throw new KernelError(
        'API_INVALID_ARGUMENT',
        `${path}.numberFormatType must be null when numberFormat is null.`,
        { path: [...path.split('.'), 'numberFormatType'] },
      );
    }
    return;
  }

  const expected = detectFormatType(result.numberFormat as string);
  if (category !== expected) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${path}.numberFormatType must match numberFormat (expected "${expected}").`,
      {
        path: [...path.split('.'), 'numberFormatType'],
        context: { expected, actual: category },
      },
    );
  }
}

function assignPatch(
  target: FormatRecord,
  clearFields: Set<string>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (value === null) {
    clearFields.add(key);
    delete target[key];
  } else {
    target[key] = value;
    clearFields.delete(key);
  }
}

function assignPatchIfUnset(
  target: FormatRecord,
  clearFields: Set<string>,
  key: string,
  value: unknown,
): void {
  if (!Object.prototype.hasOwnProperty.call(target, key) && !clearFields.has(key)) {
    assignPatch(target, clearFields, key, value);
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

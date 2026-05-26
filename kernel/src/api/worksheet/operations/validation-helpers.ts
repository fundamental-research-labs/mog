/**
 * Validation Helpers
 *
 * Shared conversion helpers for translating between the public ValidationRule type
 * and internal RangeSchema format.
 *
 * Extracted from worksheet/validation.ts to keep the API sub-class a thin delegation facade.
 */
import type { ValidationRule } from '@mog-sdk/contracts/api';

import { dateToSerial, serialToDate } from '@mog/spreadsheet-utils/number-formats';

import type {
  EnforcementLevel,
  RangeSchema,
  SchemaConstraints,
  SchemaType,
} from '../../../bridges/compute/compute-bridge';
import { parseCellRange, toA1 } from '../../internal/utils';

/**
 * Try to parse a date string (e.g. "2024-01-01") and convert to an Excel serial number.
 * Returns the serial number if successful, or NaN if the string is not a valid date.
 *
 * We manually parse to avoid timezone issues with `new Date(str)` which parses ISO strings
 * as UTC but `dateToSerial` reads local-time components from the Date object.
 */
function dateStringToSerial(value: string | number): number {
  if (typeof value === 'number') return value;
  // Match YYYY-MM-DD (optionally with time)
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-based month
    const day = parseInt(match[3], 10);
    // Create date using local constructor so dateToSerial reads back the same components
    const d = new Date(year, month, day);
    return dateToSerial(d);
  }
  // Fallback: try generic parse
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return dateToSerial(d);
  }
  return NaN;
}

/**
 * Convert an Excel serial number back to an ISO date string (YYYY-MM-DD).
 * Returns the string representation, or the number itself if conversion fails.
 */
function serialToDateString(serial: number): string {
  if (!isFinite(serial)) return String(serial);
  const d = serialToDate(serial);
  if (isNaN(d.getTime())) return String(serial);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a time-of-day string (e.g. "12:30" or "14:05:30") into an Excel time
 * serial — the fractional-day form Excel uses for time values (0 ≤ s < 1).
 * Returns NaN when the input doesn't match HH:MM[:SS]; passes through numbers.
 */
function timeStringToSerial(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return NaN;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = match[3] ? parseInt(match[3], 10) : 0;
  if (h > 23 || m > 59 || s > 59) return NaN;
  return (h * 3600 + m * 60 + s) / 86400;
}

/**
 * Convert an Excel time serial (fraction-of-day) back to an HH:MM string. Only
 * the fractional part contributes — date components are dropped because <input
 * type="time"> consumes time-of-day strings.
 */
function serialToTimeString(serial: number): string {
  if (!isFinite(serial)) return String(serial);
  const frac = serial - Math.floor(serial);
  const totalSeconds = Math.round(frac * 86400);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Map ValidationRule.type to the gen'd SchemaType.
 *
 * ValidationRule types are API-level validation categories ('list', 'wholeNumber', etc.).
 * SchemaType is the Rust-authoritative data type enum. Some validation types map directly
 * (date, time), others map to their underlying data type (wholeNumber -> integer,
 * decimal -> number). 'list' and 'custom' have no corresponding SchemaType — the
 * validation behavior is captured in constraints, not in the type field.
 */
export function validationTypeToSchemaType(type: ValidationRule['type']): SchemaType | undefined {
  switch (type) {
    case 'wholeNumber':
      return 'integer';
    case 'decimal':
      return 'number';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'none':
    case 'list':
    case 'textLength':
    case 'custom':
      return undefined;
  }
}

/**
 * Map SchemaType back to a ValidationRule.type for round-tripping.
 *
 * This is the inverse of validationTypeToSchemaType. When the type is undefined
 * (list, textLength, custom), we infer from constraints:
 * - Has enum/enumSource -> 'list'
 * - Has minLength/maxLength -> 'textLength'
 * - Has formula -> 'custom'
 * - Fallback -> 'custom'
 */
export function schemaTypeToValidationType(
  type: SchemaType | undefined,
  constraints?: SchemaConstraints,
): ValidationRule['type'] {
  if (type != null) {
    switch (type) {
      case 'integer':
        return 'wholeNumber';
      case 'number':
        return 'decimal';
      case 'date':
        return 'date';
      case 'time':
        return 'time';
    }
  }
  // Infer from constraints when type is undefined or doesn't map to a validation type
  if (constraints) {
    if (
      constraints.enum != null ||
      constraints.enumSource != null ||
      constraints.enumSourceFormula != null
    )
      return 'list';
    if (constraints.minLength != null || constraints.maxLength != null) return 'textLength';
    if (constraints.formula != null) return 'custom';
  }
  return 'custom';
}

/**
 * Parse a "row:col" or "cell-{sheet}-{row}-{col}" ref ID to coordinates.
 */
export function parseRefIdSimple(id: string): { row: number; col: number } | null {
  const colonIdx = id.indexOf(':');
  if (colonIdx > 0) {
    const row = parseInt(id.substring(0, colonIdx), 10);
    const col = parseInt(id.substring(colonIdx + 1), 10);
    if (!isNaN(row) && !isNaN(col) && row >= 0 && col >= 0) return { row, col };
  }
  if (id.startsWith('cell-')) {
    const parts = id.split('-');
    if (parts.length >= 4) {
      const col = parseInt(parts[parts.length - 1], 10);
      const row = parseInt(parts[parts.length - 2], 10);
      if (!isNaN(row) && !isNaN(col) && row >= 0 && col >= 0) return { row, col };
    }
  }
  return null;
}

/**
 * Map ValidationRule.errorStyle to RangeSchema.enforcement.
 */
export function errorStyleToEnforcement(
  errorStyle?: 'stop' | 'warning' | 'information',
): EnforcementLevel {
  switch (errorStyle) {
    case 'stop':
      return 'strict';
    case 'warning':
      return 'warning';
    case 'information':
      return 'info';
    default:
      return 'strict';
  }
}

/**
 * Map RangeSchema.enforcement back to ValidationRule.errorStyle.
 */
export function enforcementToErrorStyle(
  enforcement?: EnforcementLevel,
): 'stop' | 'warning' | 'information' {
  switch (enforcement) {
    case 'strict':
      return 'stop';
    case 'warning':
      return 'warning';
    case 'info':
      return 'information';
    default:
      return 'stop';
  }
}

/**
 * Strip Excel absolute-reference markers ("$") so parseCellRange can handle
 * canonical stored refs like `$A$1:$A$5`. The underlying parser is purely
 * address-shape — the anchor state is not meaningful at the validation layer.
 */
function stripAbsoluteMarkers(ref: string): string {
  return ref.replace(/\$/g, '');
}

/**
 * Parse an Excel inline list literal — a comma-separated string where double-quoted
 * segments may embed literal commas. Used for ValidationRule.listSource when the
 * string is not a reference (no `=` prefix).
 *
 * Examples:
 *   parseInlineList('Red,Green,Blue')        -> ['Red', 'Green', 'Blue']
 *   parseInlineList('"A,B",C')               -> ['A,B', 'C']
 *   parseInlineList('  Red , Green , Blue ') -> ['Red', 'Green', 'Blue']
 *   parseInlineList('""Quoted""')            -> ['"Quoted"']   (Excel doubles quotes)
 */
export function parseInlineList(source: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuote) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        buf += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf.trim());
  return out;
}

/**
 * Interpret a list-source string (from either ValidationRule.listSource or
 * ValidationRule.formula1 on a list-type rule) and write it to the appropriate
 * constraints field:
 *   - "=A1:B2" / "$A$1:$A$5" (range, with or without leading `=`) -> enumSource
 *   - "=IndirectFormula(...)" (formula, `=` prefix required)     -> enumSourceFormula
 *   - "Red,Green,Blue" (inline literal)                           -> enum
 *
 * Returns true if the source was recognised and written to `c`.
 *
 * Known limitation: cross-sheet refs like "Sheet1!A1:A5" are parsed as ranges but
 * the sheet name is dropped — the getDropdownItems resolver defaults to the
 * schema's home sheet. Cross-sheet sources remain future work; current callers
 * (dropdown picker) only use same-sheet ranges.
 */
export function applyListSourceString(source: string, c: SchemaConstraints): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;

  const hasEquals = trimmed.startsWith('=');
  const body = hasEquals ? trimmed.slice(1) : trimmed;

  // Try range reference (handles absolute refs via $-stripping).
  const range = parseCellRange(stripAbsoluteMarkers(body));
  if (range) {
    c.enumSource = {
      startId: `${range.startRow}:${range.startCol}`,
      endId: `${range.endRow}:${range.endCol}`,
    };
    return true;
  }

  // `=` prefix with non-range body -> treat as formula (named range, INDIRECT, etc.)
  if (hasEquals) {
    c.enumSourceFormula = body;
    return true;
  }

  // Bare string -> Excel inline list literal.
  c.enum = parseInlineList(body);
  return true;
}

/**
 * Convert a ValidationRule to SchemaConstraints fields.
 *
 * formula1/formula2 are `string | number` in the API contract but
 * SchemaConstraints numeric fields are `number`. We coerce with Number().
 */
export function validationRuleToConstraints(rule: ValidationRule): SchemaConstraints {
  const c: SchemaConstraints = {};
  if (rule.allowBlank != null) c.allowBlank = rule.allowBlank;

  if (rule.type === 'list' && rule.values) {
    c.enum = rule.values;
  }

  // Handle list type with formula1 as an inline literal, range reference, or formula.
  // Per Excel's canonical storage, `formula1` for list validation may be any of:
  //   "Red,Green,Blue"     (inline values)
  //   "$A$1:$A$5"          (range reference, with or without leading `=`)
  //   "=Colors"            (named range / formula, `=` required)
  // The bare-range form (no `=`) is how XLSX stores list-source ranges.
  if (rule.type === 'list' && rule.formula1 != null && c.enum == null) {
    applyListSourceString(String(rule.formula1), c);
  }

  // For non-list types, formula1 flows into the numeric operator block below.
  if (rule.type !== 'list' && rule.formula1 != null) {
    // Each branch normalises the API-level string/number into the numeric
    // serial form `SchemaConstraints` expects. `'date'` parses YYYY-MM-DD
    // into a date serial; `'time'` parses HH:MM[:SS] into a fractional-day
    // time serial. Numeric branches just coerce.
    const toNumeric = (v: string | number): number => {
      switch (rule.type) {
        case 'date':
          return dateStringToSerial(v);
        case 'time':
          return timeStringToSerial(v);
        default:
          return Number(v);
      }
    };
    const v1 = toNumeric(rule.formula1);
    const v2 = rule.formula2 != null ? toNumeric(rule.formula2) : undefined;
    switch (rule.operator) {
      case 'equal':
        c.equal = v1;
        break;
      case 'notEqual':
        c.notEqual = v1;
        break;
      case 'greaterThan':
        c.exclusiveMin = v1;
        break;
      case 'lessThan':
        c.exclusiveMax = v1;
        break;
      case 'greaterThanOrEqual':
        c.min = v1;
        break;
      case 'lessThanOrEqual':
        c.max = v1;
        break;
      case 'between':
        c.min = v1;
        if (v2 != null) c.max = v2;
        break;
      case 'notBetween':
        c.notBetweenMin = v1;
        if (v2 != null) c.notBetweenMax = v2;
        break;
    }
  }

  if (rule.type === 'textLength' && rule.formula1 != null) {
    const v1 = Number(rule.formula1);
    const v2 = rule.formula2 != null ? Number(rule.formula2) : undefined;
    switch (rule.operator) {
      case 'equal':
        c.minLength = v1;
        c.maxLength = v1;
        break;
      case 'greaterThan':
        c.minLength = v1 + 1;
        break;
      case 'lessThan':
        c.maxLength = v1 - 1;
        break;
      case 'greaterThanOrEqual':
        c.minLength = v1;
        break;
      case 'lessThanOrEqual':
        c.maxLength = v1;
        break;
      case 'between':
        c.minLength = v1;
        if (v2 != null) c.maxLength = v2;
        break;
    }
  }

  if (rule.type === 'custom' && rule.formula1 != null) {
    c.formula = String(rule.formula1);
  }

  return c;
}

/**
 * Convert a RangeSchema to a ValidationRule.
 */
export function rangeSchemaToValidationRule(schema: RangeSchema): ValidationRule {
  const s = schema.schema;
  const c = s.constraints ?? {};

  // Convert range ref IDs to A1 notation
  let range: string | undefined;
  if (schema.ranges.length > 0) {
    const ref = schema.ranges[0];
    const start = parseRefIdSimple(ref.startId);
    const end = parseRefIdSimple(ref.endId);
    if (start && end) {
      const startA1 = toA1(start.row, start.col);
      const endA1 = toA1(end.row, end.col);
      range = startA1 === endA1 ? startA1 : `${startA1}:${endA1}`;
    }
  }

  const ui = schema.ui;
  const showDropdown = ui && 'showDropdown' in ui ? ui.showDropdown : undefined;
  const errorMsg = ui?.errorMessage;
  const inputMsg = ui?.inputMessage;
  const rule: ValidationRule = {
    id: schema.id,
    range,
    type: schemaTypeToValidationType(s.type, c),
    allowBlank: c.allowBlank,
    showDropdown,
    errorStyle: enforcementToErrorStyle(schema.enforcement),
    errorTitle: errorMsg?.title,
    errorMessage: errorMsg?.message,
    inputTitle: inputMsg?.title,
    inputMessage: inputMsg?.message,
    showErrorAlert: !!errorMsg,
    showInputMessage: !!inputMsg,
  };

  if (c.enum) {
    rule.values = c.enum.map(String);
  }

  // Resolve list source (range reference or formula)
  if (c.enumSourceFormula) {
    rule.listSource = `=${c.enumSourceFormula}`;
  } else if (c.enumSource) {
    const src = c.enumSource;
    if (src.startId && src.endId) {
      const srcStart = parseRefIdSimple(src.startId);
      const srcEnd = parseRefIdSimple(src.endId);
      if (srcStart && srcEnd) {
        const srcStartA1 = toA1(srcStart.row, srcStart.col);
        const srcEndA1 = toA1(srcEnd.row, srcEnd.col);
        rule.listSource = srcStartA1 === srcEndA1 ? `=${srcStartA1}` : `=${srcStartA1}:${srcEndA1}`;
      }
    }
  }

  // Text-length constraints live on minLength/maxLength (not min/max), so
  // handle them in their own branch before the numeric-operator ladder below.
  // `equal` at the rule level isn't recoverable from just the constraints
  // (minLength==maxLength could be either `equal` or a between with matching
  // bounds), so we surface both cases as `between` — lossy but stable.
  if (rule.type === 'textLength') {
    if (c.minLength != null && c.maxLength != null) {
      rule.operator = 'between';
      rule.formula1 = c.minLength;
      rule.formula2 = c.maxLength;
    } else if (c.minLength != null) {
      rule.operator = 'greaterThanOrEqual';
      rule.formula1 = c.minLength;
    } else if (c.maxLength != null) {
      rule.operator = 'lessThanOrEqual';
      rule.formula1 = c.maxLength;
    }
    if (c.formula) {
      rule.formula1 = c.formula;
    }
    return rule;
  }

  // Determine operator from constraints
  if (c.equal != null) {
    rule.operator = 'equal';
    rule.formula1 =
      typeof c.equal === 'string' || typeof c.equal === 'number' ? c.equal : String(c.equal);
  } else if (c.notEqual != null) {
    rule.operator = 'notEqual';
    rule.formula1 =
      typeof c.notEqual === 'string' || typeof c.notEqual === 'number'
        ? c.notEqual
        : String(c.notEqual);
  } else if (c.exclusiveMin != null) {
    rule.operator = 'greaterThan';
    rule.formula1 = c.exclusiveMin;
  } else if (c.exclusiveMax != null) {
    rule.operator = 'lessThan';
    rule.formula1 = c.exclusiveMax;
  } else if (c.notBetweenMin != null) {
    rule.operator = 'notBetween';
    rule.formula1 = c.notBetweenMin;
    if (c.notBetweenMax != null) rule.formula2 = c.notBetweenMax;
  } else if (c.min != null && c.max != null) {
    rule.operator = 'between';
    rule.formula1 = c.min;
    rule.formula2 = c.max;
  } else if (c.min != null) {
    rule.operator = 'greaterThanOrEqual';
    rule.formula1 = c.min;
  } else if (c.max != null) {
    rule.operator = 'lessThanOrEqual';
    rule.formula1 = c.max;
  }

  if (c.formula) {
    rule.formula1 = c.formula;
  }

  // For date/time types, convert serial numbers back to the matching string
  // form so the dialog's <input type="date"> / <input type="time"> consume them
  // directly. Date serials → YYYY-MM-DD; time serials → HH:MM.
  if (rule.type === 'date') {
    if (typeof rule.formula1 === 'number') {
      rule.formula1 = serialToDateString(rule.formula1);
    }
    if (typeof rule.formula2 === 'number') {
      rule.formula2 = serialToDateString(rule.formula2);
    }
  } else if (rule.type === 'time') {
    if (typeof rule.formula1 === 'number') {
      rule.formula1 = serialToTimeString(rule.formula1);
    }
    if (typeof rule.formula2 === 'number') {
      rule.formula2 = serialToTimeString(rule.formula2);
    }
  }

  return rule;
}

import type {
  CellFormat,
  VersionDiffValue,
  VersionMergeChange,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import type { ParsedRowColumnEntity } from './version-merge-materialization-plan-entities';
import type {
  CellMergeValue,
  DirectFormatMergeValue,
  RowColumnMergeValue,
  RowColumnTransition,
  SheetMetadataMergeValue,
  SheetMetadataProperty,
} from './version-merge-materialization-plan-types';

export function parseCellMergeValue(
  value: VersionDiffValue,
  domain: string,
): CellMergeValue | null {
  if (value.kind !== 'value') return null;
  if (domain === 'cells.formulas') return parseSemanticFormulaCellValue(value.value);
  return parseSemanticCellValue(value.value);
}

export function isNoopCellMergeChange(
  change: VersionMergeChange,
  domain: string,
  merged: CellMergeValue,
): boolean {
  const current = parseCellMergeValue(change.ours ?? change.base, domain);
  return current ? cellMergeValuesEqual(current, merged) : false;
}

export function parseDirectFormatMergeValue(
  value: VersionDiffValue,
): DirectFormatMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'clear' };
  const plain = semanticFormatJsonValue(value.value);
  if (!isMaterializableCellFormat(plain)) return null;
  return { kind: 'format', format: plain };
}

export function isNoopDirectFormatMergeChange(
  change: VersionMergeChange,
  merged: DirectFormatMergeValue,
): boolean {
  const current = parseDirectFormatMergeValue(change.ours ?? change.base);
  return current ? directFormatMergeValuesEqual(current, merged) : false;
}

export function parseRowColumnTransition(
  change: VersionMergeChange,
  target: ParsedRowColumnEntity,
): RowColumnTransition | null {
  const current = parseRowColumnMergeValue(change.ours ?? change.base, target);
  const merged = parseRowColumnMergeValue(change.merged, target);
  if (!current || !merged) return null;
  if (rowColumnValuesEqual(current, merged)) return { kind: 'noop' };
  if (current.kind === 'absent' && merged.kind === 'present') {
    return { kind: 'insert', sheetId: target.sheetId, axis: target.axis, index: target.index };
  }
  if (current.kind === 'present' && merged.kind === 'absent') {
    return { kind: 'delete', sheetId: target.sheetId, axis: target.axis, index: target.index };
  }
  return null;
}

export function parseSheetMetadataMergeValue(
  value: VersionDiffValue,
  property: SheetMetadataProperty,
): SheetMetadataMergeValue | null {
  if (value.kind !== 'value') return null;
  if (property === 'name') {
    return typeof value.value === 'string' && value.value.length > 0
      ? { property, value: value.value }
      : null;
  }
  if (property === 'frozen') {
    return parseFrozenPaneMergeValue(value.value);
  }
  return value.value === null || typeof value.value === 'string'
    ? { property, value: value.value }
    : null;
}

export function isNoopSheetMetadataMergeChange(
  change: VersionMergeChange,
  property: SheetMetadataProperty,
  merged: SheetMetadataMergeValue,
): boolean {
  const current = parseSheetMetadataMergeValue(change.ours ?? change.base, property);
  return current ? sheetMetadataMergeValuesEqual(current, merged) : false;
}

function parseSemanticCellValue(value: VersionSemanticValue): CellMergeValue | null {
  if (value === null) return { kind: 'clear' };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'scalar', value };
  }
  if (typeof value !== 'object') return null;
  if (value.kind === 'blank') return { kind: 'clear' };
  if (value.kind === 'formula') {
    return typeof value.formula === 'string' && value.formula.length > 0
      ? { kind: 'formula', formula: value.formula }
      : null;
  }
  return null;
}

function parseSemanticFormulaCellValue(value: VersionSemanticValue): CellMergeValue | null {
  if (value === null) return { kind: 'clear' };
  if (typeof value !== 'object') return null;
  if (value.kind === 'blank') return { kind: 'clear' };
  if (value.kind !== 'formula') return null;
  return typeof value.formula === 'string' && value.formula.length > 0
    ? { kind: 'formula', formula: value.formula }
    : null;
}

function parseRowColumnMergeValue(
  value: VersionDiffValue,
  target: ParsedRowColumnEntity,
): RowColumnMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'absent' };
  const fields = semanticObjectFieldMap(value.value);
  if (!fields) return null;
  const axis = fields.get('axis');
  const sheetId = fields.get('sheetId');
  const index = fields.get('index');
  if (axis !== target.axis || sheetId !== target.sheetId || index !== target.index) {
    return null;
  }
  return { kind: 'present', sheetId: target.sheetId, axis: target.axis, index: target.index };
}

function rowColumnValuesEqual(left: RowColumnMergeValue, right: RowColumnMergeValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'absent' || right.kind === 'absent') return true;
  return left.sheetId === right.sheetId && left.axis === right.axis && left.index === right.index;
}

function cellMergeValuesEqual(left: CellMergeValue, right: CellMergeValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'clear' || right.kind === 'clear') return true;
  if (left.kind === 'formula' && right.kind === 'formula') return left.formula === right.formula;
  if (left.kind === 'scalar' && right.kind === 'scalar') return left.value === right.value;
  return false;
}

function directFormatMergeValuesEqual(
  left: DirectFormatMergeValue,
  right: DirectFormatMergeValue,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'clear' || right.kind === 'clear') return true;
  return jsonValuesEqual(left.format, right.format);
}

function sheetMetadataMergeValuesEqual(
  left: SheetMetadataMergeValue,
  right: SheetMetadataMergeValue,
): boolean {
  if (left.property !== right.property) return false;
  if (left.property === 'frozen' && right.property === 'frozen') {
    return left.rows === right.rows && left.cols === right.cols;
  }
  if (left.property === 'name' && right.property === 'name') return left.value === right.value;
  if (left.property === 'tabColor' && right.property === 'tabColor') {
    return left.value === right.value;
  }
  return false;
}

function parseFrozenPaneMergeValue(value: VersionSemanticValue): SheetMetadataMergeValue | null {
  const fields = semanticObjectFieldMap(value);
  if (!fields) return null;
  const rows = fields.get('rows');
  const cols = fields.get('cols');
  if (
    typeof rows !== 'number' ||
    typeof cols !== 'number' ||
    !Number.isSafeInteger(rows) ||
    !Number.isSafeInteger(cols) ||
    rows < 0 ||
    cols < 0
  ) {
    return null;
  }
  return { property: 'frozen', rows, cols };
}

function semanticFormatJsonValue(value: VersionSemanticValue, depth = 0): unknown {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;
  if (value.kind === 'array') {
    if (!Array.isArray(value.values)) return undefined;
    const values = value.values.map((entry) => semanticFormatJsonValue(entry, depth + 1));
    return values.some((entry) => entry === undefined) ? undefined : values;
  }
  if (value.kind === 'object') {
    if (!Array.isArray(value.fields)) return undefined;
    const record: Record<string, unknown> = {};
    for (const field of value.fields) {
      if (!isRecord(field) || typeof field.key !== 'string') return undefined;
      const mapped = semanticFormatJsonValue(field.value as VersionSemanticValue, depth + 1);
      if (mapped === undefined) return undefined;
      record[field.key] = mapped;
    }
    return record;
  }
  return undefined;
}

function isMaterializableCellFormat(value: unknown): value is CellFormat {
  return isRecord(value) && Object.keys(value).length > 0 && value.kind !== 'Removed';
}

function semanticObjectFieldMap(
  value: VersionSemanticValue,
): Map<string, VersionSemanticValue> | null {
  if (!isRecord(value) || value.kind !== 'object' || !Array.isArray(value.fields)) return null;
  const fields = new Map<string, VersionSemanticValue>();
  for (const field of value.fields) {
    if (!isRecord(field) || typeof field.key !== 'string') return null;
    fields.set(field.key, field.value as VersionSemanticValue);
  }
  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => jsonValuesEqual(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]),
  );
}

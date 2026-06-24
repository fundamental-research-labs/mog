import type {
  CellFormat,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import { parseCellAddress } from '../../../internal/utils';
import type {
  MaterializableMergeStructural,
  MergeChangeValueInput,
  RowColumnMergeValue,
  RowColumnTarget,
} from './version-merge-materializer-support-types';

export function parseMaterializableStructural(
  structural: VersionDiffStructuralMetadata,
): MaterializableMergeStructural | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain === 'cells.formats.direct') {
    return structural.propertyPath.length === 1 && structural.propertyPath[0] === 'format'
      ? structural
      : null;
  }
  if (structural.domain === 'rows-columns') {
    return structural.propertyPath.length === 1 && structural.propertyPath[0] === 'order'
      ? structural
      : null;
  }
  if (structural.domain === 'sheet' || structural.domain === 'sheets') {
    return structural.propertyPath.length === 1 &&
      (structural.propertyPath[0] === 'name' ||
        structural.propertyPath[0] === 'tabColor' ||
        structural.propertyPath[0] === 'frozen')
      ? structural
      : null;
  }
  if (
    structural.domain !== 'cell' &&
    structural.domain !== 'cells.values' &&
    structural.domain !== 'cells.formulas'
  ) {
    return null;
  }
  if (structural.domain === 'cells.formulas') {
    return structural.propertyPath.length === 0 ||
      (structural.propertyPath.length === 1 &&
        (structural.propertyPath[0] === 'formula' || structural.propertyPath[0] === 'value'))
      ? structural
      : null;
  }
  if (
    structural.propertyPath.length !== 0 &&
    !(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')
  ) {
    return null;
  }
  return structural;
}

export function parseCellEntity(entityId: string): boolean {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return false;
  return Boolean(parseCellAddress(entityId.slice(separator + 1)));
}

export function parseRowColumnEntity(entityId: string): RowColumnTarget | null {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return null;
  const sheetId = entityId.slice(0, separator);
  const axisAndIndex = entityId.slice(separator + 1);
  const axisSeparator = axisAndIndex.lastIndexOf(':');
  if (axisSeparator <= 0 || axisSeparator === axisAndIndex.length - 1) return null;
  const rawAxis = axisAndIndex.slice(0, axisSeparator);
  const axis = rawAxis === 'row' || rawAxis === 'column' ? rawAxis : null;
  if (!axis) return null;
  const index = Number(axisAndIndex.slice(axisSeparator + 1));
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return { sheetId, axis, index };
}

export function parseSheetEntity(entityId: string): boolean {
  return entityId.length > 0 && !entityId.includes('!');
}

export function parseCellMergeValue(value: VersionDiffValue, domain: string): boolean {
  if (value.kind !== 'value') return false;
  if (domain === 'cells.formulas') return isMaterializableFormulaCellValue(value.value);
  return isMaterializableSemanticCellValue(value.value);
}

export function parseDirectFormatMergeValue(value: VersionDiffValue): boolean {
  if (value.kind !== 'value') return false;
  if (value.value === null) return true;
  return isMaterializableCellFormat(semanticFormatJsonValue(value.value));
}

export function isSupportedRowColumnTransition(
  change: MergeChangeValueInput,
  target: RowColumnTarget,
): boolean {
  const current = parseRowColumnMergeValue(change.ours ?? change.base, target);
  const merged = parseRowColumnMergeValue(change.merged, target);
  if (!current || !merged) return false;
  if (rowColumnValuesEqual(current, merged)) return true;
  return (
    (current.kind === 'absent' && merged.kind === 'present') ||
    (current.kind === 'present' && merged.kind === 'absent')
  );
}

export function parseRowColumnMergeValue(
  value: VersionDiffValue,
  target: RowColumnTarget,
): RowColumnMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'absent' };
  const fields = semanticObjectFieldMap(value.value);
  if (!fields) return null;
  const axis = fields.get('axis');
  const sheetId = fields.get('sheetId');
  const index = fields.get('index');
  if (axis !== target.axis || sheetId !== target.sheetId || index !== target.index) return null;
  return { kind: 'present', sheetId: target.sheetId, axis: target.axis, index: target.index };
}

export function parseSheetMetadataMergeValue(
  value: VersionDiffValue,
  property: 'name' | 'tabColor' | 'frozen',
): boolean {
  if (value.kind !== 'value') return false;
  if (property === 'name') return typeof value.value === 'string' && value.value.length > 0;
  if (property === 'frozen') return isMaterializableFrozenPaneValue(value.value);
  return value.value === null || typeof value.value === 'string';
}

function isMaterializableFrozenPaneValue(value: VersionSemanticValue): boolean {
  const fields = semanticObjectFieldMap(value);
  if (!fields) return false;
  const rows = fields.get('rows');
  const cols = fields.get('cols');
  return (
    typeof rows === 'number' &&
    typeof cols === 'number' &&
    Number.isSafeInteger(rows) &&
    Number.isSafeInteger(cols) &&
    rows >= 0 &&
    cols >= 0
  );
}

function isMaterializableSemanticCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value !== 'object') return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function isMaterializableFormulaCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function rowColumnValuesEqual(left: RowColumnMergeValue, right: RowColumnMergeValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'absent' || right.kind === 'absent') return true;
  return left.sheetId === right.sheetId && left.axis === right.axis && left.index === right.index;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

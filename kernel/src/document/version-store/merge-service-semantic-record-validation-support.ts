import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import { parseCellAddress } from '@mog/spreadsheet-utils/a1';

import type { SemanticValueChangeSupport } from './merge-service-semantic-record-types';
import { isRecord } from './merge-service-semantic-record-validation-guards';

type RowColumnAxis = 'row' | 'column';

type RowColumnTarget = {
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
};

type RowColumnMergeValue =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'present';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    };

const SUPPORTED_SEMANTIC_MERGE_DOMAINS = new Set([
  'cell',
  'cells.values',
  'cells.formulas',
  'cells.formats.direct',
  'rows-columns',
]);

export function stableMergePairStructural(
  left: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  right: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> {
  if (isCellContentMergeDomain(left.domain) && isCellContentMergeDomain(right.domain)) {
    const formulasOnly = left.domain === 'cells.formulas' && right.domain === 'cells.formulas';
    return {
      kind: 'metadata',
      changeId: left.changeId,
      domain: formulasOnly ? 'cells.formulas' : 'cells.values',
      entityId: left.entityId,
      propertyPath: formulasOnly ? ['formula'] : ['value'],
    };
  }
  if (left.domain === 'rows-columns' && right.domain === 'rows-columns') {
    return { ...left, domain: 'rows-columns', propertyPath: ['order'] };
  }
  if (left.domain === 'cells.formats.direct' && right.domain === 'cells.formats.direct') {
    return { ...left, domain: 'cells.formats.direct', propertyPath: ['format'] };
  }
  return left;
}

export function inspectSupportedSemanticValueChange(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  before: VersionDiffValue,
  after: VersionDiffValue,
): SemanticValueChangeSupport {
  if (!SUPPORTED_SEMANTIC_MERGE_DOMAINS.has(structural.domain)) {
    return { ok: false, reason: 'unsupportedDomain' };
  }

  if (isCellContentMergeDomain(structural.domain)) {
    if (!hasMaterializableCellEntity(structural.entityId)) {
      return { ok: false, reason: 'unsupportedEntityId' };
    }
    if (!isSupportedCellPropertyPath(structural.domain, structural.propertyPath)) {
      return { ok: false, reason: 'unsupportedPropertyPath' };
    }
    const supported =
      structural.domain === 'cells.formulas'
        ? isMaterializableFormulaCellDiffValue(before) &&
          isMaterializableFormulaCellDiffValue(after)
        : isMaterializableSemanticCellDiffValue(before) &&
          isMaterializableSemanticCellDiffValue(after);
    return supported
      ? { ok: true }
      : {
          ok: false,
          reason:
            structural.domain === 'cells.formulas'
              ? 'unsupportedFormulaValue'
              : 'unsupportedCellValue',
        };
  }

  if (structural.domain === 'rows-columns') {
    const target = parseRowColumnEntity(structural.entityId);
    if (!target) return { ok: false, reason: 'unsupportedEntityId' };
    if (!(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'order')) {
      return { ok: false, reason: 'unsupportedPropertyPath' };
    }
    return isSupportedRowColumnTransition({ before, after }, target)
      ? { ok: true }
      : { ok: false, reason: 'unsupportedRowsColumnsTransition' };
  }

  if (!hasMaterializableCellEntity(structural.entityId)) {
    return { ok: false, reason: 'unsupportedEntityId' };
  }
  if (!(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'format')) {
    return { ok: false, reason: 'unsupportedPropertyPath' };
  }
  return { ok: true };
}

export function semanticMergePropertyKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  if (isCellContentMergeDomain(structural.domain)) {
    return JSON.stringify(['cells.values', structural.entityId, ['value']]);
  }
  if (structural.domain === 'rows-columns') {
    return JSON.stringify(['rows-columns', structural.entityId, ['order']]);
  }
  if (structural.domain === 'cells.formats.direct') {
    return JSON.stringify(['cells.formats.direct', structural.entityId, ['format']]);
  }
  return JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]);
}

export function isCellContentMergeDomain(domain: string): boolean {
  return domain === 'cell' || domain === 'cells.values' || domain === 'cells.formulas';
}

export function allowsEmptySemanticPropertyPath(domain: string): boolean {
  return domain === 'cells.values' || domain === 'cells.formulas';
}

function isSupportedCellPropertyPath(domain: string, propertyPath: readonly string[]): boolean {
  if (domain === 'cell') return propertyPath.length === 1 && propertyPath[0] === 'value';
  if (domain === 'cells.values') {
    return propertyPath.length === 0 || (propertyPath.length === 1 && propertyPath[0] === 'value');
  }
  return (
    propertyPath.length === 0 ||
    (propertyPath.length === 1 && (propertyPath[0] === 'formula' || propertyPath[0] === 'value'))
  );
}

function hasMaterializableCellEntity(entityId: string): boolean {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return false;
  return Boolean(parseCellAddress(entityId.slice(separator + 1)));
}

function parseRowColumnEntity(entityId: string): RowColumnTarget | null {
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

function isMaterializableSemanticCellDiffValue(value: VersionDiffValue): boolean {
  return value.kind === 'value' && isMaterializableSemanticCellValue(value.value);
}

function isMaterializableFormulaCellDiffValue(value: VersionDiffValue): boolean {
  return value.kind === 'value' && isMaterializableFormulaCellValue(value.value);
}

function isMaterializableSemanticCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (!isRecord(value)) return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function isMaterializableFormulaCellValue(value: VersionSemanticValue): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === 'blank') return true;
  return value.kind === 'formula' && typeof value.formula === 'string' && value.formula.length > 0;
}

function isSupportedRowColumnTransition(
  change: { readonly before: VersionDiffValue; readonly after: VersionDiffValue },
  target: RowColumnTarget,
): boolean {
  const before = parseRowColumnMergeValue(change.before, target);
  const after = parseRowColumnMergeValue(change.after, target);
  if (!before || !after) return false;
  if (rowColumnValuesEqual(before, after)) return true;
  return (
    (before.kind === 'absent' && after.kind === 'present') ||
    (before.kind === 'present' && after.kind === 'absent')
  );
}

function parseRowColumnMergeValue(
  value: VersionDiffValue,
  target: RowColumnTarget,
): RowColumnMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'absent' };
  const fields = semanticObjectFieldMap(value.value);
  if (!fields) return null;
  if (
    fields.get('axis') !== target.axis ||
    fields.get('sheetId') !== target.sheetId ||
    fields.get('index') !== target.index
  ) {
    return null;
  }
  return { kind: 'present', sheetId: target.sheetId, axis: target.axis, index: target.index };
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

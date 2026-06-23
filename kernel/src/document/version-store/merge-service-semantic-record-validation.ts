import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import { parseCellAddress } from '@mog/spreadsheet-utils/a1';

import type { SemanticValueChangeSupport } from './merge-service-semantic-record-types';

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

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

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

export function mapStructuralMetadata(
  value: Readonly<Record<string, unknown>>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> | null {
  const source = isRecord(value.structural) ? value.structural : value;
  if (hasRedactedValue(source)) return null;

  if (
    typeof source.changeId !== 'string' ||
    typeof source.domain !== 'string' ||
    source.domain.trim().length === 0 ||
    typeof source.entityId !== 'string' ||
    source.entityId.trim().length === 0 ||
    !Array.isArray(source.propertyPath) ||
    !source.propertyPath.every(
      (segment) => typeof segment === 'string' && segment.trim().length > 0,
    )
  ) {
    return null;
  }

  return {
    kind: 'metadata',
    changeId: source.changeId,
    domain: source.domain,
    entityId: source.entityId,
    propertyPath: [...source.propertyPath],
  };
}

export function mapDiffValue(value: unknown): VersionDiffValue | null {
  if (hasRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

export function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value) || hasRedactedDisplay(value)) return null;

  const display: {
    sheetName?: VersionDiffDisplayValue;
    address?: VersionDiffDisplayValue;
    entityLabel?: VersionDiffDisplayValue;
  } = {};

  for (const key of ['sheetName', 'address', 'entityLabel'] as const) {
    if (value[key] === undefined) continue;
    const displayValue = mapDiffDisplayValue(value[key]);
    if (!displayValue) return null;
    display[key] = displayValue;
  }
  return display;
}

export function hasRedactedDisplay(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['sheetName', 'address', 'entityLabel'].some((key) => hasRedactedValue(value[key]));
}

export function hasRedactedValue(value: unknown): value is VersionRedactedValue {
  return (
    isRecord(value) &&
    value.kind === 'redacted' &&
    typeof value.reason === 'string' &&
    REDACTED_VALUE_REASONS.has(value.reason)
  );
}

export function hasOpaqueSemanticValue(value: unknown, depth = 0): boolean {
  if (depth > 16 || !isRecord(value)) return false;
  if (value.kind === 'opaque') return true;
  if (isRecord(value.digest) && value.digest.algorithm === 'opaque') return true;
  if (value.kind === 'value') return hasOpaqueSemanticValue(value.value, depth + 1);
  if (Array.isArray(value.values)) {
    return value.values.some((item) => hasOpaqueSemanticValue(item, depth + 1));
  }
  if (Array.isArray(value.fields)) {
    return value.fields.some(
      (field) => isRecord(field) && hasOpaqueSemanticValue(field.value, depth + 1),
    );
  }
  return false;
}

export function isOpaqueSemanticDiffRecord(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & { readonly domainId: string } {
  return (
    typeof value.changeId === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.domainId === 'string' &&
    typeof value.objectId === 'string' &&
    (typeof value.objectKind === 'string' ||
      value.beforeDigest !== undefined ||
      value.afterDigest !== undefined)
  );
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
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

function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  if (hasRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function mapSemanticValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'dateTime':
      return typeof value.iso === 'string' ? { kind: 'dateTime', iso: value.iso } : undefined;
    case 'duration':
      return typeof value.iso === 'string' ? { kind: 'duration', iso: value.iso } : undefined;
    case 'error':
      if (typeof value.code !== 'string') return undefined;
      return {
        kind: 'error',
        code: value.code,
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    case 'formula': {
      if (typeof value.formula !== 'string') return undefined;
      if (!('result' in value)) return { kind: 'formula', formula: value.formula };
      const result = mapSemanticValue(value.result, depth + 1);
      return result === undefined ? undefined : { kind: 'formula', formula: value.formula, result };
    }
    case 'array': {
      if (!Array.isArray(value.values)) return undefined;
      const values = mapSemanticValues(value.values, depth + 1);
      return values ? { kind: 'array', values } : undefined;
    }
    case 'richText': {
      if (!Array.isArray(value.runs)) return undefined;
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      if (runs.some((run) => run === null)) return undefined;
      return {
        kind: 'richText',
        runs: runs as { readonly text: string; readonly styleRef?: string }[],
      };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      if (fields.some((field) => field === null)) return undefined;
      return {
        kind: 'object',
        fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[],
      };
    }
    default:
      return undefined;
  }
}

function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped = values.map((value) => mapSemanticValue(value, depth));
  return mapped.some((value) => value === undefined)
    ? undefined
    : (mapped as readonly VersionSemanticValue[]);
}

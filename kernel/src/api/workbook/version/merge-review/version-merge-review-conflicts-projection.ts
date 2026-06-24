import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { projectReviewAccessDiffValue } from '../../../../document/version-store/review-access-projection';
import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { invalidPreviewArtifactDiagnostic } from './version-merge-review-artifacts';

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);
const NON_CANONICAL_VALUE_KEY = '__mogMergeReviewNonCanonicalValue';

export function projectReviewValue(
  operation: VersionMergePublicOperation,
  structural: VersionDiffStructuralMetadata,
  value: unknown,
):
  | { readonly ok: true; readonly value: VersionDiffValue }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const reviewValue = projectReviewAccessDiffValue(projectableReviewStructural(structural), value);
  const mapped = reviewValue === undefined ? mapDiffValue(value) : reviewValue;
  if (!mapped) {
    return {
      ok: false,
      diagnostics: [invalidPreviewArtifactDiagnostic(operation)],
    };
  }
  return { ok: true, value: mapped };
}

function projectableReviewStructural(
  structural: VersionDiffStructuralMetadata,
): VersionDiffStructuralMetadata {
  if (
    structural.kind === 'metadata' &&
    ((structural.domain === 'cells.values' &&
      hasCellValueAliasPath(structural.propertyPath, 'value')) ||
      (structural.domain === 'cells.formulas' &&
        hasCellValueAliasPath(structural.propertyPath, 'formula')))
  ) {
    return {
      kind: 'metadata',
      changeId: structural.changeId,
      domain: 'cell',
      entityId: structural.entityId,
      propertyPath: ['value'],
    };
  }
  return structural;
}

function hasCellValueAliasPath(
  propertyPath: readonly string[],
  propertyName: 'value' | 'formula',
): boolean {
  return (
    propertyPath.length === 0 || (propertyPath.length === 1 && propertyPath[0] === propertyName)
  );
}

export function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return { kind: 'redacted', reason: value.reason as VersionRedactedValue['reason'] };
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value, new WeakSet<object>()));
  return serialized ?? JSON.stringify(nonCanonicalValue(typeof value));
}

export function compareJsonValues(left: unknown, right: unknown): number {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  if (leftJson < rightJson) return -1;
  if (leftJson > rightJson) return 1;
  return 0;
}

export function compareSemanticFields(
  left: { readonly key: string; readonly value: VersionSemanticValue },
  right: { readonly key: string; readonly value: VersionSemanticValue },
): number {
  return left.key.localeCompare(right.key) || compareJsonValues(left.value, right.value);
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;
  const semanticValue = mapSemanticValue(value.value);
  return semanticValue === undefined ? null : { kind: 'value', value: semanticValue };
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
      return typeof value.code === 'string'
        ? {
            kind: 'error',
            code: value.code,
            ...(typeof value.message === 'string' ? { message: value.message } : {}),
          }
        : undefined;
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
      const runs: { readonly text: string; readonly styleRef?: string }[] = [];
      for (let index = 0; index < value.runs.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value.runs, index)) return undefined;
        const run = value.runs[index];
        if (!isRecord(run) || typeof run.text !== 'string') return undefined;
        runs.push({
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        });
      }
      return { kind: 'richText', runs };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields: { readonly key: string; readonly value: VersionSemanticValue }[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < value.fields.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value.fields, index)) return undefined;
        const field = value.fields[index];
        if (!isRecord(field) || typeof field.key !== 'string') return undefined;
        if (seen.has(field.key)) return undefined;
        seen.add(field.key);
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        if (mappedValue === undefined) return undefined;
        fields.push({ key: field.key, value: mappedValue });
      }
      return { kind: 'object', fields: fields.sort(compareSemanticFields) };
    }
    default:
      return undefined;
  }
}

function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped: VersionSemanticValue[] = [];
  for (let index = 0; index < values.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(values, index)) return undefined;
    const value = mapSemanticValue(values[index], depth);
    if (value === undefined) return undefined;
    mapped.push(value);
  }
  return mapped;
}

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) return canonicalizeArray(value, seen);
  if (isUnsupportedCanonicalPrimitive(value)) return nonCanonicalValue(typeof value);
  if (!isRecord(value)) return value;

  if (seen.has(value)) return nonCanonicalValue('cycle');
  seen.add(value);
  const result =
    value.kind === 'object' && Array.isArray(value.fields)
      ? {
          ...canonicalizePlainObject(value, seen),
          fields: canonicalizeArray(value.fields, seen).sort((left, right) =>
            canonicalJson(left).localeCompare(canonicalJson(right)),
          ),
        }
      : canonicalizePlainObject(value, seen);
  seen.delete(value);
  return result;
}

function canonicalizeArray(values: readonly unknown[], seen: WeakSet<object>): unknown[] {
  if (seen.has(values)) return [nonCanonicalValue('cycle')];
  seen.add(values);
  const mapped: unknown[] = [];
  for (let index = 0; index < values.length; index++) {
    mapped.push(
      Object.prototype.hasOwnProperty.call(values, index)
        ? canonicalize(values[index], seen)
        : nonCanonicalValue('array-hole'),
    );
  }
  seen.delete(values);
  return mapped;
}

function canonicalizePlainObject(
  value: Readonly<Record<string, unknown>>,
  seen: WeakSet<object>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'fields')
      .sort()
      .map((key) => [key, canonicalize(value[key], seen)]),
  );
}

function isUnsupportedCanonicalPrimitive(value: unknown): boolean {
  return (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  );
}

function nonCanonicalValue(reason: string): Readonly<Record<string, string>> {
  return { [NON_CANONICAL_VALUE_KEY]: reason };
}

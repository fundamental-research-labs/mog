import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictDetailResolutionOption,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { projectReviewAccessDiffValue } from '../../document/version-store/review-access-projection';
import type { VersionMergePublicOperation } from './version-merge-capability';
import {
  invalidPreviewArtifactDiagnostic,
  mergeReviewDiagnostic,
} from './version-merge-review-artifacts';
import {
  invalidInputDiagnostic,
  type NormalizedGetMergeConflictDetailInput,
  type NormalizedPutMergeResolutionPayloadInput,
} from './version-merge-review-normalization';

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

export function findExpectedConflict(
  operation: VersionMergePublicOperation,
  conflicts: readonly VersionMergeConflict[],
  conflictId: string,
  expectedConflictDigest: string,
):
  | { readonly ok: true; readonly conflict: VersionMergeConflict }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const conflict = conflicts.find((candidate) => candidate.conflictId === conflictId);
  if (!conflict || conflict.conflictDigest !== expectedConflictDigest) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_MERGE_RESOLUTION_MISMATCH',
          'requested conflict does not match the merge preview artifact.',
        ),
      ],
    };
  }
  return { ok: true, conflict };
}

export function selectConflictDetailValue(
  operation: VersionMergePublicOperation,
  conflict: VersionMergeConflict,
  input: Pick<NormalizedGetMergeConflictDetailInput, 'valueRole' | 'optionId' | 'kind'>,
):
  | { readonly ok: true; readonly value: VersionDiffValue }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  switch (input.valueRole) {
    case 'base':
      return { ok: true, value: conflict.base };
    case 'ours':
      return { ok: true, value: conflict.ours };
    case 'theirs':
      return { ok: true, value: conflict.theirs };
    case 'resolved': {
      if (!input.optionId || !input.kind) {
        return {
          ok: false,
          diagnostics: [
            invalidInputDiagnostic(
              operation,
              'optionId',
              'optionId and kind are required for resolved conflict detail values.',
            ),
          ],
        };
      }
      const option = findResolutionOption(conflict, input.optionId, input.kind);
      return option
        ? { ok: true, value: option.value }
        : {
            ok: false,
            diagnostics: [
              mergeReviewDiagnostic(
                operation,
                'VERSION_MERGE_RESOLUTION_MISMATCH',
                'resolution option does not match the conflict.',
              ),
            ],
          };
    }
  }
}

export function projectResolutionOptions(
  operation: VersionMergePublicOperation,
  conflict: VersionMergeConflict,
):
  | {
      readonly ok: true;
      readonly options: readonly VersionMergeConflictDetailResolutionOption[];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const options: VersionMergeConflictDetailResolutionOption[] = [];
  for (const option of conflict.resolutionOptions) {
    const value = projectReviewValue(operation, conflict.structural, option.value);
    if (!value.ok) return value;
    options.push({
      optionId: option.optionId,
      conflictId: option.conflictId,
      kind: option.kind,
      value: value.value,
      recalcRequired: option.recalcRequired,
    });
  }
  return { ok: true, options };
}

export function validateResolutionPayloadPurpose(
  conflict: VersionMergeConflict,
  option: VersionMergeConflictResolutionOption,
  input: NormalizedPutMergeResolutionPayloadInput,
): readonly VersionStoreDiagnostic[] {
  if (input.purpose === 'custom') {
    return input.domainPayloadSchema
      ? []
      : [
          invalidInputDiagnostic(
            'putMergeResolutionPayload',
            'domainPayloadSchema',
            'custom resolution payloads require a domainPayloadSchema.',
          ),
        ];
  }

  const projected = projectReviewValue('putMergeResolutionPayload', conflict.structural, option.value);
  if (!projected.ok) return projected.diagnostics;
  if (canonicalJson(projected.value) === canonicalJson(input.value)) return [];
  return [
    mergeReviewDiagnostic(
      'putMergeResolutionPayload',
      'VERSION_MERGE_RESOLUTION_MISMATCH',
      'chooseValue payload does not match the selected resolution option.',
    ),
  ];
}

export function projectReviewValue(
  operation: VersionMergePublicOperation,
  structural: VersionDiffStructuralMetadata,
  value: unknown,
):
  | { readonly ok: true; readonly value: VersionDiffValue }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const reviewValue = projectReviewAccessDiffValue(structural, value);
  const mapped = reviewValue === undefined ? mapDiffValue(value) : reviewValue;
  if (!mapped) {
    return {
      ok: false,
      diagnostics: [invalidPreviewArtifactDiagnostic(operation)],
    };
  }
  return { ok: true, value: mapped };
}

export function findResolutionOption(
  conflict: VersionMergeConflict,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflictResolutionOption | undefined {
  return conflict.resolutionOptions.find(
    (candidate) => candidate.optionId === optionId && candidate.kind === kind,
  );
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;
  const semanticValue = mapSemanticValue(value.value);
  return semanticValue === undefined ? null : { kind: 'value', value: semanticValue };
}

function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return { kind: 'redacted', reason: value.reason as VersionRedactedValue['reason'] };
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
        ? { kind: 'error', code: value.code, ...(typeof value.message === 'string' ? { message: value.message } : {}) }
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
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      return runs.some((run) => run === null)
        ? undefined
        : { kind: 'richText', runs: runs as { readonly text: string; readonly styleRef?: string }[] };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      return fields.some((field) => field === null)
        ? undefined
        : { kind: 'object', fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[] };
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

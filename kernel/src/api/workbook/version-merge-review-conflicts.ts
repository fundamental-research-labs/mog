import type {
  VersionApplyMergeResolution,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionRedactedValue,
  VersionSaveMergeResolutionsResult,
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
const REQUIRED_RESOLUTION_OPTION_KINDS = [
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
] as const satisfies readonly VersionMergeConflictResolutionOptionKind[];

type VersionMergeConflictDetailResolutionOption = {
  readonly optionId: string;
  readonly conflictId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly value: VersionDiffValue;
  readonly recalcRequired: boolean;
};

export type NormalizedMergeReviewConflictSet = {
  readonly conflicts: readonly VersionMergeConflict[];
  readonly conflictsByRequestKey: ReadonlyMap<string, VersionMergeConflict>;
  readonly optionsByRequestKey: ReadonlyMap<string, VersionMergeConflictResolutionOption>;
};

type ResolutionValidationResult =
  | {
      readonly ok: true;
      readonly status: VersionSaveMergeResolutionsResult['status'];
      readonly resolutions: readonly VersionApplyMergeResolution[];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function normalizeMergeReviewConflicts(
  operation: VersionMergePublicOperation,
  conflicts: readonly unknown[],
): Promise<
  | { readonly ok: true; readonly conflictSet: NormalizedMergeReviewConflictSet }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!Array.isArray(conflicts)) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }

  const normalized: VersionMergeConflict[] = [];
  const conflictsByRequestKey = new Map<string, VersionMergeConflict>();
  const optionsByRequestKey = new Map<string, VersionMergeConflictResolutionOption>();
  const conflictIds = new Set<string>();
  const conflictDigests = new Set<string>();
  for (const conflict of conflicts) {
    const mapped = await normalizeMergeReviewConflict(operation, conflict);
    if (!mapped.ok) return mapped;
    if (
      conflictIds.has(mapped.conflict.conflictId) ||
      conflictDigests.has(mapped.conflict.conflictDigest)
    ) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    conflictIds.add(mapped.conflict.conflictId);
    conflictDigests.add(mapped.conflict.conflictDigest);
    normalized.push(mapped.conflict);
    conflictsByRequestKey.set(
      conflictRequestKey(mapped.conflict.conflictId, mapped.conflict.conflictDigest),
      mapped.conflict,
    );
    conflictsByRequestKey.set(
      conflictRequestKey(mapped.originalConflictId, mapped.originalConflictDigest),
      mapped.conflict,
    );
    for (const option of mapped.conflict.resolutionOptions) {
      optionsByRequestKey.set(
        optionRequestKey(mapped.conflict.conflictId, option.optionId, option.kind),
        option,
      );
      const originalOptionId = mapped.originalOptionIds.get(option.kind);
      if (originalOptionId) {
        optionsByRequestKey.set(
          optionRequestKey(mapped.originalConflictId, originalOptionId, option.kind),
          option,
        );
        optionsByRequestKey.set(
          optionRequestKey(mapped.conflict.conflictId, originalOptionId, option.kind),
          option,
        );
      }
    }
  }

  return {
    ok: true,
    conflictSet: { conflicts: normalized, conflictsByRequestKey, optionsByRequestKey },
  };
}

export function findExpectedConflict(
  operation: VersionMergePublicOperation,
  conflictSet: NormalizedMergeReviewConflictSet,
  conflictId: string,
  expectedConflictDigest: string,
):
  | { readonly ok: true; readonly conflict: VersionMergeConflict }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const conflict = conflictSet.conflictsByRequestKey.get(
    conflictRequestKey(conflictId, expectedConflictDigest),
  );
  if (!conflict) {
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

export function findResolutionOptionForConflictSet(
  conflictSet: NormalizedMergeReviewConflictSet,
  conflict: VersionMergeConflict,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflictResolutionOption | undefined {
  return (
    conflictSet.optionsByRequestKey.get(optionRequestKey(conflict.conflictId, optionId, kind)) ??
    findResolutionOption(conflict, optionId, kind)
  );
}

export function validateResolutionsForConflictSet(
  operation: VersionMergePublicOperation,
  payload: {
    readonly status: 'clean' | 'conflicted';
  },
  conflictSet: NormalizedMergeReviewConflictSet,
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionValidationResult {
  if (payload.status === 'clean') {
    return resolutions.length === 0
      ? { ok: true, status: 'readyToApply', resolutions: [] }
      : {
          ok: false,
          diagnostics: [
            mergeReviewDiagnostic(
              operation,
              'VERSION_MERGE_RESOLUTION_MISMATCH',
              'clean merge preview artifacts do not accept resolutions.',
            ),
          ],
        };
  }

  const seen = new Set<string>();
  const canonicalResolutions: VersionApplyMergeResolution[] = [];
  for (const resolution of resolutions) {
    const conflict = findExpectedConflict(
      operation,
      conflictSet,
      resolution.conflictId,
      resolution.expectedConflictDigest,
    );
    if (!conflict.ok) {
      return conflict;
    }
    if (seen.has(conflict.conflict.conflictId)) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'duplicate conflict resolution supplied.',
          ),
        ],
      };
    }
    seen.add(conflict.conflict.conflictId);
    const option = findResolutionOptionForConflictSet(
      conflictSet,
      conflict.conflict,
      resolution.optionId,
      resolution.kind,
    );
    if (!option) {
      return {
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
    canonicalResolutions.push({
      ...resolution,
      conflictId: conflict.conflict.conflictId,
      expectedConflictDigest: conflict.conflict.conflictDigest,
      optionId: option.optionId,
      kind: option.kind,
    });
  }

  if (canonicalResolutions.length === 0) {
    return { ok: true, status: 'reviewOnly', resolutions: [] };
  }
  return {
    ok: true,
    status:
      canonicalResolutions.length === conflictSet.conflicts.length
        ? 'readyToApply'
        : 'partiallyResolved',
    resolutions: canonicalResolutions,
  };
}

export function selectConflictDetailValue(
  operation: VersionMergePublicOperation,
  conflictSet: NormalizedMergeReviewConflictSet,
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
      const option = findResolutionOptionForConflictSet(
        conflictSet,
        conflict,
        input.optionId,
        input.kind,
      );
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

  const projected = projectReviewValue(
    'putMergeResolutionPayload',
    conflict.structural,
    option.value,
  );
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

function conflictRequestKey(conflictId: string, conflictDigest: string): string {
  return `${conflictId}\u0000${conflictDigest}`;
}

function optionRequestKey(
  conflictId: string,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): string {
  return `${conflictId}\u0000${optionId}\u0000${kind}`;
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
      const fields: { readonly key: string; readonly value: VersionSemanticValue }[] = [];
      const seen = new Set<string>();
      for (const field of value.fields) {
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
  if (value.kind === 'object' && Array.isArray(value.fields)) {
    return {
      ...canonicalizePlainObject(value),
      fields: value.fields
        .map((field) => canonicalize(field))
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    };
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalizePlainObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'fields')
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

async function normalizeMergeReviewConflict(
  operation: VersionMergePublicOperation,
  value: unknown,
): Promise<
  | {
      readonly ok: true;
      readonly conflict: VersionMergeConflict;
      readonly originalConflictId: string;
      readonly originalConflictDigest: string;
      readonly originalOptionIds: ReadonlyMap<VersionMergeConflictResolutionOptionKind, string>;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!isRecord(value) || value.conflictKind !== 'same-property') {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }
  if (typeof value.conflictId !== 'string' || typeof value.conflictDigest !== 'string') {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }
  const structural = mapStructuralMetadataForReview(operation, value.structural);
  if (!structural.ok) return structural;

  const base = projectReviewValue(operation, structural.structural, value.base);
  if (!base.ok) return base;
  const ours = projectReviewValue(operation, structural.structural, value.ours);
  if (!ours.ok) return ours;
  const theirs = projectReviewValue(operation, structural.structural, value.theirs);
  if (!theirs.ok) return theirs;

  const identity = await stableReviewConflictIdentity(
    structural.structural,
    base.value,
    ours.value,
    theirs.value,
  );
  const options = await normalizeMergeReviewResolutionOptions(
    operation,
    value.resolutionOptions,
    structural.structural,
    identity,
    { acceptBase: base.value, acceptOurs: ours.value, acceptTheirs: theirs.value },
  );
  if (!options.ok) return options;

  return {
    ok: true,
    originalConflictId: value.conflictId,
    originalConflictDigest: value.conflictDigest,
    originalOptionIds: options.originalOptionIds,
    conflict: {
      conflictId: identity.conflictId,
      conflictDigest: identity.conflictDigest,
      conflictKind: 'same-property',
      structural: structural.structural,
      base: base.value,
      ours: ours.value,
      theirs: theirs.value,
      resolutionOptions: options.options,
    },
  };
}

function mapStructuralMetadataForReview(
  operation: VersionMergePublicOperation,
  value: unknown,
):
  | {
      readonly ok: true;
      readonly structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (mapRedactedValue(value)) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_REDACTION_VIOLATION',
          'Persisted merge preview conflict identity is redacted.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }
  if (
    !isRecord(value) ||
    value.kind !== 'metadata' ||
    typeof value.changeId !== 'string' ||
    typeof value.domain !== 'string' ||
    typeof value.entityId !== 'string' ||
    !Array.isArray(value.propertyPath) ||
    !value.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }
  return {
    ok: true,
    structural: {
      kind: 'metadata',
      changeId: value.changeId,
      domain: value.domain,
      entityId: value.entityId,
      propertyPath: [...value.propertyPath],
    },
  };
}

async function normalizeMergeReviewResolutionOptions(
  operation: VersionMergePublicOperation,
  value: unknown,
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  identity: { readonly conflictId: string; readonly conflictDigest: string },
  expectedValues: Record<VersionMergeConflictResolutionOptionKind, VersionDiffValue>,
): Promise<
  | {
      readonly ok: true;
      readonly options: readonly VersionMergeConflictResolutionOption[];
      readonly originalOptionIds: ReadonlyMap<VersionMergeConflictResolutionOptionKind, string>;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!Array.isArray(value)) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }

  const byKind = new Map<VersionMergeConflictResolutionOptionKind, VersionDiffValue>();
  const recalcRequired = new Map<VersionMergeConflictResolutionOptionKind, boolean>();
  const originalOptionIds = new Map<VersionMergeConflictResolutionOptionKind, string>();
  for (const option of value) {
    if (!isRecord(option)) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const kind = mapResolutionOptionKind(option.kind);
    if (!kind || byKind.has(kind) || typeof option.recalcRequired !== 'boolean') {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    if (typeof option.conflictId !== 'string' || typeof option.optionId !== 'string') {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const projected = projectReviewValue(operation, structural, option.value);
    if (!projected.ok) return projected;
    if (canonicalJson(projected.value) !== canonicalJson(expectedValues[kind])) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    byKind.set(kind, projected.value);
    recalcRequired.set(kind, option.recalcRequired);
    originalOptionIds.set(kind, option.optionId);
  }

  if (REQUIRED_RESOLUTION_OPTION_KINDS.some((kind) => !byKind.has(kind))) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }

  return {
    ok: true,
    originalOptionIds,
    options: await Promise.all(
      REQUIRED_RESOLUTION_OPTION_KINDS.map(async (kind) => ({
        optionId: await stableReviewResolutionOptionId(identity, kind),
        conflictId: identity.conflictId,
        kind,
        value: byKind.get(kind) ?? expectedValues[kind],
        recalcRequired: recalcRequired.get(kind) ?? true,
      })),
    ),
  };
}

async function stableReviewConflictIdentity(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): Promise<{ readonly conflictId: string; readonly conflictDigest: string }> {
  const sideValues = [identityDiffValue(ours), identityDiffValue(theirs)].sort(compareJsonValues);
  const canonical = JSON.stringify({
    schemaVersion: 1,
    conflictKind: 'same-property',
    key: mergeReviewPropertyKey(structural),
    base: identityDiffValue(base),
    sideValues,
  });
  const conflictIdDigest = await sha256Hex(`mog.version.merge.conflict-id.v1\n${canonical}`);
  const conflictDigest = await sha256Hex(`mog.version.merge.conflict-digest.v1\n${canonical}`);
  return {
    conflictId: `conflict:sha256:${conflictIdDigest}`,
    conflictDigest: `sha256:${conflictDigest}`,
  };
}

async function stableReviewResolutionOptionId(
  identity: { readonly conflictId: string; readonly conflictDigest: string },
  kind: VersionMergeConflictResolutionOptionKind,
): Promise<string> {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    conflictId: identity.conflictId,
    conflictDigest: identity.conflictDigest,
    kind,
  });
  const digest = await sha256Hex(`mog.version.merge.resolution-option-id.v1\n${canonical}`);
  return `option:sha256:${digest}`;
}

function mergeReviewPropertyKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  const normalized = normalizeReviewStructuralMetadata(structural);
  return JSON.stringify([normalized.domain, normalized.entityId, normalized.propertyPath]);
}

function normalizeReviewStructuralMetadata(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> {
  if (
    structural.domain === 'cell' ||
    (structural.domain === 'cells.values' &&
      (structural.propertyPath.length === 0 ||
        (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value'))) ||
    (structural.domain === 'cells.formulas' &&
      (structural.propertyPath.length === 0 ||
        (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'formula')))
  ) {
    return {
      kind: 'metadata',
      changeId: structural.changeId,
      domain: 'cells.values',
      entityId: structural.entityId,
      propertyPath: ['value'],
    };
  }

  return {
    kind: 'metadata',
    changeId: structural.changeId,
    domain: structural.domain,
    entityId: structural.entityId,
    propertyPath: [...structural.propertyPath],
  };
}

function identityDiffValue(value: VersionDiffValue): VersionDiffValue {
  return value.kind === 'value'
    ? { kind: 'value', value: identitySemanticValue(value.value) }
    : value;
}

function identitySemanticValue(value: VersionSemanticValue): VersionSemanticValue {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'formula':
      return { kind: 'formula', formula: value.formula };
    case 'array':
      return { kind: 'array', values: value.values.map(identitySemanticValue) };
    case 'object':
      return {
        kind: 'object',
        fields: value.fields
          .map((field) => ({ key: field.key, value: identitySemanticValue(field.value) }))
          .sort(compareSemanticFields),
      };
    default:
      return value;
  }
}

function mapResolutionOptionKind(
  value: unknown,
): VersionMergeConflictResolutionOptionKind | null {
  return REQUIRED_RESOLUTION_OPTION_KINDS.includes(
    value as VersionMergeConflictResolutionOptionKind,
  )
    ? (value as VersionMergeConflictResolutionOptionKind)
    : null;
}

function compareSemanticFields(
  left: { readonly key: string; readonly value: VersionSemanticValue },
  right: { readonly key: string; readonly value: VersionSemanticValue },
): number {
  return left.key.localeCompare(right.key) || compareJsonValues(left.value, right.value);
}

function compareJsonValues(left: unknown, right: unknown): number {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  if (leftJson < rightJson) return -1;
  if (leftJson > rightJson) return 1;
  return 0;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('WorkbookVersion merge review requires SHA-256 support');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

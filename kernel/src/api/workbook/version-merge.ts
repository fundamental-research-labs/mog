import type {
  VersionDiagnosticPublicPayload,
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionRedactedValue,
  VersionRefName,
  VersionSemanticValue,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  mapPublicExpectedTargetHead,
  mapPublicTargetRef,
  mapVersionMergeAttemptMetadata,
} from './version-attempt-metadata';
import {
  getVersionMergeCapabilityDecision,
  versionMergeCapabilityDisabledDiagnostic,
} from './version-merge-capability';
import { validateVersionDomainSupportManifestGate } from './version-domain-support-gate';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_MERGE_INPUT_KEYS = new Set(['base', 'ours', 'theirs']);
const VERSION_MERGE_OPTION_KEYS = new Set([
  'mode',
  'includeDiagnostics',
  'targetRef',
  'expectedTargetHead',
  'persistReviewRecord',
]);
const VERSION_MERGE_RESOLUTION_OPTION_KINDS = new Set<VersionMergeConflictResolutionOptionKind>([
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
]);
const REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS = [
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
] as const satisfies readonly VersionMergeConflictResolutionOptionKind[];
const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionMergeService = {
  merge: (input: VersionMergeInput, options?: VersionMergeOptions) => MaybePromise<unknown>;
};

type AttachedVersionServices = {
  readonly mergeService?: unknown;
  readonly versionMergeService?: unknown;
  readonly publicService?: unknown;
  readonly readService?: unknown;
  readonly graphService?: unknown;
  readonly graphStore?: unknown;
  readonly graph?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type MergeValidationResult =
  | {
      readonly ok: true;
      readonly input: VersionMergeInput;
      readonly options: VersionMergeOptions;
    }
  | {
      readonly ok: false;
      readonly base: WorkbookCommitId | null;
      readonly ours: WorkbookCommitId | null;
      readonly theirs: WorkbookCommitId | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export async function mergeWorkbookVersion(
  ctx: DocumentContext,
  input: VersionMergeInput,
  options: VersionMergeOptions = {},
): Promise<VersionMergeResult> {
  const capability = getVersionMergeCapabilityDecision(ctx, 'version:mergePreview');
  if (!capability.enabled) {
    return blockedMergeResult(null, null, null, [
      versionMergeCapabilityDisabledDiagnostic('merge', capability),
    ]);
  }

  const validated = validateMergeRequest(input, options);
  if (!validated.ok) {
    return blockedMergeResult(validated.base, validated.ours, validated.theirs, validated.diagnostics);
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'merge');
  if (gateDiagnostics.length > 0) {
    return blockedMergeResult(
      validated.input.base,
      validated.input.ours,
      validated.input.theirs,
      gateDiagnostics,
    );
  }

  const services = getAttachedVersionServices(ctx);
  if (!services) {
    return blockedMergeResult(validated.input.base, validated.input.ours, validated.input.theirs, [
      serviceUnavailableDiagnostic(),
    ]);
  }

  const mergeService = getAttachedVersionMergeService(services);
  if (!mergeService) {
    return blockedMergeResult(validated.input.base, validated.input.ours, validated.input.theirs, [
      mergeUnavailableDiagnostic(),
    ]);
  }

  try {
    const result = await mergeService.merge(validated.input, validated.options);
    return mapMergeResult(result, validated.input);
  } catch {
    return blockedMergeResult(validated.input.base, validated.input.ours, validated.input.theirs, [
      providerErrorDiagnostic(),
    ]);
  }
}

export function hasAttachedVersionMergeService(ctx: DocumentContext): boolean {
  const services = getAttachedVersionServices(ctx);
  return Boolean(services && getAttachedVersionMergeService(services));
}

function validateMergeRequest(
  input: VersionMergeInput,
  options: VersionMergeOptions,
): MergeValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];

  const normalizedInput = normalizeMergeInput(input, diagnostics);
  const normalizedOptions = normalizeMergeOptions(options, diagnostics);

  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    return {
      ok: false,
      base: normalizedInput?.base ?? toCommitId(isRecord(input) ? input.base : undefined),
      ours: normalizedInput?.ours ?? toCommitId(isRecord(input) ? input.ours : undefined),
      theirs: normalizedInput?.theirs ?? toCommitId(isRecord(input) ? input.theirs : undefined),
      diagnostics,
    };
  }

  return { ok: true, input: normalizedInput, options: normalizedOptions };
}

function normalizeMergeInput(
  input: VersionMergeInput,
  diagnostics: VersionStoreDiagnostic[],
): VersionMergeInput | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidMergeOptionDiagnostic('input', 'merge input must be an object with commit ids.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_MERGE_INPUT_KEYS.has(key)) continue;
    diagnostics.push(invalidMergeOptionDiagnostic(`input.${key}`, `Unknown merge input "${key}".`));
  }

  const base = toCommitId(input.base);
  const ours = toCommitId(input.ours);
  const theirs = toCommitId(input.theirs);
  if (!base) {
    diagnostics.push(invalidMergeOptionDiagnostic('base', 'merge base must be a commit id.'));
  }
  if (!ours) {
    diagnostics.push(invalidMergeOptionDiagnostic('ours', 'merge ours must be a commit id.'));
  }
  if (!theirs) {
    diagnostics.push(invalidMergeOptionDiagnostic('theirs', 'merge theirs must be a commit id.'));
  }

  return base && ours && theirs ? { base, ours, theirs } : null;
}

function normalizeMergeOptions(
  input: VersionMergeOptions,
  diagnostics: VersionStoreDiagnostic[],
): VersionMergeOptions | null {
  if (input === undefined) return {};
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidMergeOptionDiagnostic('options', 'merge options must be an object when supplied.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_MERGE_OPTION_KEYS.has(key)) continue;
    diagnostics.push(invalidMergeOptionDiagnostic(key, `Unknown merge option "${key}".`));
  }

  const options: {
    mode?: 'preview';
    includeDiagnostics?: boolean;
    targetRef?: VersionMainRefName | VersionRefName;
    expectedTargetHead?: VersionCommitExpectedHead;
    persistReviewRecord?: boolean;
  } = {};
  if (input.mode !== undefined) {
    if (input.mode !== 'preview') {
      diagnostics.push(
        invalidMergeOptionDiagnostic('mode', 'merge mode must be "preview" when supplied.'),
      );
    } else {
      options.mode = input.mode;
    }
  }

  if (input.includeDiagnostics !== undefined) {
    if (typeof input.includeDiagnostics !== 'boolean') {
      diagnostics.push(
        invalidMergeOptionDiagnostic(
          'includeDiagnostics',
          'includeDiagnostics must be a boolean.',
        ),
      );
    } else {
      options.includeDiagnostics = input.includeDiagnostics;
    }
  }

  if (input.targetRef !== undefined) {
    const targetRef = mapPublicTargetRef(input.targetRef);
    if (!targetRef) {
      diagnostics.push(
        invalidMergeOptionDiagnostic(
          'targetRef',
          'targetRef must name a public-safe version branch.',
        ),
      );
    } else {
      options.targetRef = targetRef;
    }
  }

  if (input.expectedTargetHead !== undefined) {
    const expectedTargetHead = mapPublicExpectedTargetHead(input.expectedTargetHead);
    if (!expectedTargetHead) {
      diagnostics.push(
        invalidMergeOptionDiagnostic(
          'expectedTargetHead',
          'expectedTargetHead must be a valid expected head record.',
        ),
      );
    } else {
      options.expectedTargetHead = expectedTargetHead;
    }
  }

  if (input.persistReviewRecord !== undefined) {
    if (typeof input.persistReviewRecord !== 'boolean') {
      diagnostics.push(
        invalidMergeOptionDiagnostic('persistReviewRecord', 'persistReviewRecord must be a boolean.'),
      );
    } else {
      options.persistReviewRecord = input.persistReviewRecord;
    }
  }

  return options;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function getAttachedVersionMergeService(
  services: AttachedVersionServices,
): AttachedVersionMergeService | null {
  for (const candidate of [
    services.mergeService,
    services.versionMergeService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    const mergeService = toMergeService(candidate);
    if (mergeService) return mergeService;
  }

  return null;
}

function toMergeService(value: unknown): AttachedVersionMergeService | null {
  const merge =
    bindMethod(value, 'merge') ??
    bindMethod(value, 'mergeVersions') ??
    bindMethod(value, 'mergeCommits');
  if (!merge) return null;

  return {
    merge: (input, options) => merge(input, options),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function mapMergeResult(value: unknown, fallback: VersionMergeInput): VersionMergeResult {
  if (!isRecord(value)) {
    return blockedMergeResult(fallback.base, fallback.ours, fallback.theirs, [
      providerErrorDiagnostic(),
    ]);
  }

  if (value.status === 'failed' || value.status === 'degraded' || value.status === 'blocked') {
    return blockedMergeResult(
      toCommitId(value.base) ?? fallback.base,
      toCommitId(value.ours) ?? fallback.ours,
      toCommitId(value.theirs) ?? fallback.theirs,
      mapGraphDiagnostics(value.diagnostics),
    );
  }

  if (
    value.status !== 'clean' &&
    value.status !== 'conflicted' &&
    value.status !== 'fastForward' &&
    value.status !== 'alreadyMerged'
  ) {
    return blockedMergeResult(fallback.base, fallback.ours, fallback.theirs, [
      providerErrorDiagnostic(),
    ]);
  }

  const base = toCommitId(value.base);
  const ours = toCommitId(value.ours);
  const theirs = toCommitId(value.theirs);
  const changes = Array.isArray(value.changes) ? mapMergeChanges(value.changes) : null;
  const conflicts = Array.isArray(value.conflicts) ? mapMergeConflicts(value.conflicts) : null;
  const metadata = mapVersionMergeAttemptMetadata(value);
  const mutationGuarantee = value.mutationGuarantee === 'preview-only';
  const diagnostics =
    Array.isArray(value.diagnostics) && value.diagnostics.length > 0
      ? mapGraphDiagnostics(value.diagnostics)
      : [];

  if (
    !base ||
    !ours ||
    !theirs ||
    !changes ||
    !conflicts ||
    !metadata ||
    !mutationGuarantee ||
    diagnostics.length > 0
  ) {
    return blockedMergeResult(base ?? fallback.base, ours ?? fallback.ours, theirs ?? fallback.theirs, [
      ...diagnostics,
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version merge service did not return a valid public merge preview.',
        { recoverability: 'repair' },
      ),
    ]);
  }

  if (value.status === 'clean') {
    if (conflicts.length > 0) {
      return blockedMergeResult(base, ours, theirs, [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service returned clean status with conflicts.',
          { recoverability: 'repair' },
        ),
      ]);
    }
    return {
      ...metadata,
      status: 'clean',
      base,
      ours,
      theirs,
      changes,
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
  }

  if (value.status === 'fastForward' || value.status === 'alreadyMerged') {
    if (changes.length > 0 || conflicts.length > 0) {
      return blockedMergeResult(base, ours, theirs, [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service returned ancestry status with merge changes.',
          { recoverability: 'repair' },
        ),
      ]);
    }
    return {
      ...metadata,
      status: value.status,
      base,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
  }

  return {
    ...metadata,
    status: 'conflicted',
    base,
    ours,
    theirs,
    changes,
    conflicts,
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

function mapMergeChanges(values: readonly unknown[]): readonly VersionMergeChange[] | null {
  const changes = values.map(mapMergeChange);
  return changes.some((change) => change === null) ? null : (changes as VersionMergeChange[]);
}

function mapMergeChange(value: unknown): VersionMergeChange | null {
  if (!isRecord(value)) return null;

  const structural = mapStructuralMetadata(value.structural);
  const base = mapDiffValue(value.base);
  const merged = mapDiffValue(value.merged);
  const ours = value.ours === undefined ? undefined : mapDiffValue(value.ours);
  const theirs = value.theirs === undefined ? undefined : mapDiffValue(value.theirs);
  if (
    !structural ||
    !base ||
    !merged ||
    (value.ours !== undefined && !ours) ||
    (value.theirs !== undefined && !theirs)
  ) {
    return null;
  }

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    structural,
    base,
    ...(ours ? { ours } : {}),
    ...(theirs ? { theirs } : {}),
    merged,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function mapMergeConflicts(values: readonly unknown[]): readonly VersionMergeConflict[] | null {
  const conflicts = values.map(mapMergeConflict);
  return conflicts.some((conflict) => conflict === null)
    ? null
    : (conflicts as VersionMergeConflict[]);
}

function mapMergeConflict(value: unknown): VersionMergeConflict | null {
  if (!isRecord(value) || value.conflictKind !== 'same-property') return null;

  const conflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const conflictDigest = typeof value.conflictDigest === 'string' ? value.conflictDigest : null;
  const structural = mapStructuralMetadata(value.structural);
  const base = mapDiffValue(value.base);
  const ours = mapDiffValue(value.ours);
  const theirs = mapDiffValue(value.theirs);
  const resolutionOptions = Array.isArray(value.resolutionOptions)
    ? mapMergeResolutionOptions(value.resolutionOptions, conflictId)
    : null;
  if (
    conflictId === null ||
    conflictDigest === null ||
    !structural ||
    !base ||
    !ours ||
    !theirs ||
    !resolutionOptions
  ) {
    return null;
  }

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    conflictId,
    conflictDigest,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function mapMergeResolutionOptions(
  values: readonly unknown[],
  conflictId: string | null,
): readonly VersionMergeConflictResolutionOption[] | null {
  if (!conflictId) return null;
  const options = values.map((value) => mapMergeResolutionOption(value, conflictId));
  if (options.some((option) => option === null)) return null;
  const mapped = options as VersionMergeConflictResolutionOption[];
  const kinds = new Set(mapped.map((option) => option.kind));
  if (
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.some((kind) => !kinds.has(kind)) ||
    mapped.length !== kinds.size
  ) {
    return null;
  }
  return [...mapped].sort((left, right) => compareResolutionOptionKinds(left.kind, right.kind));
}

function mapMergeResolutionOption(
  value: unknown,
  conflictId: string,
): VersionMergeConflictResolutionOption | null {
  if (!isRecord(value)) return null;

  const optionId = typeof value.optionId === 'string' ? value.optionId : null;
  const optionConflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const kind = isMergeResolutionOptionKind(value.kind) ? value.kind : null;
  const optionValue = mapDiffValue(value.value);
  const recalcRequired =
    typeof value.recalcRequired === 'boolean' ? value.recalcRequired : null;
  if (
    !optionId ||
    optionConflictId !== conflictId ||
    !kind ||
    !optionValue ||
    recalcRequired === null
  ) {
    return null;
  }

  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    optionId,
    conflictId,
    kind,
    value: optionValue,
    recalcRequired,
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function isMergeResolutionOptionKind(
  value: unknown,
): value is VersionMergeConflictResolutionOptionKind {
  return typeof value === 'string' && VERSION_MERGE_RESOLUTION_OPTION_KINDS.has(value as never);
}

function compareResolutionOptionKinds(
  left: VersionMergeConflictResolutionOptionKind,
  right: VersionMergeConflictResolutionOptionKind,
): number {
  return (
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.indexOf(left) -
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.indexOf(right)
  );
}

function mapStructuralMetadata(value: unknown): VersionDiffStructuralMetadata | null {
  if (mapRedactedValue(value)) return null;
  if (!isRecord(value)) return null;

  if (
    typeof value.changeId !== 'string' ||
    typeof value.domain !== 'string' ||
    typeof value.entityId !== 'string' ||
    !Array.isArray(value.propertyPath) ||
    !value.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }

  return {
    kind: 'metadata',
    changeId: value.changeId,
    domain: value.domain,
    entityId: value.entityId,
    propertyPath: [...value.propertyPath],
  };
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  if (mapRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value)) return null;
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

function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  if (mapRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return {
    kind: 'redacted',
    reason: value.reason as VersionRedactedValue['reason'],
  };
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

function mapGraphDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [graphUninitializedDiagnostic()];
  }

  return value.map(mapGraphDiagnostic);
}

function mapGraphDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeDiagnosticPayload(value),
  });
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'merge',
  };

  if (typeof value.option === 'string') payload.option = value.option;
  if (typeof value.selector === 'string') payload.selector = value.selector;
  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const [key, detailValue] of Object.entries(details)) {
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }

  return payload;
}

function blockedMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}

function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version graph read service is attached; no merge preview is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

function mergeUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_MERGE_SERVICE_UNAVAILABLE',
    'No document-scoped version merge preview service is attached; no merge preview is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

function graphUninitializedDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'The workbook version graph is not initialized for this document.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version merge service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function invalidMergeOptionDiagnostic(
  option: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload: {
      option,
      ...payload,
    },
  });
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.merge.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version merge options are invalid for this method.';
    case 'VERSION_REDACTION_VIOLATION':
      return 'The requested version merge preview contains redacted semantic data.';
    case 'VERSION_MERGE_SERVICE_UNAVAILABLE':
      return 'No document-scoped version merge preview service is attached.';
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
      return 'The requested version merge ancestry is not previewable by the attached service.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'The version graph could not validate the requested merge commit closure.';
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'The requested version merge is not previewable by the attached service.';
    default:
      return 'The version graph could not complete merge preview.';
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_MERGE_SERVICE_UNAVAILABLE':
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

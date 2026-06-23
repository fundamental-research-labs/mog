import type {
  VersionDiagnosticPublicPayload,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionRevertTarget,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { mapCommitId, mapPublicRevision, mapPublicTargetRef } from './version-attempt-metadata';

export const VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE = 'VERSION_REVERT_PROVIDER_ERROR';
export const VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE =
  'VERSION_INVALID_COMMIT_PAYLOAD';

const PROVIDER_DIAGNOSTIC_PAYLOAD_KEYS = new Set([
  'actualCommitId',
  'actualHead',
  'actualRevision',
  'baseCommitId',
  'conflictCount',
  'conflictId',
  'conflictKind',
  'domain',
  'expectedCommitId',
  'expectedHead',
  'expectedRevision',
  'headCommitId',
  'mainlineParent',
  'matrixRowId',
  'rangeConflictCount',
  'reason',
  'refName',
  'selector',
  'targetRef',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionRevertService = {
  readonly revert: (
    input: VersionRevertInput,
    options?: VersionRevertOptions,
  ) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type AttachedVersionServices = {
  readonly revertService?: unknown;
  readonly versionRevertService?: unknown;
  readonly publicService?: unknown;
  readonly writeService?: unknown;
  readonly commitService?: unknown;
};

export function getAttachedVersionRevertService(
  ctx: DocumentContext,
): AttachedVersionRevertService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;

  for (const candidate of [
    services.revertService,
    services.versionRevertService,
    services.publicService,
    services.writeService,
    services.commitService,
    services,
  ]) {
    const service = toRevertService(candidate);
    if (service) return service;
  }

  return null;
}

export function mapRevertProviderResult(
  value: unknown,
  input: VersionRevertInput,
  options: VersionRevertOptions,
):
  | { readonly ok: true; readonly value: VersionRevertResult }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (isRecord(value) && value.ok === true) {
    return mapRevertProviderResult(value.value, input, options);
  }
  if (isRecord(value) && value.ok === false) {
    return {
      ok: false,
      diagnostics: mapProviderFailureDiagnostics(value, input),
    };
  }
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }

  const status = value.status;
  if (status === 'failed' || status === 'blocked' || status === 'degraded') {
    return { ok: false, diagnostics: mapProviderFailureDiagnostics(value, input) };
  }

  if (
    status !== 'planned' &&
    status !== 'applied' &&
    status !== 'rejected' &&
    status !== 'requires-review'
  ) {
    return { ok: false, diagnostics: [invalidProviderPayloadDiagnostic()] };
  }

  const target = mapProviderTarget(value.target, input.target);
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapProviderDiagnostics(value.diagnostics, input)
    : [];
  const mutationGuarantee = toRevertMutationGuarantee(value.mutationGuarantee, status, options);
  const commitRef = mapWorkbookCommitRef(value.commitRef ?? value.commit);
  const reviewInvalidationIds = mapOptionalStringArray(value.reviewInvalidationIds);

  if (
    !target ||
    !mutationGuarantee ||
    (value.commitRef !== undefined && !commitRef) ||
    (value.commit !== undefined && !commitRef) ||
    (value.reviewInvalidationIds !== undefined && !reviewInvalidationIds) ||
    (status === 'applied' && !commitRef)
  ) {
    return {
      ok: false,
      diagnostics: [...diagnostics, invalidProviderPayloadDiagnostic()],
    };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      status,
      target,
      ...(commitRef ? { commitRef } : {}),
      ...(reviewInvalidationIds ? { reviewInvalidationIds } : {}),
      diagnostics,
      mutationGuarantee,
    },
  };
}

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return revertProviderDiagnostic(
    VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE,
    'The version revert service failed before returning a usable public result.',
    { recoverability: 'retry' },
  );
}

function invalidProviderPayloadDiagnostic(): VersionStoreDiagnostic {
  return revertProviderDiagnostic(
    VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE,
    'The version revert service did not return a valid public revert result.',
    { recoverability: 'repair' },
  );
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}

function toRevertService(value: unknown): AttachedVersionRevertService | null {
  const revert =
    bindMethod(value, 'revert') ??
    bindMethod(value, 'revertVersion') ??
    bindMethod(value, 'revertCommit') ??
    bindMethod(value, 'revertCommits');
  return revert ? { revert: (input, options) => revert(input, options) } : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function mapProviderFailureDiagnostics(
  value: Readonly<Record<string, unknown>>,
  input: VersionRevertInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics = isRecord(value.error) ? value.error.diagnostics : value.diagnostics;
  const mapped = Array.isArray(diagnostics)
    ? mapProviderDiagnostics(diagnostics, input)
    : [providerErrorDiagnostic()];
  const mutationGuarantee = toDiagnosticMutationGuarantee(value.mutationGuarantee);
  return mutationGuarantee
    ? mapped.map((diagnostic) => ({ ...diagnostic, mutationGuarantee }))
    : mapped;
}

function mapProviderTarget(
  value: unknown,
  fallback: VersionRevertTarget,
): VersionRevertTarget | null {
  if (value === undefined) return fallback;
  if (!isRecord(value) || Array.isArray(value)) return null;

  if (value.kind === 'commit') {
    const commitId = mapCommitId(value.commitId);
    return commitId ? { kind: 'commit', commitId } : null;
  }
  if (value.kind === 'range') {
    const baseCommitId = mapCommitId(value.baseCommitId);
    const headCommitId = mapCommitId(value.headCommitId);
    return baseCommitId && headCommitId ? { kind: 'range', baseCommitId, headCommitId } : null;
  }
  if (value.kind === 'mergeCommit') {
    const commitId = mapCommitId(value.commitId);
    return commitId && isPositiveInteger(value.mainlineParent)
      ? { kind: 'mergeCommit', commitId, mainlineParent: value.mainlineParent }
      : null;
  }
  return null;
}

function mapWorkbookCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = mapCommitId(value.id);
  if (!id) return null;

  const refName = value.refName === undefined ? undefined : mapPublicTargetRef(value.refName);
  const resolvedFrom =
    value.resolvedFrom === undefined ? undefined : mapPublicRefSelector(value.resolvedFrom);
  const refRevision =
    value.refRevision === undefined ? undefined : mapPublicRevision(value.refRevision);
  if (
    (value.refName !== undefined && !refName) ||
    (value.resolvedFrom !== undefined && !resolvedFrom) ||
    (value.refRevision !== undefined && !refRevision)
  ) {
    return null;
  }

  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
    ...(refRevision ? { refRevision } : {}),
  };
}

function mapPublicRefSelector(
  value: unknown,
): 'HEAD' | VersionMainRefName | VersionRefName | undefined {
  if (value === 'HEAD') return 'HEAD';
  return mapPublicTargetRef(value);
}

function mapOptionalStringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? Object.freeze([...value])
    : undefined;
}

function mapProviderDiagnostics(
  value: readonly unknown[],
  input: VersionRevertInput,
): readonly VersionStoreDiagnostic[] {
  if (value.length === 0) return [];
  return value.map((entry) => mapProviderDiagnostic(entry, input));
}

function mapProviderDiagnostic(value: unknown, input: VersionRevertInput): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE;
  return {
    issueCode,
    severity: toDiagnosticSeverity(value.severity),
    recoverability:
      toRecoverability(value.recoverability) ?? recoverabilityForRevertIssue(issueCode),
    messageTemplateId:
      typeof value.messageTemplateId === 'string'
        ? value.messageTemplateId
        : `version.revert.${issueCode}`,
    safeMessage:
      typeof value.safeMessage === 'string'
        ? value.safeMessage
        : typeof value.message === 'string'
          ? value.message
          : safeMessageForRevertIssue(issueCode),
    payload: sanitizeProviderDiagnosticPayload(value, input),
    redacted: true,
    ...(toDiagnosticMutationGuarantee(value.mutationGuarantee)
      ? { mutationGuarantee: toDiagnosticMutationGuarantee(value.mutationGuarantee) }
      : {}),
  };
}

function sanitizeProviderDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  input: VersionRevertInput,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'revert',
    targetKind: input.target.kind,
  };

  copyKnownPayloadValues(payload, value);
  if (isRecord(value.details)) copyKnownPayloadValues(payload, value.details);
  if (isRecord(value.payload)) copyKnownPayloadValues(payload, value.payload);

  payload.operation = 'revert';
  return payload;
}

function copyKnownPayloadValues(
  target: Record<string, string | number | boolean | null>,
  source: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!PROVIDER_DIAGNOSTIC_PAYLOAD_KEYS.has(key) || !isPayloadPrimitive(value)) continue;
    target[key] = value;
  }
}

function toRevertMutationGuarantee(
  value: unknown,
  status: VersionRevertResult['status'],
  options: VersionRevertOptions,
): VersionRevertResult['mutationGuarantee'] | undefined {
  if (
    value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'revert-commit-created' ||
    value === 'unknown-after-crash'
  ) {
    return value;
  }
  if (value !== undefined) return undefined;
  if (status === 'planned') return 'no-write-attempted';
  if (status === 'applied') return 'revert-commit-created';
  return options.dryRun === true ? 'no-write-attempted' : 'ref-not-mutated';
}

function toDiagnosticMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function revertProviderDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: options.recoverability ?? recoverabilityForRevertIssue(issueCode),
    messageTemplateId: `version.revert.${issueCode}`,
    safeMessage,
    payload: { operation: 'revert', ...(options.payload ?? {}) },
    redacted: true,
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
  };
}

function safeMessageForRevertIssue(issueCode: string): string {
  switch (issueCode) {
    case VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE:
      return 'The version revert service did not return a valid public revert result.';
    case VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE:
      return 'The version revert service failed before returning a usable public result.';
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_REVERT_STALE_HEAD':
      return 'Version-control revert is rejected because the target head is stale or cannot be proven current.';
    case 'VERSION_REVERT_CONFLICT':
      return 'Version-control revert requires conflict review.';
    default:
      return 'Version-control revert failed.';
  }
}

function recoverabilityForRevertIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE:
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_REVERT_STALE_HEAD':
    case 'VERSION_REVERT_CONFLICT':
      return 'retry';
    case VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE:
      return 'repair';
    default:
      return 'none';
  }
}

function toDiagnosticSeverity(value: unknown): VersionStoreDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'fatal'
    ? value
    : 'error';
}

function toRecoverability(value: unknown): VersionStoreDiagnostic['recoverability'] | undefined {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none'
    ? value
    : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

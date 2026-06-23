import type {
  VersionDiagnosticPublicPayload,
  VersionDiagnostic,
  VersionRecordRevision,
  VersionRevertDomainAdmission,
  VersionRevertHistoryGapAdmission,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionRevertReviewInvalidationAdmission,
  VersionRevertTarget,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  mapCommitId,
  mapPublicExpectedTargetHead,
  mapPublicRevision,
  mapPublicTargetRef,
} from './version-attempt-metadata';
import {
  readVersionCheckoutAdmissionBlock,
  type VersionCheckoutAdmissionBlock,
} from './version-checkout-admission';
import { validateVersionOperationGate } from './version-operation-gate';
import {
  getAttachedVersionRevertService,
  mapRevertProviderResult,
  providerErrorDiagnostic,
  VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE,
} from './version-revert-provider';

export const VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE = 'VERSION_REVERT_UNAVAILABLE';
export const VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE = 'VERSION_REVERT_TARGET_REJECTED';
export const VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE =
  'VERSION_REVERT_UNSUPPORTED_DOMAIN';
export const VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE = 'VERSION_REVERT_OPAQUE_DOMAIN';
export const VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE = 'VERSION_REVERT_STALE_HEAD';
export const VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE = 'VERSION_REVERT_HISTORY_GAP';
export const VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE = 'VERSION_REVERT_CAS_UNAVAILABLE';
export const VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE =
  'VERSION_REVERT_REVIEW_INVALIDATION_UNSUPPORTED';
export const VERSION_REVERT_PENDING_PROVIDER_WRITES_DIAGNOSTIC_CODE =
  'VERSION_REVERT_PENDING_PROVIDER_WRITES';
export const VERSION_REVERT_WRITE_FENCE_UNAVAILABLE_DIAGNOSTIC_CODE =
  'VERSION_REVERT_WRITE_FENCE_UNAVAILABLE';
export {
  VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE,
};

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

const REVERT_INPUT_KEYS = new Set([
  'target',
  'targetRef',
  'expectedTargetHead',
  'preflight',
  'clientRequestId',
  'reason',
]);
const REVERT_OPTIONS_KEYS = new Set(['dryRun', 'includeDiagnostics']);
const REVERT_TARGET_KEYS = new Set([
  'kind',
  'commitId',
  'baseCommitId',
  'headCommitId',
  'mainlineParent',
]);
const REVERT_COMMIT_TARGET_KEYS = new Set(['kind', 'commitId']);
const REVERT_RANGE_TARGET_KEYS = new Set(['kind', 'baseCommitId', 'headCommitId']);
const REVERT_MERGE_COMMIT_TARGET_KEYS = new Set(['kind', 'commitId', 'mainlineParent']);
const EXPECTED_HEAD_KEYS = new Set(['commitId', 'revision', 'symbolicHeadRevision']);
const REVISION_KEYS = new Set(['kind', 'value']);
const PREFLIGHT_KEYS = new Set([
  'unsupportedDomains',
  'opaqueDomains',
  'staleHead',
  'gaps',
  'cas',
  'reviewInvalidation',
]);
const DOMAIN_ADMISSION_KEYS = new Set(['domain', 'matrixRowId', 'reason']);
const STALE_HEAD_KEYS = new Set(['refName', 'expectedCommitId', 'actualCommitId']);
const HISTORY_GAP_KEYS = new Set(['gapId', 'reason']);
const CAS_KEYS = new Set(['refName', 'expectedRevision', 'reason']);
const REVIEW_INVALIDATION_KEYS = new Set(['reviewId', 'expectedRevision', 'reason']);

type ValidationResult =
  | {
      readonly ok: true;
      readonly input: VersionRevertInput;
      readonly options: VersionRevertOptions;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionReadRefService = {
  readonly readRef: (name: string) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type AttachedVersionServices = {
  readonly publicService?: unknown;
  readonly writeService?: unknown;
  readonly commitService?: unknown;
  readonly readService?: unknown;
  readonly refService?: unknown;
};

type RevertTargetRefCasResult =
  | { readonly ok: true; readonly checked: boolean }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function revertWorkbookVersion(
  ctx: DocumentContext,
  input: VersionRevertInput,
  options: VersionRevertOptions = {},
): Promise<VersionResult<VersionRevertResult>> {
  const validated = validateRevertRequest(input, options);
  if (!validated.ok) return versionFailureFromRevertDiagnostics(validated.diagnostics);

  const gateDiagnostics = validateVersionOperationGate(ctx, 'revert', 'version:revert', {
    mutates: true,
  });
  if (gateDiagnostics.length > 0) {
    return versionFailureFromRevertDiagnostics(gateDiagnostics);
  }

  const service = getAttachedVersionRevertService(ctx);
  if (!service) {
    return versionFailureFromRevertDiagnostics(
      revertDisabledDiagnostics(validated.input, validated.options),
    );
  }

  const preflightDiagnostics = revertPreflightDiagnostics(validated.input);
  if (preflightDiagnostics.length > 0) {
    return versionFailureFromRevertDiagnostics(preflightDiagnostics);
  }

  const admissionBlock = await readVersionCheckoutAdmissionBlock(ctx);
  if (admissionBlock) {
    return versionFailureFromRevertDiagnostics([
      revertAdmissionDiagnostic(admissionBlock, validated.input),
    ]);
  }

  if (validated.options.dryRun !== true) {
    const cas = await validateRevertTargetRefCas(ctx, validated.input);
    if (!cas.ok) return versionFailureFromRevertDiagnostics(cas.diagnostics);
  }

  try {
    const result = mapRevertProviderResult(
      await service.revert(validated.input, validated.options),
      validated.input,
      validated.options,
    );
    return result.ok
      ? { ok: true, value: result.value }
      : versionFailureFromRevertDiagnostics(result.diagnostics);
  } catch {
    return versionFailureFromRevertDiagnostics([providerErrorDiagnostic()]);
  }
}

function getAttachedReadRefService(ctx: DocumentContext): AttachedVersionReadRefService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;

  for (const candidate of [
    services.readService,
    services.publicService,
    services.writeService,
    services.commitService,
    services.refService,
    services,
  ]) {
    const readRef = bindMethod(candidate, 'readRef');
    if (readRef) return { readRef: (name) => readRef(name) };
  }

  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

async function validateRevertTargetRefCas(
  ctx: DocumentContext,
  input: VersionRevertInput,
): Promise<RevertTargetRefCasResult> {
  if (!input.targetRef || !input.expectedTargetHead) return { ok: true, checked: false };

  const targetRef = mapPublicTargetRef(input.targetRef);
  const expectedTargetHead = mapPublicExpectedTargetHead(input.expectedTargetHead);
  if (!targetRef || !expectedTargetHead) {
    return {
      ok: false,
      diagnostics: [
        invalidOptionDiagnostic(
          !targetRef ? 'targetRef' : 'expectedTargetHead',
          !targetRef
            ? 'targetRef must name a public-safe version branch.'
            : 'expectedTargetHead must be a valid expected head record.',
        ),
      ],
    };
  }

  const readService = getAttachedReadRefService(ctx);
  if (!readService) return { ok: true, checked: false };

  try {
    const read = await readService.readRef(targetRef);
    const current = mapReadRefResult(read);
    if (!current) {
      return { ok: false, diagnostics: [providerErrorDiagnostic()] };
    }

    if (
      current.commitId === expectedTargetHead.commitId &&
      revisionsEqual(current.revision, expectedTargetHead.revision)
    ) {
      return { ok: true, checked: true };
    }

    return {
      ok: false,
      diagnostics: [
        revertDiagnostic(
          VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
          'Version-control revert is rejected because the target head is stale or cannot be proven current.',
          {
            reason: 'staleTargetHead',
            refName: targetRef,
            expectedCommitId: expectedTargetHead.commitId,
            actualCommitId: current.commitId,
            expectedRevisionKind: expectedTargetHead.revision.kind,
            expectedRevision: expectedTargetHead.revision.value,
            actualRevisionKind: current.revision.kind,
            actualRevision: current.revision.value,
          },
          'retry',
          'ref-not-mutated',
        ),
      ],
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

function mapReadRefResult(
  value: unknown,
): { readonly commitId: WorkbookCommitId; readonly revision: VersionRecordRevision } | null {
  const ref = unwrapRecordPayload(value, 'ref') ?? unwrapRecordPayload(value, 'value') ?? value;
  if (!isRecord(ref)) return null;
  const commitId = mapCommitId(ref.commitId ?? ref.id ?? ref.targetCommitId);
  const revision = mapPublicRevision(ref.revision ?? ref.refRevision);
  return commitId && revision ? { commitId, revision } : null;
}

function validateRevertRequest(input: unknown, options: unknown): ValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(invalidOptionDiagnostic('input', 'revert input must be an object.'));
    return { ok: false, diagnostics };
  }
  validateKnownKeys(input, REVERT_INPUT_KEYS, diagnostics);
  validateTarget(input.target, diagnostics);
  validateOptionalString(input, 'targetRef', diagnostics);
  validateOptionalCommitExpectedHead(input, 'expectedTargetHead', diagnostics);
  validateOptionalString(input, 'clientRequestId', diagnostics);
  validateOptionalString(input, 'reason', diagnostics);
  validatePreflight(input.preflight, diagnostics);
  validateOptions(options, diagnostics);
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : {
        ok: true,
        input: input as unknown as VersionRevertInput,
        options: options as unknown as VersionRevertOptions,
      };
}

function validateTarget(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('target', 'revert target must be an object.'));
    return;
  }
  switch (value.kind) {
    case 'commit':
      validateKnownKeys(value, REVERT_COMMIT_TARGET_KEYS, diagnostics, 'target');
      validateCommitId(value.commitId, 'target.commitId', diagnostics);
      break;
    case 'range':
      validateKnownKeys(value, REVERT_RANGE_TARGET_KEYS, diagnostics, 'target');
      validateCommitId(value.baseCommitId, 'target.baseCommitId', diagnostics);
      validateCommitId(value.headCommitId, 'target.headCommitId', diagnostics);
      break;
    case 'mergeCommit':
      validateKnownKeys(value, REVERT_MERGE_COMMIT_TARGET_KEYS, diagnostics, 'target');
      validateCommitId(value.commitId, 'target.commitId', diagnostics);
      validatePositiveInteger(value.mainlineParent, 'target.mainlineParent', diagnostics);
      break;
    default:
      validateKnownKeys(value, REVERT_TARGET_KEYS, diagnostics, 'target');
      diagnostics.push(
        invalidOptionDiagnostic('target.kind', 'revert target kind is unsupported.'),
      );
  }
}

function validatePreflight(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('preflight', 'preflight must be an object.'));
    return;
  }
  validateKnownKeys(value, PREFLIGHT_KEYS, diagnostics, 'preflight');
  validateDomainAdmissionList(
    value.unsupportedDomains,
    'preflight.unsupportedDomains',
    diagnostics,
  );
  validateDomainAdmissionList(value.opaqueDomains, 'preflight.opaqueDomains', diagnostics);
  validateStaleHead(value.staleHead, diagnostics);
  validateHistoryGapList(value.gaps, diagnostics);
  validateCas(value.cas, diagnostics);
  validateReviewInvalidationList(value.reviewInvalidation, diagnostics);
}

function validateDomainAdmissionList(
  value: unknown,
  path: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic(path, `${path} must be an array.`));
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `${path}.${index}`;
    if (!isRecord(entry) || Array.isArray(entry)) {
      diagnostics.push(invalidOptionDiagnostic(itemPath, `${itemPath} must be an object.`));
      return;
    }
    validateKnownKeys(entry, DOMAIN_ADMISSION_KEYS, diagnostics, itemPath);
    validateRequiredString(entry, 'domain', diagnostics, itemPath);
    validateOptionalString(entry, 'matrixRowId', diagnostics, itemPath);
    validateOptionalString(entry, 'reason', diagnostics, itemPath);
  });
}

function validateStaleHead(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidOptionDiagnostic('preflight.staleHead', 'staleHead must be an object.'),
    );
    return;
  }
  validateKnownKeys(value, STALE_HEAD_KEYS, diagnostics, 'preflight.staleHead');
  validateOptionalString(value, 'refName', diagnostics, 'preflight.staleHead');
  validateCommitId(value.expectedCommitId, 'preflight.staleHead.expectedCommitId', diagnostics);
  if ('actualCommitId' in value) {
    validateCommitId(value.actualCommitId, 'preflight.staleHead.actualCommitId', diagnostics);
  }
}

function validateHistoryGapList(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('preflight.gaps', 'gaps must be an array.'));
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `preflight.gaps.${index}`;
    if (!isRecord(entry) || Array.isArray(entry)) {
      diagnostics.push(invalidOptionDiagnostic(itemPath, `${itemPath} must be an object.`));
      return;
    }
    validateKnownKeys(entry, HISTORY_GAP_KEYS, diagnostics, itemPath);
    validateRequiredString(entry, 'gapId', diagnostics, itemPath);
    validateOptionalString(entry, 'reason', diagnostics, itemPath);
  });
}

function validateCas(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('preflight.cas', 'cas must be an object.'));
    return;
  }
  validateKnownKeys(value, CAS_KEYS, diagnostics, 'preflight.cas');
  validateOptionalString(value, 'refName', diagnostics, 'preflight.cas');
  validateOptionalRevision(value, 'expectedRevision', diagnostics, 'preflight.cas');
  validateOptionalString(value, 'reason', diagnostics, 'preflight.cas');
}

function validateReviewInvalidationList(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(
      invalidOptionDiagnostic(
        'preflight.reviewInvalidation',
        'reviewInvalidation must be an array.',
      ),
    );
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `preflight.reviewInvalidation.${index}`;
    if (!isRecord(entry) || Array.isArray(entry)) {
      diagnostics.push(invalidOptionDiagnostic(itemPath, `${itemPath} must be an object.`));
      return;
    }
    validateKnownKeys(entry, REVIEW_INVALIDATION_KEYS, diagnostics, itemPath);
    validateRequiredString(entry, 'reviewId', diagnostics, itemPath);
    validateOptionalPositiveInteger(entry, 'expectedRevision', diagnostics, itemPath);
    validateOptionalString(entry, 'reason', diagnostics, itemPath);
  });
}

function validateOptions(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('options', 'revert options must be an object.'));
    return;
  }
  validateKnownKeys(value, REVERT_OPTIONS_KEYS, diagnostics, 'options');
  validateOptionalBoolean(value, 'dryRun', diagnostics, 'options');
  validateOptionalBoolean(value, 'includeDiagnostics', diagnostics, 'options');
}

function revertPreflightDiagnostics(input: VersionRevertInput): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];

  for (const entry of input.preflight?.unsupportedDomains ?? []) {
    diagnostics.push(domainDiagnostic(VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE, entry));
  }
  for (const entry of input.preflight?.opaqueDomains ?? []) {
    diagnostics.push(domainDiagnostic(VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE, entry));
  }
  if (input.preflight?.staleHead) {
    diagnostics.push(
      revertDiagnostic(
        VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
        'Version-control revert is rejected because the target head is stale or cannot be proven current.',
        {
          refName: input.preflight.staleHead.refName ?? null,
          expectedCommitId: input.preflight.staleHead.expectedCommitId,
          actualCommitId: input.preflight.staleHead.actualCommitId ?? null,
        },
      ),
    );
  }
  for (const entry of input.preflight?.gaps ?? []) diagnostics.push(historyGapDiagnostic(entry));
  if (input.preflight?.cas) {
    diagnostics.push(
      revertDiagnostic(
        VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
        'Version-control revert is rejected because required CAS preconditions cannot be proven.',
        {
          refName: input.preflight.cas.refName ?? input.targetRef ?? null,
          reason: input.preflight.cas.reason ?? 'target-ref-cas',
          expectedHeadProvided: input.expectedTargetHead ? true : false,
        },
        'retry',
      ),
    );
  }
  for (const entry of input.preflight?.reviewInvalidation ?? []) {
    diagnostics.push(reviewInvalidationDiagnostic(entry));
  }

  return diagnostics;
}

function revertAdmissionDiagnostic(
  block: VersionCheckoutAdmissionBlock,
  input: VersionRevertInput,
): VersionStoreDiagnostic {
  const payload = revertAdmissionPayload(block, input);
  if (block.reason === 'pendingProviderWrites' || block.reason === 'syncBatchStatusBlocked') {
    return revertDiagnostic(
      VERSION_REVERT_PENDING_PROVIDER_WRITES_DIAGNOSTIC_CODE,
      'Version-control revert is blocked while remote sync changes are waiting to be promoted into version history.',
      payload,
      'retry',
    );
  }

  return revertDiagnostic(
    VERSION_REVERT_WRITE_FENCE_UNAVAILABLE_DIAGNOSTIC_CODE,
    'Version-control revert is blocked until the workbook is safe for provider writes.',
    payload,
    'retry',
  );
}

function revertAdmissionPayload(
  block: VersionCheckoutAdmissionBlock,
  input: VersionRevertInput,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'revert',
    targetKind: input.target.kind,
    reason: block.reason,
  };

  for (const key of [
    'pendingRemoteSegmentCount',
    'remoteSyncApplyActiveCount',
    'pendingRemotePromotionActiveCount',
    'pendingRemotePromotionQueuedCount',
    'syncBatchStatusPendingCount',
    'syncBatchStatusBlockedCount',
    'syncBatchStatusTerminalCount',
    'syncBatchStatusFailedAfterMutationCount',
    'syncBatchStatusDroppedCount',
    'syncBatchStatusRejectedCount',
    'syncBatchStatusReadFailedCount',
    'syncBatchStatusFirstState',
    'syncBatchStatusFirstReason',
    'syncBatchStatusFirstSegmentId',
    'syncBatchStatusFirstBatchStatusId',
  ] as const) {
    const value = block[key as keyof VersionCheckoutAdmissionBlock];
    if (isPayloadPrimitive(value)) payload[key] = value;
  }

  return payload;
}

function revertDisabledDiagnostics(
  input: VersionRevertInput,
  options: VersionRevertOptions,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [
    revertDiagnostic(
      VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
      'Version-control revert is disabled until the upstream revert contract is enabled.',
      {
        dependency: 'upstreamRevertContract',
        targetKind: input.target.kind,
        dryRun: options.dryRun === true,
      },
    ),
    targetRejectedDiagnostic(input.target),
  ];

  for (const entry of input.preflight?.unsupportedDomains ?? []) {
    diagnostics.push(domainDiagnostic(VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE, entry));
  }
  for (const entry of input.preflight?.opaqueDomains ?? []) {
    diagnostics.push(domainDiagnostic(VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE, entry));
  }
  if (input.preflight?.staleHead) {
    diagnostics.push(
      revertDiagnostic(
        VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
        'Version-control revert is rejected because the target head is stale or cannot be proven current.',
        {
          refName: input.preflight.staleHead.refName ?? null,
          expectedCommitId: input.preflight.staleHead.expectedCommitId,
          actualCommitId: input.preflight.staleHead.actualCommitId ?? null,
        },
      ),
    );
  }
  for (const entry of input.preflight?.gaps ?? []) {
    diagnostics.push(historyGapDiagnostic(entry));
  }
  if (input.expectedTargetHead || input.preflight?.cas) {
    diagnostics.push(
      revertDiagnostic(
        VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
        'Version-control revert is rejected because required CAS preconditions cannot be proven while revert is disabled.',
        {
          refName: input.preflight?.cas?.refName ?? input.targetRef ?? null,
          reason: input.preflight?.cas?.reason ?? 'target-ref-cas',
          expectedHeadProvided: input.expectedTargetHead ? true : false,
        },
      ),
    );
  }
  for (const entry of input.preflight?.reviewInvalidation ?? []) {
    diagnostics.push(reviewInvalidationDiagnostic(entry));
  }

  return diagnostics;
}

function targetRejectedDiagnostic(target: VersionRevertTarget): VersionStoreDiagnostic {
  return revertDiagnostic(
    VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
    'Version-control revert target admission is rejected while revert is disabled.',
    {
      targetKind: target.kind,
      mainlineParent: target.kind === 'mergeCommit' ? target.mainlineParent : null,
    },
  );
}

function domainDiagnostic(
  issueCode: string,
  entry: VersionRevertDomainAdmission,
): VersionStoreDiagnostic {
  return revertDiagnostic(
    issueCode,
    issueCode === VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE
      ? 'Version-control revert is rejected because opaque domains are present.'
      : 'Version-control revert is rejected because unsupported domains are present.',
    {
      domain: entry.domain,
      matrixRowId: entry.matrixRowId ?? null,
      reason: entry.reason ?? null,
    },
  );
}

function historyGapDiagnostic(entry: VersionRevertHistoryGapAdmission): VersionStoreDiagnostic {
  return revertDiagnostic(
    VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
    'Version-control revert is rejected because the selected history contains gaps.',
    {
      gapId: entry.gapId,
      reason: entry.reason ?? null,
    },
  );
}

function reviewInvalidationDiagnostic(
  entry: VersionRevertReviewInvalidationAdmission,
): VersionStoreDiagnostic {
  return revertDiagnostic(
    VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
    'Version-control revert review invalidation is not enabled.',
    {
      reviewId: entry.reviewId,
      expectedRevision: entry.expectedRevision ?? null,
      reason: entry.reason ?? null,
    },
  );
}

function invalidOptionDiagnostic(option: string, safeMessage: string): VersionStoreDiagnostic {
  return revertDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, { option }, 'none');
}

function versionFailureFromRevertDiagnostics<T>(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.revert',
      diagnostics: diagnostics.map(toVersionDiagnostic),
    },
  };
}

function toVersionDiagnostic(diagnostic: VersionStoreDiagnostic): VersionDiagnostic {
  return {
    code: diagnostic.issueCode,
    severity: diagnostic.severity === 'fatal' ? 'error' : diagnostic.severity,
    message: diagnostic.safeMessage,
    owner: 'version-store',
    data: {
      operation: 'revert',
      recoverability: diagnostic.recoverability,
      messageTemplateId: diagnostic.messageTemplateId,
      redacted: diagnostic.redacted,
      ...(diagnostic.payload ? { payload: diagnostic.payload } : {}),
      ...(diagnostic.mutationGuarantee ? { mutationGuarantee: diagnostic.mutationGuarantee } : {}),
    },
  };
}

function revertDiagnostic(
  issueCode: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload = {},
  recoverability: VersionStoreDiagnostic['recoverability'] = 'unsupported',
  mutationGuarantee: VersionStoreDiagnostic['mutationGuarantee'] = 'no-write-attempted',
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability,
    messageTemplateId: `version.revert.${issueCode}`,
    safeMessage,
    payload: sanitizeRevertPayload({ operation: 'revert', ...payload }),
    redacted: true,
    ...(mutationGuarantee ? { mutationGuarantee } : {}),
  };
}

function sanitizeRevertPayload(
  payload: VersionDiagnosticPublicPayload,
): VersionDiagnosticPublicPayload {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!isPayloadPrimitive(value)) continue;
    sanitized[key] =
      typeof value === 'string' && isUnsafeRevertPayloadText(value) ? 'redacted' : value;
  }
  return sanitized;
}

function isUnsafeRevertPayloadText(value: string): boolean {
  return /(?:preimage|merge-result:|secret|token)/i.test(value);
}

function validateKnownKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) continue;
    const option = path ? `${path}.${key}` : key;
    diagnostics.push(invalidOptionDiagnostic(option, `Unknown revert option "${option}".`));
  }
}

function validateCommitId(
  value: unknown,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookCommitId {
  if (typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)) return true;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a commit id.`));
  return false;
}

function validateOptionalCommitExpectedHead(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic(key, `${key} must be an object.`));
    return;
  }
  validateKnownKeys(value, EXPECTED_HEAD_KEYS, diagnostics, key);
  validateCommitId(value.commitId, `${key}.commitId`, diagnostics);
  validateRequiredRevision(value, 'revision', diagnostics, key);
  validateOptionalRevision(value, 'symbolicHeadRevision', diagnostics, key);
}

function validateRequiredRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path: string,
): void {
  if (toPublicRevision(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(`${path}.${key}`, `${path}.${key} is invalid.`));
}

function validateOptionalRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path: string,
): void {
  if (!(key in input) || toPublicRevision(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(`${path}.${key}`, `${path}.${key} is invalid.`));
}

function toPublicRevision(value: unknown): VersionRecordRevision | null {
  if (!isRecord(value) || Array.isArray(value)) return null;
  return Object.keys(value).every((key) => REVISION_KEYS.has(key)) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string'
    ? (value as VersionRecordRevision)
    : null;
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (typeof input[key] === 'string' && String(input[key]).length > 0) return;
  const option = path ? `${path}.${key}` : key;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a non-empty string.`));
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (!(key in input) || typeof input[key] === 'string') return;
  const option = path ? `${path}.${key}` : key;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a string.`));
}

function validateOptionalBoolean(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (!(key in input) || typeof input[key] === 'boolean') return;
  const option = path ? `${path}.${key}` : key;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a boolean.`));
}

function validatePositiveInteger(
  value: unknown,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Number.isInteger(value) && Number(value) >= 1) return;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a positive integer.`));
}

function validateOptionalPositiveInteger(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (!(key in input)) return;
  const option = path ? `${path}.${key}` : key;
  validatePositiveInteger(input[key], option, diagnostics);
}

function unwrapRecordPayload(
  value: unknown,
  key: string,
): Readonly<Record<string, unknown>> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function revisionsEqual(left: VersionRecordRevision, right: VersionRecordRevision): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

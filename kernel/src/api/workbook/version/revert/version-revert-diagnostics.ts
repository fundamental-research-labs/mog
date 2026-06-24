import type {
  VersionDiagnosticPublicPayload,
  VersionRevertDomainAdmission,
  VersionRevertHistoryGapAdmission,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertReviewInvalidationAdmission,
  VersionRevertTarget,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionCheckoutAdmissionBlock } from '../checkout/version-checkout-admission';

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

export function revertPreflightDiagnostics(
  input: VersionRevertInput,
): readonly VersionStoreDiagnostic[] {
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

export function revertAdmissionDiagnostic(
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

export function revertDisabledDiagnostics(
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

export function invalidOptionDiagnostic(
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return revertDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, { option }, 'none');
}

export function revertDiagnostic(
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

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

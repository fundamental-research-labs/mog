import type {
  VersionApplyMergeResult,
  VersionMergeChange,
  VersionRecordRevision,
  VersionStoreDiagnostic,
  VersionMainRefName,
  VersionRefName,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import {
  mapCommitId,
  mapPublicRevision,
  mapPublicTargetRef,
  mapVersionApplyMergeAttemptMetadata,
} from './version-attempt-metadata';

const VERSION_HEAD_REF = 'HEAD';
const SUCCESS_WRITE_STATUSES = new Set(['success', 'applied']);
const TERMINAL_WRITE_STATUSES = new Set(['fastForwarded', 'alreadyApplied', 'alreadyMerged']);

type VersionApplyMergeWritePlan = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
};

export function mapApplyMergeWriteResult(
  value: unknown,
  plan: VersionApplyMergeWritePlan,
  successMutationGuarantee: VersionApplyMergeResult['mutationGuarantee'],
): VersionApplyMergeResult {
  if (!isRecord(value)) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [providerErrorDiagnostic()]);
  }

  const metadata = mapVersionApplyMergeAttemptMetadata(value);
  if (!metadata) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      invalidProviderPayloadDiagnostic(),
    ]);
  }

  if (TERMINAL_WRITE_STATUSES.has(String(value.status))) {
    const commit = mapWorkbookCommitRef(value.commitRef ?? value.commit);
    const diagnostics = Array.isArray(value.diagnostics) ? mapWriteDiagnostics(value.diagnostics) : [];
    const mutationGuarantee =
      toTerminalMutationGuarantee(value.mutationGuarantee) ??
      (value.status === 'fastForwarded' ? 'ref-fast-forwarded' : 'ref-not-mutated');
    if (!commit || diagnostics.length > 0) {
      return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
        ...diagnostics,
        invalidProviderPayloadDiagnostic(),
      ]);
    }
    return {
      ...metadata,
      status: value.status as 'fastForwarded' | 'alreadyApplied' | 'alreadyMerged',
      base: plan.base,
      ours: plan.ours,
      theirs: plan.theirs,
      commitRef: commit,
      changes: [],
      conflicts: [],
      diagnostics: [],
      resolutionCount: plan.resolutionCount,
      mutationGuarantee,
    };
  }

  if (value.status === 'staleTargetHead') {
    return {
      ...metadata,
      status: 'staleTargetHead',
      base: mapCommitId(value.base) ?? plan.base,
      ours: mapCommitId(value.ours) ?? plan.ours,
      theirs: mapCommitId(value.theirs) ?? plan.theirs,
      changes: [],
      conflicts: [],
      diagnostics:
        value.diagnostics === undefined ? [] : mapWriteDiagnostics(value.diagnostics),
      mutationGuarantee: 'ref-not-mutated',
    };
  }

  if (!SUCCESS_WRITE_STATUSES.has(String(value.status))) {
    return blockedApplyMergeResult(
      plan.base,
      plan.ours,
      plan.theirs,
      mapWriteDiagnostics(value.diagnostics),
      toApplyMergeMutationGuarantee(value.mutationGuarantee),
    );
  }

  const commit = mapWorkbookCommitRef(value.commitRef ?? value.commit);
  const diagnostics = Array.isArray(value.diagnostics) ? mapWriteDiagnostics(value.diagnostics) : [];
  if (!commit || diagnostics.length > 0) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      ...diagnostics,
      invalidProviderPayloadDiagnostic(),
    ]);
  }

  return {
    ...metadata,
    status: 'applied',
    base: plan.base,
    ours: plan.ours,
    theirs: plan.theirs,
    commitRef: commit,
    changes: plan.changes,
    conflicts: [],
    diagnostics: [],
    resolutionCount: plan.resolutionCount,
    mutationGuarantee: successMutationGuarantee,
  };
}

export function isApplyMergeWriteSuccessResult(result: VersionApplyMergeResult): boolean {
  return (
    result.status === 'applied' ||
    result.status === 'fastForwarded' ||
    result.status === 'alreadyApplied' ||
    result.status === 'alreadyMerged'
  );
}

export function isNonFastForwardWriteResult(value: unknown): boolean {
  if (!isRecord(value) || isKnownWriteOutcomeStatus(value.status)) return false;
  if (!Array.isArray(value.diagnostics)) return false;
  return value.diagnostics.some((diagnostic) => {
    if (!isRecord(diagnostic)) return false;
    return (
      diagnostic.code === 'VERSION_UNSUPPORTED_PARENT_COMMIT' ||
      diagnostic.issueCode === 'VERSION_UNSUPPORTED_PARENT_COMMIT'
    );
  });
}

function isKnownWriteOutcomeStatus(value: unknown): boolean {
  return (
    SUCCESS_WRITE_STATUSES.has(String(value)) ||
    TERMINAL_WRITE_STATUSES.has(String(value)) ||
    value === 'staleTargetHead'
  );
}

function mapWorkbookCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = mapCommitId(value.id);
  if (!id) return null;

  const refName = value.refName === undefined ? undefined : mapPublicTargetRef(value.refName);
  const resolvedFrom =
    value.resolvedFrom === undefined ? undefined : mapPublicRefSelector(value.resolvedFrom);
  const refRevision = value.refRevision === undefined ? undefined : mapPublicRevision(value.refRevision);
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
): typeof VERSION_HEAD_REF | VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  return mapPublicTargetRef(value);
}

function mapWriteDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value)) return [providerErrorDiagnostic()];
  return value.map(mapWriteDiagnostic);
}

function mapWriteDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (isRecord(value) && typeof value.issueCode === 'string') {
    return {
      issueCode: value.issueCode,
      severity: isSeverity(value.severity) ? value.severity : 'error',
      recoverability: isRecoverability(value.recoverability) ? value.recoverability : 'none',
      messageTemplateId:
        typeof value.messageTemplateId === 'string'
          ? value.messageTemplateId
          : `version.applyMerge.${value.issueCode}`,
      safeMessage:
        typeof value.safeMessage === 'string'
          ? value.safeMessage
          : typeof value.message === 'string'
            ? value.message
            : 'Version applyMerge failed.',
      ...(isRecord(value.payload) ? { payload: mapPayload(value.payload) } : {}),
      redacted: value.redacted === true,
      ...(toDiagnosticMutationGuarantee(value.mutationGuarantee)
        ? { mutationGuarantee: toDiagnosticMutationGuarantee(value.mutationGuarantee) }
        : {}),
    };
  }
  if (isRecord(value) && typeof value.code === 'string') {
    return publicDiagnostic(
      value.code,
      typeof value.message === 'string' ? value.message : 'Version applyMerge failed.',
      {
        recoverability: value.code === 'VERSION_REF_CONFLICT' ? 'retry' : 'none',
        mutationGuarantee: toDiagnosticMutationGuarantee(value.mutationGuarantee),
      },
    );
  }
  return providerErrorDiagnostic();
}

function blockedApplyMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionApplyMergeResult['mutationGuarantee'] = 'no-write-attempted',
): VersionApplyMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee,
  };
}

function invalidProviderPayloadDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The version applyMerge service did not return a valid public result.',
    { recoverability: 'repair' },
  );
}

function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_PROVIDER_FAILED', 'Version applyMerge provider failed.', {
    recoverability: 'retry',
  });
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.applyMerge.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: { operation: 'applyMerge', ...options.payload } } : {}),
    redacted: true,
    mutationGuarantee: options.mutationGuarantee ?? 'no-write-attempted',
  };
}

function mapPayload(value: Readonly<Record<string, unknown>>): VersionStoreDiagnostic['payload'] {
  const payload: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    payload[key] = isPayloadPrimitive(item) ? item : String(item);
  }
  return payload;
}

function isSeverity(value: unknown): value is VersionStoreDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'fatal';
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function toApplyMergeMutationGuarantee(
  value: unknown,
): VersionApplyMergeResult['mutationGuarantee'] | undefined {
  return value === 'preview-only' ||
    value === 'merge-commit-created' ||
    value === 'ref-fast-forwarded' ||
    value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function toTerminalMutationGuarantee(
  value: unknown,
): 'ref-fast-forwarded' | 'ref-not-mutated' | undefined {
  return value === 'ref-fast-forwarded' || value === 'ref-not-mutated' ? value : undefined;
}

function toDiagnosticMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

import type {
  VersionApplyMergeResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { toDiagnosticMutationGuarantee } from './version-apply-merge-write-result-mutation-guarantee';
import { isRecord } from './version-apply-merge-write-result-shape';

export function mapWriteDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
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

export function blockedApplyMergeResult(
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

export function invalidTerminalReplayDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_COMMIT_PAYLOAD', safeMessage, {
    recoverability: 'repair',
    mutationGuarantee: 'ref-not-mutated',
  });
}

export function invalidAppliedWriteDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_COMMIT_PAYLOAD', safeMessage, {
    recoverability: 'repair',
    mutationGuarantee: 'unknown-after-crash',
  });
}

export function invalidProviderPayloadDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The version applyMerge service did not return a valid public result.',
    { recoverability: 'repair' },
  );
}

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_PROVIDER_FAILED', 'Version applyMerge provider failed.', {
    recoverability: 'retry',
  });
}

export function staleTargetHeadDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_CONFLICT',
    'The target ref head changed before applyMerge could mutate it.',
    {
      recoverability: 'retry',
      payload: { reason: 'staleTargetHead' },
      mutationGuarantee: 'ref-not-mutated',
    },
  );
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

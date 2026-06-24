import type {
  VersionApplyMergeResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { MergeApplyIntentStoreDiagnostic } from '../../../../../document/version-store/merge-apply-intent-store';
import { VersionObjectStoreError } from '../../../../../document/version-store/object-store';
import {
  isVersionObjectReadRepairDiagnosticCode,
  recoverabilityForVersionObjectRead,
} from '../../../version-object-read-diagnostics';

export function mapProviderDiagnostics(
  diagnostics: readonly unknown[],
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return [providerErrorDiagnostic()];
  return diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic)) return providerErrorDiagnostic();
    const issueCode =
      typeof diagnostic.issueCode === 'string'
        ? diagnostic.issueCode
        : typeof diagnostic.code === 'string'
          ? diagnostic.code
          : 'VERSION_PROVIDER_FAILED';
    return publicDiagnostic(
      publicIssueCodeForProviderIssue(issueCode),
      typeof diagnostic.safeMessage === 'string' &&
        isPublicSafeProviderMessage(diagnostic.safeMessage)
        ? diagnostic.safeMessage
        : safeProviderMessage(issueCode),
      {
        recoverability: recoverabilityForVersionObjectRead(
          issueCode,
          isRecoverability(diagnostic.recoverability) ? diagnostic.recoverability : 'retry',
        ),
      },
    );
  });
}

export function intentStoreDiagnostics(
  diagnostics: readonly MergeApplyIntentStoreDiagnostic[],
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((item) =>
    publicDiagnostic(item.code, item.message, {
      recoverability: item.recoverability,
      ...(item.details ? { payload: item.details } : {}),
    }),
  );
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

export function invalidPreviewArtifactDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'Persisted merge preview artifact payload is invalid.',
    { recoverability: 'repair' },
  );
}

export function persistedPreviewArtifactReadDiagnostic(error: unknown): VersionStoreDiagnostic {
  if (error instanceof VersionObjectStoreError) {
    if (error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND') {
      return publicDiagnostic(
        'VERSION_MISSING_OBJECT',
        'Persisted merge preview artifact could not be found.',
        { recoverability: 'repair' },
      );
    }
    if (isVersionObjectReadRepairDiagnosticCode(error.diagnostic.code)) {
      return invalidPreviewArtifactDiagnostic();
    }
  }
  return publicDiagnostic(
    'VERSION_PROVIDER_FAILED',
    'Persisted merge preview artifact could not be read.',
    { recoverability: 'retry' },
  );
}

export function resolutionMismatchDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_MERGE_RESOLUTION_MISMATCH', safeMessage, {
    recoverability: 'none',
  });
}

export function applyMergeServiceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_STORE_UNAVAILABLE',
    'No production merge-apply service is attached for version graph writes.',
    { recoverability: 'unsupported' },
  );
}

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_PROVIDER_FAILED', 'Version applyMerge provider failed.', {
    recoverability: 'retry',
  });
}

function safeProviderMessage(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_BYTE_LENGTH_MISMATCH':
    case 'VERSION_DIGEST_MISMATCH':
    case 'VERSION_INVALID_PAYLOAD':
    case 'VERSION_INVALID_PREIMAGE':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_TYPE_MISMATCH':
    case 'VERSION_UNSUPPORTED_OBJECT_TYPE':
    case 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING':
      return 'Persisted merge preview artifact payload is invalid.';
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_NOT_FOUND':
      return 'Version applyMerge provider could not read a required object.';
    case 'VERSION_PERMISSION_DENIED':
      return 'Version applyMerge provider denied access to required version data.';
    default:
      return 'Version applyMerge provider failed.';
  }
}

function publicIssueCodeForProviderIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_BYTE_LENGTH_MISMATCH':
    case 'VERSION_DIGEST_MISMATCH':
    case 'VERSION_INVALID_PAYLOAD':
    case 'VERSION_INVALID_PREIMAGE':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_TYPE_MISMATCH':
    case 'VERSION_UNSUPPORTED_OBJECT_TYPE':
    case 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING':
      return 'VERSION_INVALID_COMMIT_PAYLOAD';
    case 'VERSION_OBJECT_NOT_FOUND':
      return 'VERSION_MISSING_OBJECT';
    default:
      return issueCode;
  }
}

function isPublicSafeProviderMessage(value: string): boolean {
  return !/\b(?:commit:sha256:|merge-result:|sha256:)[0-9a-f]{64}\b/i.test(value);
}

export function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
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
    mutationGuarantee: 'no-write-attempted',
  };
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

import type { ObjectDigest, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { MergeApplyIntentStoreDiagnostic } from '../../../../document/version-store/merge-apply-intent-store';

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
      issueCode,
      typeof diagnostic.safeMessage === 'string' &&
        isPublicSafeProviderMessage(diagnostic.safeMessage)
        ? diagnostic.safeMessage
        : safeProviderMessage(issueCode),
      {
        recoverability: isRecoverability(diagnostic.recoverability)
          ? diagnostic.recoverability
          : 'retry',
      },
    );
  });
}

export function invalidRecoveryInputDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, { recoverability: 'none' });
}

export function recoveryNotReadyDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_MERGE_RECOVERY_NOT_READY', safeMessage, {
    recoverability: 'retry',
  });
}

export function refCasProofMismatchDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_MERGE_RESOLUTION_MISMATCH', safeMessage, {
    recoverability: 'none',
  });
}

export function recoveryOperationIdentityMismatchDiagnostic(
  safeMessage: string,
): VersionStoreDiagnostic {
  return refCasProofMismatchDiagnostic(safeMessage);
}

export function staleTargetHeadDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_CONFLICT',
    'Version applyMerge recovery is blocked because the target ref no longer matches the recovered operation.',
    {
      recoverability: 'retry',
      payload: { reason: 'staleTargetHead' },
    },
  );
}

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_PROVIDER_FAILED', 'Version applyMerge recovery failed.', {
    recoverability: 'retry',
  });
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
    ...(options.payload
      ? { payload: { operation: 'applyMergeRecovery', ...options.payload } }
      : {}),
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

export function isObjectDigest(value: unknown): value is ObjectDigest {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
}

export function digestsEqual(
  left: { readonly algorithm: string; readonly digest: string } | undefined,
  right: { readonly algorithm: string; readonly digest: string },
): boolean {
  return left?.algorithm === right.algorithm && left.digest === right.digest;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function safeProviderMessage(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_NOT_FOUND':
      return 'Version applyMerge recovery could not read a required object.';
    case 'VERSION_PERMISSION_DENIED':
      return 'Version applyMerge recovery provider denied access to required version data.';
    default:
      return 'Version applyMerge recovery provider failed.';
  }
}

function isPublicSafeProviderMessage(value: string): boolean {
  return !/\b(?:commit:sha256:|merge-result:|sha256:)[0-9a-f]{64}\b/i.test(value);
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

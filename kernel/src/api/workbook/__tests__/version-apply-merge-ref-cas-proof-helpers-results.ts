import type {
  VersionApplyMergeResult,
  VersionMergeResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { BASE, OURS, THEIRS } from './version-apply-merge-ref-cas-proof-helpers-constants';

export function cleanMergePreview(): VersionMergeResult {
  return {
    status: 'clean',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes: [
      {
        structural: {
          kind: 'metadata',
          changeId: 'change:target-ref-cas',
          domain: 'cells.values',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
        },
        base: { kind: 'value', value: null },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: 'theirs' },
        merged: { kind: 'value', value: 'theirs' },
      },
    ],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
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

export function intentStoreDiagnostics(
  diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly recoverability: VersionStoreDiagnostic['recoverability'];
  }[],
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    issueCode: diagnostic.code,
    severity: 'error',
    recoverability: diagnostic.recoverability,
    messageTemplateId: `version.applyMerge.${diagnostic.code}`,
    safeMessage: diagnostic.message,
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  }));
}

export function providerErrorDiagnosticForTest(): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_PROVIDER_FAILED',
    severity: 'error',
    recoverability: 'retry',
    messageTemplateId: 'version.applyMerge.VERSION_PROVIDER_FAILED',
    safeMessage: 'provider failed',
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

export function resolutionMismatchDiagnosticForTest(safeMessage: string): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: 'version.applyMerge.VERSION_MERGE_RESOLUTION_MISMATCH',
    safeMessage,
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

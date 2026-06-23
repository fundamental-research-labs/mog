import type { VersionNormalCommitCaptureInput } from './commit-service';
import { failedStoreResult, versionStoreDiagnostic, type VersionStoreFailure } from './provider';

export function missingNormalSemanticChangeSetFailure(input: {
  readonly commit: VersionNormalCommitCaptureInput;
  readonly safeMessage: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}): VersionStoreFailure {
  const { commit } = input;
  return failedStoreResult(
    [
      versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
        operation: 'commitGraphWrite',
        documentScope: commit.provider?.documentScope,
        namespace: commit.namespace,
        refName: commit.currentRef?.name,
        commitId: commit.currentRef?.commitId,
        safeMessage: input.safeMessage,
        mutationGuarantee: 'no-write-attempted',
        details: input.details ?? {},
      }),
    ],
    'no-write-attempted',
  );
}

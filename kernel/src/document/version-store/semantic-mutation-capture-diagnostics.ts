import type { VersionNormalCommitCaptureInput } from './commit-service';
import { failedStoreResult, versionStoreDiagnostic, type VersionStoreFailure } from './provider';

export function missingNormalSemanticChangeSetFailure(input: {
  readonly commit: VersionNormalCommitCaptureInput;
  readonly safeMessage: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}): VersionStoreFailure {
  return failedStoreResult(
    [
      versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
        operation: 'commitGraphWrite',
        documentScope: input.commit.provider.documentScope,
        namespace: input.commit.namespace,
        refName: input.commit.currentRef.name,
        commitId: input.commit.currentRef.commitId,
        safeMessage: input.safeMessage,
        mutationGuarantee: 'no-write-attempted',
        details: input.details ?? {},
      }),
    ],
    'no-write-attempted',
  );
}

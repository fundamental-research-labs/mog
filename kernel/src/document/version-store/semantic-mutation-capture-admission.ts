import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { VersionNormalCommitCaptureInput } from './commit-service';
import type { VersionStoreFailure } from './provider';
import { missingNormalSemanticChangeSetFailure } from './semantic-mutation-capture-diagnostics';

export type PendingUncapturedNormalMutation = {
  readonly sequence: number;
  readonly operation: string;
  readonly capturedAt: string;
  readonly reason: 'captureLaneSkipped' | 'emptySemanticChangeSet' | 'missingOperationContext';
  readonly operationContext?: VersionOperationContext;
};

export function normalCommitSemanticMutationAdmissionFailure(input: {
  readonly commit: VersionNormalCommitCaptureInput;
  readonly pendingUncapturedNormal: readonly PendingUncapturedNormalMutation[];
}): VersionStoreFailure | null {
  const missingContext = input.pendingUncapturedNormal.find(
    (record) => record.reason === 'missingOperationContext',
  );
  if (!missingContext) return null;

  return missingNormalSemanticChangeSetFailure({
    commit: input.commit,
    safeMessage:
      'Normal version commits require admitted operation context before mutation capture.',
    details: { reason: 'missingOperationContext' },
  });
}

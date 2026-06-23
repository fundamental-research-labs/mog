import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

export type SemanticMutationCaptureLane = 'normalLocal' | 'pendingRemote' | 'skip';

export function classifySemanticMutationCaptureLane(
  context: VersionOperationContext | undefined,
): SemanticMutationCaptureLane {
  if (!context) return 'normalLocal';
  if (!isCommitEligibleCapture(context)) return 'skip';

  const collaboration = context.collaboration;
  if (!collaboration) return context.kind === 'sync-import' ? 'skip' : 'normalLocal';
  if (collaboration.replay) return 'skip';
  if (collaboration.authorState === 'mixedRemote' || collaboration.authorState === 'unknown') {
    return 'skip';
  }

  const commitGrouping = collaboration.commitGrouping;
  if (context.kind === 'sync-import') {
    return commitGrouping === 'pendingRemote' ? 'pendingRemote' : 'skip';
  }
  if (commitGrouping === undefined || commitGrouping === 'none') {
    return 'normalLocal';
  }
  return 'skip';
}

export function isUncapturedNormalDirtyMutation(
  context: VersionOperationContext | undefined,
): boolean {
  if (!context) return false;
  if (context.kind === 'sync-import') return false;
  if (context.capturePolicy === 'rootCreation') return false;
  if (context.writeAdmissionMode === 'block') return false;
  if (context.collaboration?.replay || context.collaboration?.system) return false;
  return true;
}

function isCommitEligibleCapture(context: VersionOperationContext): boolean {
  return context.capturePolicy === 'commitEligible' && context.writeAdmissionMode === 'capture';
}

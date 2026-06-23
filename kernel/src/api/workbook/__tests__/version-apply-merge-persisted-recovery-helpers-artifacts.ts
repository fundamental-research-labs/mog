import type { VersionMergeResultId } from '@mog-sdk/contracts/api';

import {
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentRecord,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../../../document/version-store/merge-attempt-artifacts';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { versionDocumentScopeKey } from '../../../document/version-store/registry';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  EXPECTED_TARGET_HEAD,
  OURS,
  RESULT_DIGEST,
  TARGET_REF,
  THEIRS,
} from './version-apply-merge-persisted-recovery-helpers-values';

export async function artifactFixture(graphId: string) {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const resolutionSet = await createMergeResolutionSetArtifactRecord(namespace, []);
  const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: resolutionSet.digest,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
  });
  const resultId = `merge-result:${RESULT_DIGEST.digest}` as VersionMergeResultId;
  const record: MergeApplyIntentRecord = {
    schemaVersion: 1,
    recordKind: 'mergeApplyIntent',
    intentId: intentIdForResolvedAttemptDigest(resolvedAttempt.digest),
    idempotencyKey: idempotencyKeyForResolvedAttempt({
      resolvedAttemptDigest: resolvedAttempt.digest,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
    }),
    namespaceKey: versionGraphNamespaceKey(namespace),
    documentScopeKey: versionDocumentScopeKey(DOCUMENT_SCOPE),
    applyKind: 'mergeCommit',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
    state: 'staging',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  return {
    namespace,
    resultId,
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
    record,
  };
}

export function artifactInput() {
  return {
    resultId: `merge-result:${RESULT_DIGEST.digest}` as VersionMergeResultId,
    resultDigest: RESULT_DIGEST,
    previewArtifactDigest: RESULT_DIGEST,
  };
}

export function persistedIntentInput(fixture: Awaited<ReturnType<typeof artifactFixture>>) {
  return {
    resultId: `merge-result:${fixture.resolvedAttemptDigest.digest}` as VersionMergeResultId,
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: fixture.resolutionSetDigest,
    resolvedAttemptDigest: fixture.resolvedAttemptDigest,
  };
}

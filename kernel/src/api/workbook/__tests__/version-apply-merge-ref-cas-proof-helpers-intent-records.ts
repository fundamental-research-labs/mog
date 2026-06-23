import type { MergeApplyIntentRecord } from '../../../document/version-store/merge-apply-intent-store';
import type { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import { versionDocumentScopeKey } from '../../../document/version-store/registry';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  EXPECTED_TARGET_HEAD,
  OURS,
  RESOLVED_ATTEMPT_DIGEST,
  RESOLUTION_SET_DIGEST,
  RESULT_DIGEST,
  TARGET_REF,
  THEIRS,
} from './version-apply-merge-ref-cas-proof-helpers-constants';

export function fastForwardIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
): MergeApplyIntentRecord {
  return mergeApplyIntentRecord(namespace, 'fastForward');
}

export function mergeCommitIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
): MergeApplyIntentRecord {
  return mergeApplyIntentRecord(namespace, 'mergeCommit');
}

function mergeApplyIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
  applyKind: MergeApplyIntentRecord['applyKind'],
): MergeApplyIntentRecord {
  return {
    schemaVersion: 1,
    recordKind: 'mergeApplyIntent',
    intentId: `merge-apply-intent:sha256:${RESOLVED_ATTEMPT_DIGEST.digest}`,
    idempotencyKey: 'merge-apply:missing-proof',
    namespaceKey: versionGraphNamespaceKey(namespace),
    documentScopeKey: versionDocumentScopeKey(DOCUMENT_SCOPE),
    applyKind,
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: RESOLUTION_SET_DIGEST,
    resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
    state: 'staging',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

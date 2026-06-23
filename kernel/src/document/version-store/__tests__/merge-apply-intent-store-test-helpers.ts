import type { VersionCommitExpectedHead, VersionMainRefName } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  computeEmptyResolutionSetDigest,
  computeMergeApplyResultDigest,
  computeResolvedAttemptDigest,
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  type BeginMergeApplyIntentInput,
} from '../merge-apply-intent-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const BASE = `commit:sha256:${'1'.repeat(64)}` as WorkbookCommitId;
export const OURS = `commit:sha256:${'2'.repeat(64)}` as WorkbookCommitId;
export const THEIRS = `commit:sha256:${'3'.repeat(64)}` as WorkbookCommitId;
export const TARGET_REF = 'refs/heads/main' as VersionMainRefName;
export const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

export async function fastForwardIntentInput(): Promise<BeginMergeApplyIntentInput> {
  const resultDigest = await computeMergeApplyResultDigest({
    status: 'fastForward',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
  });
  const resolutionSetDigest = await computeEmptyResolutionSetDigest();
  const resolvedAttemptDigest = await computeResolvedAttemptDigest({
    resultDigest,
    resolutionSetDigest,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
  });
  return {
    intentId: intentIdForResolvedAttemptDigest(resolvedAttemptDigest),
    idempotencyKey: idempotencyKeyForResolvedAttempt({
      resolvedAttemptDigest,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
    }),
    applyKind: 'fastForward',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
    resultDigest,
    resolutionSetDigest,
    resolvedAttemptDigest,
    createdAt: '2026-06-21T00:00:00.000Z',
  };
}

export async function initializeProvider(provider: {
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
}): Promise<VersionGraphNamespace> {
  const input = await initializeInput('graph-1');
  const initialized = await provider.initializeGraph(input);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(
        'workbook.snapshotRoot.v1',
        { label: 'root', sheets: [] },
        namespace,
      ),
      semanticChangeSetRecord: await objectRecord(
        'workbook.semanticChangeSet.v1',
        { label: 'root', changes: [] },
        namespace,
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

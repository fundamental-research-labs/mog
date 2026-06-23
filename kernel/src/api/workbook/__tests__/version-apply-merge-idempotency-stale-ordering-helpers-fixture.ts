import type {
  ObjectDigest as PublicObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMergeChange,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergeResultIdForPreviewDigest,
} from '../../../document/version-store/merge-attempt-artifacts';
import { idempotencyKeyForResolvedAttempt } from '../../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  AUTHOR,
  CREATED_AT,
  DOCUMENT_ID,
  DOCUMENT_RUN_ID,
  TARGET_REF,
  type ApplyMergeServiceFactory,
  type CleanPreviewMetadata,
  type CleanReviewFixture,
} from './version-apply-merge-idempotency-stale-ordering-helpers-core';
import {
  expectInitializeSuccess,
  expectObjectPutSuccess,
} from './version-apply-merge-idempotency-stale-ordering-helpers-expectations';
import {
  commitGraph,
  objectRecord,
} from './version-apply-merge-idempotency-stale-ordering-helpers-graph';

export async function createCleanReviewFixture(
  graphId: string,
  applyMergeServiceFactory: ApplyMergeServiceFactory,
): Promise<CleanReviewFixture> {
  const documentScope = documentScopeForGraph(graphId);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);
  const graph = await provider.openGraph(namespace, provider.accessContext);

  const base = await commitGraph(graph, namespace, {
    label: 'base',
    targetRef: TARGET_REF,
    expectedHeadCommitId: initialized.rootCommit.id,
    expectedTargetRefVersion: initialized.initialHead.revision,
    parentCommitIds: [initialized.rootCommit.id],
  });
  const branch = await graph.createBranch({
    name: `scenario/${graphId}`,
    targetCommitId: base.commit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

  const ours = await commitGraph(graph, namespace, {
    label: 'ours',
    targetRef: TARGET_REF,
    expectedHeadCommitId: base.commit.id,
    expectedTargetRefVersion: base.ref.revision,
    parentCommitIds: [base.commit.id],
  });
  const theirs = await commitGraph(graph, namespace, {
    label: 'theirs',
    targetRef: `refs/heads/scenario/${graphId}`,
    expectedHeadCommitId: base.commit.id,
    expectedTargetRefVersion: branch.branch.ref.refVersion,
    parentCommitIds: [base.commit.id],
  });
  const previewRecord = await createMergePreviewArtifactRecord(namespace, {
    status: 'clean',
    base: base.commit.id,
    ours: ours.commit.id,
    theirs: theirs.commit.id,
    changes: [mergeChange('clean-change-c1')],
  });
  expectObjectPutSuccess(await graph.putObjects([previewRecord]));

  const expectedTargetHead: VersionCommitExpectedHead = {
    commitId: ours.commit.id,
    revision: ours.ref.revision,
  };
  const version = new WorkbookVersionImpl({
    versioning: withVersionManifest({
      provider,
      applyMergeService: applyMergeServiceFactory({ graph, namespace }),
    }),
  } as any);

  return {
    provider,
    graph,
    namespace,
    version,
    baseCommitId: base.commit.id,
    oursCommitId: ours.commit.id,
    theirsCommitId: theirs.commit.id,
    expectedTargetHead,
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest as PublicObjectDigest,
      previewArtifactDigest: previewRecord.digest as PublicObjectDigest,
    },
  };
}

export async function createAlternatePreview(
  fixture: CleanReviewFixture,
  changeId: string,
): Promise<CleanPreviewMetadata> {
  const previewRecord = await createMergePreviewArtifactRecord(fixture.namespace, {
    status: 'clean',
    base: fixture.baseCommitId,
    ours: fixture.oursCommitId,
    theirs: fixture.theirsCommitId,
    changes: [mergeChange(changeId)],
  });
  expectObjectPutSuccess(await fixture.graph.putObjects([previewRecord]));
  return {
    resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
    resultDigest: previewRecord.digest as PublicObjectDigest,
    previewArtifactDigest: previewRecord.digest as PublicObjectDigest,
  };
}

export async function readTargetHeadCommitId(
  fixture: CleanReviewFixture,
): Promise<WorkbookCommitId> {
  const read = await fixture.graph.readRef(TARGET_REF);
  expect(read.status).toBe('success');
  if (read.status !== 'success' || !('commitId' in read.ref)) {
    throw new Error(`expected target ref read success: ${read.diagnostics[0]?.code}`);
  }
  return read.ref.commitId;
}

export async function expectedResolvedAttempt(
  fixture: CleanReviewFixture,
  resolutions: readonly VersionApplyMergeResolution[],
): Promise<{
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly idempotencyKey: ReturnType<typeof idempotencyKeyForResolvedAttempt>;
}> {
  const resolutionSet = await createMergeResolutionSetArtifactRecord(
    fixture.namespace,
    resolutions,
  );
  const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(fixture.namespace, {
    resultDigest: fixture.preview.resultDigest as ObjectDigest,
    resolutionSetDigest: resolutionSet.digest,
    targetRef: TARGET_REF,
    expectedTargetHead: fixture.expectedTargetHead,
  });
  return {
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
    idempotencyKey: idempotencyKeyForResolvedAttempt({
      resolvedAttemptDigest: resolvedAttempt.digest,
      targetRef: TARGET_REF,
      expectedTargetHead: fixture.expectedTargetHead,
    }),
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return { documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}` };
}

async function initializeInput(
  graphId: string,
  label: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function mergeChange(changeId: string): VersionMergeChange {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells.values',
      entityId: 'sheet-1!C1',
      propertyPath: ['value'],
    },
    base: { kind: 'value', value: null },
    ours: { kind: 'value', value: null },
    theirs: { kind: 'value', value: 'theirs' },
    merged: { kind: 'value', value: 'theirs' },
  };
}

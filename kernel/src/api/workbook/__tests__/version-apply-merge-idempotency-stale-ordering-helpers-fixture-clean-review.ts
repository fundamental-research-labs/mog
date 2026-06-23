import type {
  ObjectDigest as PublicObjectDigest,
  VersionCommitExpectedHead,
} from '@mog-sdk/contracts/api';

import {
  createMergePreviewArtifactRecord,
  mergeResultIdForPreviewDigest,
} from '../../../document/version-store/merge-attempt-artifacts';
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
import { mergeChange } from './version-apply-merge-idempotency-stale-ordering-helpers-fixture-merge-change';

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

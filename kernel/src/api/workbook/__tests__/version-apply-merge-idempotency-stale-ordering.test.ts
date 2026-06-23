import { jest } from '@jest/globals';

import type {
  ObjectDigest as PublicObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeResultId,
  VersionRecordRevision,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type {
  CommitVersionGraphInput,
  MergeVersionGraphInput,
  VersionGraphWriteResult,
} from '../../../document/version-store/graph-store';
import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergeResolutionSetArtifactRef,
  mergeResultIdForPreviewDigest,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
} from '../../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest, VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type InMemoryVersionStoreProvider,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import type { VersionGraphStore } from '../../../document/version-store/provider-graph-store';
import { WorkbookVersionImpl } from '../version';
import { withVersionManifest } from './version-domain-support-test-utils';

const DOCUMENT_ID = 'vc07-public-apply-merge-idempotency-stale-ordering';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const TARGET_REF = 'refs/heads/main' as VersionMainRefName;
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type VersionGraphWriteSuccess = Extract<VersionGraphWriteResult, { readonly status: 'success' }>;
type ApplyMergeServiceFactory = (input: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
}) => Record<string, unknown>;

type CleanPreviewMetadata = {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: PublicObjectDigest;
  readonly previewArtifactDigest: PublicObjectDigest;
};

type CleanReviewFixture = {
  readonly provider: InMemoryVersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
  readonly version: WorkbookVersionImpl;
  readonly baseCommitId: WorkbookCommitId;
  readonly oursCommitId: WorkbookCommitId;
  readonly theirsCommitId: WorkbookCommitId;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly preview: CleanPreviewMetadata;
};

describe('WorkbookVersion public applyMerge idempotency and stale ordering', () => {
  it('replays a successful apply with the same intent before stale-target rejection', async () => {
    const fixture = await createCleanReviewFixture(
      'terminal-replay-before-stale',
      graphBackedApplyMergeService,
    );

    const first = await fixture.version.applyMerge(
      {
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
      },
    );
    if (!first.ok) throw new Error(`expected first apply success: ${first.error.code}`);
    expect(first.value).toMatchObject({
      status: 'applied',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      resultId: fixture.preview.resultId,
      resultDigest: fixture.preview.resultDigest,
      previewArtifactDigest: fixture.preview.previewArtifactDigest,
      targetRef: TARGET_REF,
      headBefore: fixture.oursCommitId,
      mutationGuarantee: 'merge-commit-created',
    });
    if (first.value.status !== 'applied') throw new Error('expected first apply to create merge');
    const mergeCommitId = first.value.commitRef.id;

    const repeated = await fixture.version.applyMerge(
      {
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
      },
    );
    if (!repeated.ok) throw new Error(`expected repeated apply success: ${repeated.error.code}`);
    expect(repeated.value).toMatchObject({
      status: 'alreadyApplied',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      resultId: fixture.preview.resultId,
      resultDigest: fixture.preview.resultDigest,
      previewArtifactDigest: fixture.preview.previewArtifactDigest,
      targetRef: TARGET_REF,
      headBefore: fixture.oursCommitId,
      headAfter: mergeCommitId,
      commitRef: {
        id: mergeCommitId,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
      },
      changes: [],
      conflicts: [],
      resolutionCount: 0,
      mutationGuarantee: 'ref-not-mutated',
    });
  });

  it('rejects a stale target ref before staging a new apply intent', async () => {
    const mergeCommit = jest.fn();
    const fixture = await createCleanReviewFixture('stale-before-new-intent', () => ({
      mergeCommit,
    }));

    const advanced = await commitGraph(fixture.graph, fixture.namespace, {
      label: 'advanced',
      targetRef: TARGET_REF,
      expectedHeadCommitId: fixture.oursCommitId,
      expectedTargetRefVersion: fixture.expectedTargetHead.revision,
      parentCommitIds: [fixture.oursCommitId],
    });

    const stale = await fixture.version.applyMerge(
      {
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
      },
    );
    if (!stale.ok) throw new Error(`expected stale apply result success: ${stale.error.code}`);
    expect(stale.value).toMatchObject({
      status: 'staleTargetHead',
      base: fixture.baseCommitId,
      ours: fixture.oursCommitId,
      theirs: fixture.theirsCommitId,
      resultId: fixture.preview.resultId,
      resultDigest: fixture.preview.resultDigest,
      previewArtifactDigest: fixture.preview.previewArtifactDigest,
      targetRef: TARGET_REF,
      headBefore: fixture.oursCommitId,
      headAfter: advanced.commit.id,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(mergeCommit).not.toHaveBeenCalled();

    const attempt = await expectedResolvedAttempt(fixture, []);
    const store = await fixture.provider.openMergeApplyIntentStore(fixture.namespace);
    await expect(
      store.readByIntentId(intentIdForResolvedAttemptDigest(attempt.resolvedAttemptDigest)),
    ).resolves.toMatchObject({ status: 'missing' });
    await expect(
      fixture.graph.hasObject(mergeResolutionSetArtifactRef(attempt.resolutionSetDigest)),
    ).resolves.toBe(false);
  });

  it('binds staged apply intent metadata to targetRef and expectedHead', async () => {
    const mergeCommit = jest.fn(async () => ({
      status: 'blocked',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        {
          issueCode: 'VERSION_PROVIDER_FAILED',
          severity: 'error',
          recoverability: 'retry',
          messageTemplateId: 'version.applyMerge.injectedFailure',
          safeMessage: 'Injected applyMerge failure after staging.',
          redacted: true,
          mutationGuarantee: 'no-write-attempted',
        } satisfies VersionStoreDiagnostic,
      ],
    }));
    const fixture = await createCleanReviewFixture('staged-intent-metadata', () => ({
      mergeCommit,
    }));

    const stopped = await fixture.version.applyMerge(
      {
        resultId: fixture.preview.resultId,
        resultDigest: fixture.preview.resultDigest,
        previewArtifactDigest: fixture.preview.previewArtifactDigest,
      },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
      },
    );
    expect(stopped).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROVIDER_FAILED',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });
    expect(mergeCommit).toHaveBeenCalledTimes(1);

    const attempt = await expectedResolvedAttempt(fixture, []);
    expect(mergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
        resolvedMergeAttemptDigest: attempt.resolvedAttemptDigest,
      }),
    );

    const store = await fixture.provider.openMergeApplyIntentStore(fixture.namespace);
    const read = await store.readByIntentId(
      intentIdForResolvedAttemptDigest(attempt.resolvedAttemptDigest),
    );
    expect(read).toMatchObject({
      status: 'found',
      record: {
        state: 'staging',
        applyKind: 'mergeCommit',
        base: fixture.baseCommitId,
        ours: fixture.oursCommitId,
        theirs: fixture.theirsCommitId,
        targetRef: TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
        resultDigest: fixture.preview.resultDigest,
        resolutionSetDigest: attempt.resolutionSetDigest,
        resolvedAttemptDigest: attempt.resolvedAttemptDigest,
        idempotencyKey: attempt.idempotencyKey,
      },
    });
  });
});

async function createCleanReviewFixture(
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

function graphBackedApplyMergeService({
  graph,
  namespace,
}: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
}): Record<string, unknown> {
  return {
    mergeCommit: async (input: {
      readonly base: WorkbookCommitId;
      readonly ours: WorkbookCommitId;
      readonly theirs: WorkbookCommitId;
      readonly targetRef: VersionMainRefName;
      readonly expectedTargetHead: VersionCommitExpectedHead;
      readonly resolvedMergeAttemptDigest?: ObjectDigest;
    }) => {
      const merge = await graph.mergeCommit({
        ...(await graphCommitContent(namespace, 'merge')),
        targetRef: input.targetRef,
        expectedHeadCommitId: input.ours,
        expectedTargetRefVersion: input.expectedTargetHead.revision,
        mergeParentCommitId: input.theirs,
        ...(input.resolvedMergeAttemptDigest
          ? { resolvedMergeAttemptDigest: input.resolvedMergeAttemptDigest }
          : {}),
      } satisfies MergeVersionGraphInput);
      if (merge.status !== 'success') return merge;
      return {
        status: 'success',
        commitRef: {
          id: merge.commit.id,
          refName: merge.ref.name,
          resolvedFrom: merge.ref.name,
          refRevision: merge.ref.revision,
        },
        diagnostics: [],
      };
    },
  };
}

async function expectedResolvedAttempt(
  fixture: CleanReviewFixture,
  resolutions: readonly VersionApplyMergeResolution[],
): Promise<{
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly idempotencyKey: ReturnType<typeof idempotencyKeyForResolvedAttempt>;
}> {
  const resolutionSet = await createMergeResolutionSetArtifactRecord(fixture.namespace, resolutions);
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

async function commitGraph(
  graph: VersionGraphStore,
  namespace: VersionGraphNamespace,
  input: {
    readonly label: string;
    readonly targetRef: string;
    readonly expectedHeadCommitId: WorkbookCommitId;
    readonly expectedTargetRefVersion: VersionRecordRevision;
    readonly parentCommitIds: readonly WorkbookCommitId[];
  },
): Promise<VersionGraphWriteSuccess> {
  const commit = await graph.commit({
    ...(await graphCommitContent(namespace, input.label)),
    targetRef: input.targetRef,
    expectedHeadCommitId: input.expectedHeadCommitId,
    expectedTargetRefVersion: input.expectedTargetRefVersion,
    parentCommitIds: input.parentCommitIds,
  } satisfies CommitVersionGraphInput);
  expectGraphWriteSuccess(commit);
  return commit;
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

async function graphCommitContent(
  namespace: VersionGraphNamespace,
  label: string,
): Promise<
  Pick<
    CommitVersionGraphInput,
    | 'snapshotRootRecord'
    | 'semanticChangeSetRecord'
    | 'mutationSegmentRecords'
    | 'author'
    | 'createdAt'
    | 'completenessDiagnostics'
  >
> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      label,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return { documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}` };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is VersionGraphWriteSuccess {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

function expectObjectPutSuccess(
  result: VersionObjectPutBatchResult,
): asserts result is Extract<VersionObjectPutBatchResult, { readonly status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected object put success: ${result.diagnostics[0]?.code}`);
  }
}

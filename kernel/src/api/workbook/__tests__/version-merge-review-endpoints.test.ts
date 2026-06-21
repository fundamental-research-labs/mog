import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionHead,
  VersionMergeConflict,
  VersionMergeResult,
  VersionMergeResultId,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  mergeResolutionSetArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'vc07-merge-review-endpoints';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
type PersistedConflictPreview = VersionMergeResult & {
  readonly status: 'conflicted';
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
};

describe('WorkbookVersion merge review endpoints', () => {
  it('reads conflict detail from a persisted merge preview artifact', async () => {
    await withPersistedConflictPreview('detail-readback', async ({ sourceWb, preview }) => {
      const conflict = preview.conflicts[0];
      const detail = await sourceWb.version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
      });

      expect(detail).toMatchObject({
        ok: true,
        value: {
          schemaVersion: 1,
          kind: 'reviewValue',
          conflictId: conflict.conflictId,
          conflictDigest: conflict.conflictDigest,
          valueRole: 'theirs',
          purpose: 'review',
          value: conflict.theirs,
          resolutionOptions: expect.arrayContaining([
            expect.objectContaining({ optionId: expect.any(String), kind: 'acceptOurs' }),
            expect.objectContaining({ optionId: expect.any(String), kind: 'acceptTheirs' }),
            expect.objectContaining({ optionId: expect.any(String), kind: 'acceptBase' }),
          ]),
        },
      });
    });
  });

  it('persists saved resolutions as resolution-set and resolved-attempt artifacts', async () => {
    await withPersistedConflictPreview('save-persistence', async ({
      provider,
      graphId,
      sourceWb,
      preview,
      expectedTargetHead,
    }) => {
      const conflict = preview.conflicts[0];
      const resolution = resolutionFor(conflict, 'acceptTheirs');

      const saved = await sourceWb.version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead,
        resolutions: [resolution],
      });
      if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
        throw new Error('expected saved merge resolutions to expose artifact digests');
      }
      expect(saved.value).toMatchObject({
        schemaVersion: 1,
        kind: 'mergeResolutionsSaved',
        status: 'readyToApply',
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        attemptKind: 'applyable',
        attemptPersistence: 'persisted',
        targetRef: 'refs/heads/main',
        savedResolutionCount: 1,
      });

      const graph = await provider.openGraph(
        namespaceForDocumentScope(DOCUMENT_SCOPE, graphId),
        provider.accessContext,
      );
      await expect(
        graph.getObjectRecord(mergeResolutionSetArtifactRef(saved.value.resolutionSetDigest)),
      ).resolves.toMatchObject({
        preimage: {
          objectType: 'workbook.mergeResolutionSet.v1',
          payload: {
            schemaVersion: 1,
            recordKind: 'mergeResolutionSet',
            resolutions: [resolution],
          },
        },
      });
      await expect(
        graph.getObjectRecord(resolvedMergeAttemptArtifactRef(saved.value.resolvedAttemptDigest)),
      ).resolves.toMatchObject({
        preimage: {
          objectType: 'workbook.resolvedMergeAttempt.v1',
          payload: {
            schemaVersion: 1,
            recordKind: 'resolvedMergeAttempt',
            resultDigest: preview.resultDigest,
            resolutionSetDigest: saved.value.resolutionSetDigest,
            targetRef: 'refs/heads/main',
            expectedTargetHead,
          },
        },
      });
    });
  });

  it('stores a matching sealed resolution payload through the provider graph', async () => {
    await withPersistedConflictPreview('payload-put', async ({
      provider,
      graphId,
      sourceWb,
      preview,
      expectedTargetHead,
    }) => {
      const conflict = preview.conflicts[0];
      const option = conflict.resolutionOptions.find((candidate) => candidate.kind === 'acceptTheirs');
      if (!option) throw new Error('expected acceptTheirs option');

      const put = await sourceWb.version.putMergeResolutionPayload({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead,
        value: option.value as any,
        purpose: 'chooseValue',
      });
      if (!put.ok) throw new Error(`expected payload put success: ${put.error.code}`);

      expect(put.value).toMatchObject({
        schemaVersion: 1,
        kind: 'sealedResolutionPayload',
        payloadId: expect.stringMatching(/^merge-payload:[0-9a-f]{64}$/),
        payloadDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        storageMode: 'serverEncrypted',
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        optionId: option.optionId,
        resolutionKind: option.kind,
      });
      const graph = await provider.openGraph(
        namespaceForDocumentScope(DOCUMENT_SCOPE, graphId),
        provider.accessContext,
      );
      await expect(
        graph.getObjectRecord({
          kind: 'object',
          objectType: 'workbook.reviewExtension.v1',
          digest: put.value.payloadDigest,
        }),
      ).resolves.toMatchObject({
        preimage: {
          objectType: 'workbook.reviewExtension.v1',
          payload: {
            schemaVersion: 1,
            recordKind: 'mergeResolutionPayload',
            resultId: preview.resultId,
            conflictId: conflict.conflictId,
            optionId: option.optionId,
            purpose: 'chooseValue',
          },
        },
      });
    });
  });

  it('fails closed when result id and digest do not match', async () => {
    await withPersistedConflictPreview('digest-mismatch', async ({ sourceWb, preview }) => {
      const conflict = preview.conflicts[0];
      const result = await sourceWb.version.getMergeConflictDetail({
        resultId: `merge-result:${'0'.repeat(64)}` as any,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'base',
        purpose: 'review',
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getMergeConflictDetail',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
            }),
          ],
        },
      });
    });
  });

  it('fails closed when no provider is attached', async () => {
    const digest = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;
    try {
      wb = await handle.workbook();
      const result = await wb.version.getMergeConflictDetail({
        resultId: `merge-result:${digest.digest}` as any,
        resultDigest: digest,
        redactionPolicyDigest: digest,
        conflictId: 'conflict:sha256:hidden',
        expectedConflictDigest: { algorithm: 'sha256', digest: 'b'.repeat(64) },
        valueRole: 'base',
        purpose: 'review',
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getMergeConflictDetail',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_STORE_UNAVAILABLE',
            }),
          ],
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});

async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly graphId: string;
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => Promise<void>,
): Promise<void> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, 'root'));
  expectInitializeSuccess(initialized);

  const sourceHandle = await DocumentFactory.create({
    documentId: DOCUMENT_ID,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  const branchHandle = await DocumentFactory.create({
    documentId: DOCUMENT_ID,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let sourceWb: Workbook | undefined;
  let branchWb: Workbook | undefined;

  try {
    sourceWb = await sourceHandle.workbook({ versioning: { provider } });
    await sourceWb.activeSheet.setCell('A1', 'base');
    const baseCommit = await expectCommit(
      sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      }),
    );
    const baseHead = await expectHead(sourceWb);

    const branch = await sourceWb.version.createBranch({
      name: `scenario/${graphId}` as any,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    await sourceWb.activeSheet.setCell('A1', 'ours');
    const oursCommit = await expectCommit(
      sourceWb.version.commit({
        expectedHead: {
          commitId: baseCommit.id,
          revision: requireRefRevision(baseHead),
        },
      }),
    );
    const oursHead = await expectHead(sourceWb);

    branchWb = await branchHandle.workbook({ versioning: { provider } });
    const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
    if (!checkoutBase.ok) {
      throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
    }
    await branchWb.activeSheet.setCell('A1', 'theirs');
    const theirsCommit = await expectCommit(
      branchWb.version.commit({
        targetRef: `scenario/${graphId}` as any,
        expectedHead: {
          commitId: baseCommit.id,
          revision: branch.value.revision,
        },
      }),
    );

    const expectedTargetHead = {
      commitId: oursCommit.id,
      revision: requireRefRevision(oursHead),
    };
    const preview = await sourceWb.version.merge(
      {
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      },
      {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead,
        persistReviewRecord: true,
      },
    );
    if (
      !preview.ok ||
      preview.value.status !== 'conflicted' ||
      !preview.value.resultId ||
      !preview.value.resultDigest
    ) {
      throw new Error('expected persisted conflicted preview metadata');
    }

    await run({
      provider,
      graphId,
      sourceWb,
      preview: preview.value as PersistedConflictPreview,
      expectedTargetHead,
    });
  } finally {
    if (branchWb) await branchWb.close('skipSave');
    if (sourceWb) await sourceWb.close('skipSave');
    await branchHandle.dispose();
    await sourceHandle.dispose();
  }
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${result.error.code}`);
  return result.value;
}

async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

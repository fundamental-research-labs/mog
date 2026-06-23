import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionHead,
  VersionMergeConflict,
  VersionMergeResult,
  VersionMergeResultId,
  VersionSealedResolutionPayloadRef,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import { mergeResolutionSetArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'vc07-apply-merge-sealed-payload';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type PersistedConflictPreview = Extract<VersionMergeResult, { status: 'conflicted' }> & {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly previewArtifactDigest: ObjectDigest;
};

describe('WorkbookVersion applyMerge sealed payload refs', () => {
  it('retains stable digest-bound sealed payload refs without raw values in resolution sets', async () => {
    await withPersistedConflictPreview(
      'retention-redaction',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: payload,
        };

        const applied = await sourceWb.version.applyMerge(
          {
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            previewArtifactDigest: preview.previewArtifactDigest,
            resolutions: [resolution],
          },
          { targetRef: 'refs/heads/main' as any, expectedTargetHead },
        );
        if (!applied.ok) throw new Error(`expected sealed apply success: ${applied.error.code}`);
        if (!applied.value.resolutionSetDigest) {
          throw new Error('expected sealed apply to expose a resolution set digest');
        }

        const graph = await provider.openGraph(
          namespaceForDocumentScope(documentScope, graphId),
          provider.accessContext,
        );
        const record = await graph.getObjectRecord(
          mergeResolutionSetArtifactRef(applied.value.resolutionSetDigest),
        );
        const storedResolution = (
          record.preimage.payload as { readonly resolutions: readonly Record<string, unknown>[] }
        ).resolutions[0];
        expect(storedResolution).toMatchObject({
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflict.conflictDigest,
          optionId: option.optionId,
          kind: 'acceptTheirs',
          sealedPayloadRef: payload,
        });
        expect(storedResolution).not.toHaveProperty('value');
        expect(payload.payloadId).toBe(`merge-payload:${payload.payloadDigest.digest}`);
      },
    );
  });

  it('rejects sealed payload refs with redaction digest or purpose mismatches before writes', async () => {
    let mergeCommitCallCount = 0;
    await withPersistedConflictPreview(
      'reject-mismatch',
      async ({ sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const resolution = resolutionFor(conflict, 'acceptTheirs');

        const mismatchedDigestPayload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: mutateDigest(preview.resultDigest),
          value: option.value as any,
          purpose: 'chooseValue',
        });
        await expectSealedApplyRejected({
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: { ...resolution, sealedPayloadRef: mismatchedDigestPayload },
          message: 'sealed payload object binding does not match.',
        });

        const customPurposePayload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          domainPayloadSchema: 'test.custom-resolution.v1',
          value: { kind: 'value', value: 'custom' },
          purpose: 'custom',
        });
        await expectSealedApplyRejected({
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: { ...resolution, sealedPayloadRef: customPurposePayload },
          message: 'sealed payload purpose is not executable.',
        });
      },
      {
        applyMergeService: {
          mergeCommit: async () => {
            mergeCommitCallCount += 1;
          },
        },
      },
    );
    expect(mergeCommitCallCount).toBe(0);
  });

  it('rejects sealed payload refs bound to a different target precondition before writes', async () => {
    let mergeCommitCallCount = 0;
    await withPersistedConflictPreview(
      'reject-target-binding',
      async ({ sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: option.value as any,
          purpose: 'chooseValue',
        });

        await expectSealedApplyRejected({
          sourceWb,
          preview,
          expectedTargetHead: {
            ...expectedTargetHead,
            revision: {
              ...expectedTargetHead.revision,
              value: `${expectedTargetHead.revision.value}:stale`,
            },
          },
          resolution: { ...resolutionFor(conflict, 'acceptTheirs'), sealedPayloadRef: payload },
          message: 'sealed payload object binding does not match.',
        });
      },
      {
        applyMergeService: {
          mergeCommit: async () => {
            mergeCommitCallCount += 1;
          },
        },
      },
    );
    expect(mergeCommitCallCount).toBe(0);
  });

  it('rejects sealed payload refs when a targeted save remains review-only', async () => {
    await withPersistedConflictPreview(
      'reject-review-only-sealed-ref',
      async ({ sourceWb, preview, expectedTargetHead }) => {
        expect(preview.conflicts.length).toBeGreaterThan(1);
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: option.value as any,
          purpose: 'chooseValue',
        });

        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          resolutions: [
            { ...resolutionFor(conflict, 'acceptTheirs'), sealedPayloadRef: payload },
          ],
        });
        expect(saved).toMatchObject({
          ok: false,
          error: {
            code: 'target_unavailable',
            diagnostics: [
              expect.objectContaining({
                code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
                message: 'review-only merge attempts cannot save sealed resolution payload refs.',
                data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
              }),
            ],
          },
        });
      },
      {},
      ['A1', 'B1'],
    );
  });
});

async function expectSealedApplyRejected(input: {
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly resolution: VersionApplyMergeResolution;
  readonly message: string;
}): Promise<void> {
  const result = await input.sourceWb.version.applyMerge(
    {
      resultId: input.preview.resultId,
      resultDigest: input.preview.resultDigest,
      previewArtifactDigest: input.preview.previewArtifactDigest,
      resolutions: [input.resolution],
    },
    { targetRef: 'refs/heads/main' as any, expectedTargetHead: input.expectedTargetHead },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.applyMerge',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
          message: input.message,
          data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
        }),
      ]),
    },
  });
}

async function putResolutionPayload(input: {
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly domainPayloadSchema?: string;
  readonly value: any;
  readonly purpose: 'chooseValue' | 'custom';
}): Promise<VersionSealedResolutionPayloadRef> {
  const result = await input.sourceWb.version.putMergeResolutionPayload({
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    optionId: input.option.optionId,
    kind: input.option.kind,
    ...(input.domainPayloadSchema ? { domainPayloadSchema: input.domainPayloadSchema } : {}),
    targetRef: 'refs/heads/main' as any,
    expectedTargetHead: input.expectedTargetHead,
    value: input.value,
    purpose: input.purpose,
  });
  if (!result.ok) throw new Error(`expected sealed payload put success: ${result.error.code}`);
  return result.value;
}

async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly graphId: string;
    readonly documentScope: VersionDocumentScope;
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => Promise<void>,
  versioning: Record<string, unknown> = {},
  conflictCells: readonly string[] = ['A1'],
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const sourceHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  const branchHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let sourceWb: Workbook | undefined;
  let branchWb: Workbook | undefined;

  try {
    sourceWb = await sourceHandle.workbook({
      versioning: withVersionManifest({ provider, ...versioning }),
    });
    for (const cell of conflictCells) {
      await sourceWb.activeSheet.setCell(cell, 'base');
    }
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

    for (const cell of conflictCells) {
      await sourceWb.activeSheet.setCell(cell, 'ours');
    }
    const oursCommit = await expectCommit(
      sourceWb.version.commit({
        expectedHead: {
          commitId: baseCommit.id,
          revision: requireRefRevision(baseHead),
        },
      }),
    );
    const oursHead = await expectHead(sourceWb);

    branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
    const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
    if (!checkoutBase.ok) {
      throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
    }
    for (const cell of conflictCells) {
      await branchWb.activeSheet.setCell(cell, 'theirs');
    }
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
      !preview.value.resultDigest ||
      !preview.value.previewArtifactDigest
    ) {
      throw new Error('expected persisted conflicted preview metadata');
    }
    await run({
      provider,
      graphId,
      documentScope,
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

function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = requireResolutionOption(conflict, kind);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

function requireResolutionOption(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
) {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return option;
}

function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

function mutateDigest(digest: ObjectDigest): ObjectDigest {
  const first = digest.digest[0] === '0' ? '1' : '0';
  return {
    algorithm: digest.algorithm,
    digest: `${first}${digest.digest.slice(1)}`,
  };
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

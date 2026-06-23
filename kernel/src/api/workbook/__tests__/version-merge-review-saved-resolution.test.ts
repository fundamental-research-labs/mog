import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeResultId,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { WorkbookVersionImpl } from '../version';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'w11-07-saved-resolution';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const TARGET_REF = 'refs/heads/main' as const;
const DRIFTED_TARGET_REF = 'refs/heads/review/drift' as const;
const UNSAFE_FIELD = 'xl/worksheets/sheet1.xml';
const UNSAFE_VALUE = 'sk_live_saved_resolution_secret';
const PAYLOAD_DIGEST_CANARY = { algorithm: 'sha256', digest: 'b'.repeat(64) } as const;
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion saved merge resolution validation', () => {
  it('rejects targetRef and expectedHead drift on resolved-attempt reads without leaking refs', async () => {
    await withReviewFixture('resolved-attempt-drift', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [resolutionFor(conflict, 'acceptTheirs')],
      });
      if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
        throw new Error('expected saved resolution artifact digests');
      }

      const targetRefDrift = await version.getMergeConflictDetail({
        ...resolvedDetailInput(preview, conflict, saved.value),
        targetRef: DRIFTED_TARGET_REF as any,
        expectedTargetHead: target,
      });
      const expectedHeadDrift = await version.getMergeConflictDetail({
        ...resolvedDetailInput(preview, conflict, saved.value),
        targetRef: TARGET_REF,
        expectedTargetHead: driftExpectedHead(target),
      });

      for (const result of [targetRefDrift, expectedHeadDrift]) {
        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          saved.value.resolutionSetDigest.digest,
          saved.value.resolvedAttemptDigest.digest,
          preview.resultDigest.digest,
          DRIFTED_TARGET_REF,
        ]);
      }
    });
  });

  it('rejects resolved-attempt detail reads without target proof', async () => {
    await withReviewFixture(
      'resolved-attempt-missing-target',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected saved resolution artifact digests');
        }

        const result = await version.getMergeConflictDetail(
          resolvedDetailInput(preview, conflict, saved.value),
        );

        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          saved.value.resolutionSetDigest.digest,
          saved.value.resolvedAttemptDigest.digest,
          preview.resultDigest.digest,
        ]);
      },
    );
  });

  it('rejects stale saved-resolution sealed payload refs without leaking payload bindings', async () => {
    await withReviewFixture('stale-sealed-payload-ref', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const option = requireResolutionOption(conflict, 'acceptTheirs');
      const payload = await version.putMergeResolutionPayload({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        value: option.value as any,
        purpose: 'chooseValue',
      });
      if (!payload.ok) throw new Error(`expected sealed payload: ${payload.error.code}`);

      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [
          {
            ...resolutionFor(conflict, 'acceptTheirs'),
            sealedPayloadRef: payload.value,
          },
        ],
      });
      if (!saved.ok || !saved.value.resolutionSetDigest) {
        throw new Error('expected saved sealed payload resolution set');
      }

      const result = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: saved.value.resolutionSetDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: driftExpectedHead(target),
      });

      expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
      expectNoDiagnosticLeaks(result, [
        conflict.conflictId,
        conflict.conflictDigest,
        option.optionId,
        payload.value.payloadDigest.digest,
        saved.value.resolutionSetDigest.digest,
        preview.resultDigest.digest,
      ]);
    });
  });

  it('rejects saved sealed payload refs without a replay target binding', async () => {
    await withReviewFixture(
      'sealed-payload-ref-missing-target',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        if (!payload.ok) throw new Error(`expected sealed payload: ${payload.error.code}`);

        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [
            {
              ...resolutionFor(conflict, 'acceptTheirs'),
              sealedPayloadRef: payload.value,
            },
          ],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected saved sealed payload resolution set');
        }

        const result = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: saved.value.resolutionSetDigest,
        });

        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          option.optionId,
          payload.value.payloadDigest.digest,
          saved.value.resolutionSetDigest.digest,
          preview.resultDigest.digest,
        ]);
      },
    );
  });

  it('rejects malformed persisted sealed refs with redacted invalid-artifact diagnostics', async () => {
    await withReviewFixture(
      'malformed-sealed-payload-ref',
      async ({ graph, namespace, version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const resolutionSet = await objectRecord(namespace, 'workbook.mergeResolutionSet.v1', {
          schemaVersion: 1,
          recordKind: 'mergeResolutionSet',
          resolutions: [
            {
              ...resolutionFor(conflict, 'acceptTheirs'),
              sealedPayloadRef: {
                schemaVersion: 1,
                kind: 'sealedResolutionPayload',
                payloadId: `merge-payload:${PAYLOAD_DIGEST_CANARY.digest}`,
                payloadDigest: PAYLOAD_DIGEST_CANARY,
                storageMode: 'serverEncrypted',
                resultId: preview.resultId,
                resultDigest: preview.resultDigest,
                conflictId: conflict.conflictId,
                optionId: option.optionId,
                resolutionKind: option.kind,
                [UNSAFE_FIELD]: UNSAFE_VALUE,
              },
            },
          ],
        });
        expect(await graph.putObjects([resolutionSet])).toMatchObject({ status: 'success' });

        const result = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: resolutionSet.digest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
        });

        expectMergeReviewFailure(result, 'VERSION_INVALID_COMMIT_PAYLOAD');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          option.optionId,
          PAYLOAD_DIGEST_CANARY.digest,
          resolutionSet.digest.digest,
          preview.resultDigest.digest,
          UNSAFE_FIELD,
          UNSAFE_VALUE,
        ]);
      },
    );
  });

  it('rejects saved resolution sets with unsupported stale target bindings', async () => {
    await withReviewFixture(
      'stale-resolution-set-binding',
      async ({ graph, namespace, version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const resolutionSet = await objectRecord(namespace, 'workbook.mergeResolutionSet.v1', {
          schemaVersion: 1,
          recordKind: 'mergeResolutionSet',
          targetRef: DRIFTED_TARGET_REF,
          expectedTargetHead: driftExpectedHead(target),
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        expect(await graph.putObjects([resolutionSet])).toMatchObject({ status: 'success' });

        const result = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: resolutionSet.digest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
        });

        expectMergeReviewFailure(result, 'VERSION_INVALID_COMMIT_PAYLOAD');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          resolutionSet.digest.digest,
          DRIFTED_TARGET_REF,
          preview.resultDigest.digest,
        ]);
      },
    );
  });
});

type ReviewFixture = {
  readonly graph: Awaited<
    ReturnType<ReturnType<typeof createInMemoryVersionStoreProvider>['openGraph']>
  >;
  readonly namespace: VersionGraphNamespace;
  readonly version: WorkbookVersionImpl;
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  };
  readonly target: VersionCommitExpectedHead;
};

async function withReviewFixture(
  graphId: string,
  run: (fixture: ReviewFixture) => Promise<void>,
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const conflict = conflictRecord('7');
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: initialized.rootCommit.id,
    ours: initialized.rootCommit.id,
    theirs: initialized.rootCommit.id,
    changes: [],
    conflicts: [conflict],
  });
  const graph = await provider.openGraph(namespace, provider.accessContext);
  expect(await graph.putObjects([previewRecord])).toMatchObject({ status: 'success' });

  await run({
    graph,
    namespace,
    version: new WorkbookVersionImpl({ versioning: { provider } } as any),
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      conflicts: [conflict],
    },
    target: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
    },
  });
}

function resolvedDetailInput(
  preview: ReviewFixture['preview'],
  conflict: VersionMergeConflict,
  saved: {
    readonly resolutionSetDigest: ObjectDigest;
    readonly resolvedAttemptDigest: ObjectDigest;
  },
) {
  return {
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    redactionPolicyDigest: preview.resultDigest,
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
    valueRole: 'resolved' as const,
    purpose: 'resolution' as const,
    resolutionSetDigest: saved.resolutionSetDigest,
    resolvedAttemptDigest: saved.resolvedAttemptDigest,
  };
}

function driftExpectedHead(target: VersionCommitExpectedHead): VersionCommitExpectedHead {
  return {
    ...target,
    revision: { kind: 'counter', value: '999' },
  };
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
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflict['resolutionOptions'][number] {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected ${kind} option`);
  return option;
}

function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

function expectMergeReviewFailure(value: unknown, code: string): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      target: 'workbook.version.getMergeConflictDetail',
      diagnostics: [
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation: 'getMergeConflictDetail' }),
          }),
        }),
      ],
    },
  });
}

function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

function conflictRecord(digit: string): VersionMergeConflict {
  const structural = metadata('saved-resolution-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  const base = diffValue('base');
  const ours = diffValue('ours');
  const theirs = diffValue('theirs');
  const conflictId = `conflict:w11-07:${digit}`;
  return {
    conflictId,
    conflictDigest: `sha256:${digit.repeat(64)}`,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours, digit),
      resolutionOption(conflictId, 'acceptTheirs', theirs, digit),
      resolutionOption(conflictId, 'acceptBase', base, digit),
    ],
  };
}

function resolutionOption(
  conflictId: string,
  kind: VersionMergeConflictResolutionOptionKind,
  value: VersionDiffValue,
  digit: string,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:w11-07:${kind}:${digit}`,
    conflictId,
    kind,
    value,
    recalcRequired: false,
  };
}

function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
): VersionDiffStructuralMetadata {
  return { kind: 'metadata', changeId, domain, entityId, propertyPath };
}

function diffValue(value: VersionSemanticValue): VersionDiffValue {
  return { kind: 'value', value };
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

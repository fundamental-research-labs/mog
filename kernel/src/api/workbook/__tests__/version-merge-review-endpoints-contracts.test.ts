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
import {
  mergeResultIdForPreviewDigest,
  type MergePreviewArtifactStatus,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'w8-05-merge-review-contracts';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
const TARGET_REF = 'refs/heads/main' as const;

describe('WorkbookVersion merge review endpoint contracts', () => {
  it('reads resolved conflict detail from saved resolution artifacts', async () => {
    await withReviewArtifact('saved-resolution-readback', async ({ version, preview, target }) => {
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

      const detail = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: saved.value.resolutionSetDigest,
        resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
      });

      expect(detail).toMatchObject({
        ok: true,
        value: {
          schemaVersion: 1,
          kind: 'resolutionPayload',
          valueRole: 'resolved',
          value: { kind: 'value', value: 'theirs' },
        },
      });
    });
  });

  it('rejects mismatched saved-resolution artifact digests', async () => {
    await withReviewArtifact(
      'saved-resolution-digest-mismatch',
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

        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: mutateDigest(saved.value.resolutionSetDigest),
          resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        });

        expectMergeReviewFailure(
          detail,
          'getMergeConflictDetail',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
      },
    );
  });

  it('rejects result id and digest mismatches for every review endpoint', async () => {
    await withReviewArtifact('result-id-digest-mismatch', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const option = requireResolutionOption(conflict, 'acceptTheirs');
      const mismatchedResultId = `merge-result:${'0'.repeat(64)}` as VersionMergeResultId;
      const base = {
        resultId: mismatchedResultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
      };

      const detail = await version.getMergeConflictDetail({
        ...base,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
      });
      const saved = await version.saveMergeResolutions({
        ...base,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [resolutionFor(conflict, 'acceptTheirs')],
      });
      const payload = await version.putMergeResolutionPayload({
        ...base,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        value: option.value as any,
        purpose: 'chooseValue',
      });

      for (const [result, operation] of [
        [detail, 'getMergeConflictDetail'],
        [saved, 'saveMergeResolutions'],
        [payload, 'putMergeResolutionPayload'],
      ] as const) {
        expectMergeReviewFailure(result, operation, 'VERSION_MERGE_RESOLUTION_MISMATCH');
      }
    });
  });

  it('rejects non-replayable sealed payload refs without leaking binding values', async () => {
    await withReviewArtifact('sealed-ref-contract', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const canonical = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
      });
      if (!canonical.ok) throw new Error('expected canonical conflict detail');
      const option = canonical.value.resolutionOptions.find(
        (candidate) => candidate.kind === 'acceptTheirs',
      );
      if (!option) throw new Error('expected canonical acceptTheirs option');
      const sealedPayloadRef = {
        schemaVersion: 1,
        kind: 'sealedResolutionPayload',
        payloadId: `merge-payload:${preview.resultDigest.digest}`,
        payloadDigest: preview.resultDigest,
        storageMode: 'localOnly',
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        conflictId: canonical.value.conflictId,
        optionId: option.optionId,
        resolutionKind: option.kind,
      } as const;

      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [
          {
            conflictId: canonical.value.conflictId,
            expectedConflictDigest: canonical.value.conflictDigest,
            optionId: option.optionId,
            kind: option.kind,
            sealedPayloadRef,
          },
        ],
      });

      expectMergeReviewFailure(saved, 'saveMergeResolutions', 'VERSION_MERGE_RESOLUTION_MISMATCH');
      expectNoDiagnosticLeaks(saved, [
        canonical.value.conflictId,
        canonical.value.conflictDigest,
        option.optionId,
        preview.resultDigest.digest,
      ]);
    });
  });

  it('rejects ancestry-only merge artifacts across review endpoints', async () => {
    await withReviewArtifact(
      'ancestry-artifact',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'theirs',
          purpose: 'review',
        });
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
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

        for (const [result, operation] of [
          [detail, 'getMergeConflictDetail'],
          [saved, 'saveMergeResolutions'],
          [payload, 'putMergeResolutionPayload'],
        ] as const) {
          expectMergeReviewFailure(result, operation, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        }
      },
      { status: 'fastForward' },
    );
  });

  it('redacts provider diagnostics while reading saved resolution artifacts', async () => {
    await withReviewArtifact('saved-resolution-redaction', async ({ provider, preview }) => {
      const canaries = [
        'xl/worksheets/sheet1.xml',
        'cells/A1',
        'sk_live_saved_resolution_secret',
        preview.resultDigest.digest,
      ];
      const wrappedProvider = {
        accessContext: provider.accessContext,
        readGraphRegistry: () => provider.readGraphRegistry(),
        openGraph: async (...args: Parameters<typeof provider.openGraph>) => {
          const graph = await provider.openGraph(...args);
          return {
            getObjectRecord: async (ref: any) => {
              if (ref.objectType === 'workbook.mergeResolutionSet.v1') {
                throw Object.assign(new Error(canaries.join(' ')), {
                  diagnostics: [
                    {
                      issueCode: 'VERSION_PERMISSION_DENIED',
                      safeMessage: `Cannot read ${canaries.join(' ')}`,
                    },
                  ],
                });
              }
              return graph.getObjectRecord(ref);
            },
          };
        },
      };
      const version = new WorkbookVersionImpl({ versioning: { provider: wrappedProvider } } as any);
      const conflict = preview.conflicts[0];
      const result = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: { algorithm: 'sha256', digest: '7'.repeat(64) },
      });

      expectMergeReviewFailure(result, 'getMergeConflictDetail', 'VERSION_PERMISSION_DENIED');
      expectNoDiagnosticLeaks(result, canaries);
    });
  });
});

async function withReviewArtifact(
  graphId: string,
  run: (fixture: ReviewFixture) => Promise<void>,
  options: { readonly status?: MergePreviewArtifactStatus } = {},
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const conflicts = [basicConflict()];
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: options.status ?? 'conflicted',
    base: initialized.rootCommit.id,
    ours: initialized.rootCommit.id,
    theirs: initialized.rootCommit.id,
    changes: [],
    conflicts,
  });
  const graph = await provider.openGraph(namespace, provider.accessContext);
  expect(await graph.putObjects([previewRecord])).toMatchObject({ status: 'success' });

  await run({
    provider,
    version: new WorkbookVersionImpl({ versioning: { provider } } as any),
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      conflicts,
    },
    target: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
    },
  });
}

type ReviewFixture = {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly version: WorkbookVersionImpl;
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  };
  readonly target: VersionCommitExpectedHead;
};

function basicConflict(): VersionMergeConflict {
  const structural = metadata('w8-05-cell-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  return conflictRecord('8', structural, diffValue('base'), diffValue('ours'), diffValue('theirs'));
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

function mutateDigest(digest: ObjectDigest): ObjectDigest {
  return {
    algorithm: 'sha256',
    digest: `${digest.digest === `${'f'.repeat(64)}` ? 'e' : 'f'}${digest.digest.slice(1)}`,
  };
}

function expectMergeReviewFailure(value: unknown, operation: string, code: string): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      diagnostics: [
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation }),
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

function conflictRecord(
  digit: string,
  structural: VersionDiffStructuralMetadata,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): VersionMergeConflict {
  const conflictId = `conflict:w8-05:${digit}`;
  const conflictDigest = `sha256:${digit.repeat(64)}`;
  return {
    conflictId,
    conflictDigest,
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
    optionId: `option:w8-05:${kind}:${digit}`,
    conflictId,
    kind,
    value,
    recalcRequired: true,
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

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
  InMemoryVersionDocumentProviderBackend,
  namespaceForDocumentScope,
  type VersionAccessContext,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';

const DOCUMENT_ID = 'w9-06-merge-conflict-detail-auth';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const TARGET_REF = 'refs/heads/main' as const;
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion merge conflict detail authorization', () => {
  it('rejects conflict detail requests whose expected conflict digest does not match', async () => {
    await withReviewArtifact('conflict-digest-mismatch', async ({ version, preview }) => {
      const conflict = preview.conflicts[0];
      const result = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: mutateDigest(conflictDigestObject(conflict.conflictDigest)),
        valueRole: 'theirs',
        purpose: 'review',
      });

      expectMergeReviewFailure(
        result,
        'getMergeConflictDetail',
        'VERSION_MERGE_RESOLUTION_MISMATCH',
      );
      expectNoDiagnosticLeaks(result, [
        conflict.conflictId,
        conflict.conflictDigest,
        preview.resultDigest.digest,
      ]);
    });
  });

  it('rejects sealed payload refs when purpose or redaction access policy does not match', async () => {
    await withReviewArtifact(
      'payload-purpose-access-mismatch',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const resolution = resolutionFor(conflict, 'acceptTheirs');

        const customPayload = await putResolutionPayload({
          version,
          preview,
          conflict,
          option,
          redactionPolicyDigest: preview.resultDigest,
          target,
          value: { kind: 'value', value: 'custom' },
          purpose: 'custom',
          domainPayloadSchema: 'w9-06.custom-resolution.v1',
        });
        const customSave = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [{ ...resolution, sealedPayloadRef: customPayload }],
        });
        expectMergeReviewFailure(
          customSave,
          'saveMergeResolutions',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
        expectDiagnosticMessages(customSave, [
          'sealed payload purpose is not executable.',
          'sealed payload value does not match resolution option.',
        ]);

        const chooseValuePayload = await putResolutionPayload({
          version,
          preview,
          conflict,
          option,
          redactionPolicyDigest: preview.resultDigest,
          target,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        const accessMismatchSave = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: mutateDigest(preview.resultDigest),
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [{ ...resolution, sealedPayloadRef: chooseValuePayload }],
        });
        expectMergeReviewFailure(
          accessMismatchSave,
          'saveMergeResolutions',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
        expectDiagnosticMessages(accessMismatchSave, [
          'sealed payload object binding does not match.',
        ]);
        expectNoDiagnosticLeaks(accessMismatchSave, [
          conflict.conflictId,
          conflict.conflictDigest,
          option.optionId,
          'theirs',
        ]);
      },
    );
  });

  it('reads saved-resolution conflict detail under a different authorized principal', async () => {
    await withReviewArtifact(
      'saved-resolution-different-principal',
      async ({ provider, version, preview, target }) => {
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

        const readerAccess: VersionAccessContext = { principalScope: 'principal-reader' };
        const openGraphCalls: {
          readonly namespace: VersionGraphNamespace;
          readonly accessContext: VersionAccessContext | undefined;
        }[] = [];
        const openGraph = (
          namespace: VersionGraphNamespace,
          accessContext?: VersionAccessContext,
        ) => {
          openGraphCalls.push({ namespace, accessContext });
          return provider.openGraph(namespace, accessContext);
        };
        const readerVersion = new WorkbookVersionImpl({
          versioning: {
            provider: {
              accessContext: readerAccess,
              readGraphRegistry: () => provider.readGraphRegistry(),
              openGraph,
            },
          },
        } as any);

        const detail = await readerVersion.getMergeConflictDetail({
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

        expect(openGraphCalls).toEqual([
          expect.objectContaining({ accessContext: readerAccess }),
        ]);
        expect(detail).toMatchObject({
          ok: true,
          value: {
            kind: 'resolutionPayload',
            valueRole: 'resolved',
            value: { kind: 'value', value: 'theirs' },
          },
        });
      },
      { accessContext: { principalScope: 'principal-writer' } },
    );
  });

  it('keeps redacted conflict option values redacted in detail responses', async () => {
    await withReviewArtifact(
      'redacted-option-values',
      async ({ version, preview }) => {
        const conflict = preview.conflicts[0];
        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'theirs',
          purpose: 'review',
        });
        if (!detail.ok) throw new Error(`expected redacted detail success: ${detail.error.code}`);

        expect(detail.value.value).toEqual({ kind: 'redacted', reason: 'permission-denied' });
        expect(detail.value.resolutionOptions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'acceptTheirs',
              value: { kind: 'redacted', reason: 'permission-denied' },
            }),
          ]),
        );
      },
      { conflicts: [redactedOptionConflict()] },
    );
  });

  it('denies applying review-only saved resolution artifacts without replayable resolutions', async () => {
    let mergeCommitCallCount = 0;
    await withReviewArtifact(
      'review-only-apply-denial',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected review-only saved resolution artifact');
        }
        expect(saved.value).toMatchObject({ attemptKind: 'reviewOnly' });

        const applied = await version.applyMerge(
          {
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            resolutionSetDigest: saved.value.resolutionSetDigest,
          },
          { targetRef: TARGET_REF, expectedTargetHead: target },
        );

        expect(applied).toMatchObject({
          ok: false,
          error: {
            target: 'workbook.version.applyMerge',
            diagnostics: [
              expect.objectContaining({
                code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
                message: 'applyMerge apply mode requires resolutions for conflicted previews.',
              }),
            ],
          },
        });
        expect(mergeCommitCallCount).toBe(0);
      },
      {
        versioning: {
          applyMergeService: {
            mergeCommit: async () => {
              mergeCommitCallCount += 1;
            },
          },
        },
      },
    );
  });
});

async function withReviewArtifact(
  graphId: string,
  run: (fixture: ReviewFixture) => Promise<void>,
  options: {
    readonly accessContext?: VersionAccessContext;
    readonly conflicts?: readonly VersionMergeConflict[];
    readonly versioning?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({
    documentScope,
    accessContext: options.accessContext,
    backend: new InMemoryVersionDocumentProviderBackend(),
  });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const conflicts = options.conflicts ?? [basicConflict()];
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
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
    version: new WorkbookVersionImpl({
      versioning: withVersionManifest({ provider, ...(options.versioning ?? {}) }),
    } as any),
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

async function putResolutionPayload(input: {
  readonly version: WorkbookVersionImpl;
  readonly preview: ReviewFixture['preview'];
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly redactionPolicyDigest: ObjectDigest;
  readonly target: VersionCommitExpectedHead;
  readonly value: any;
  readonly purpose: 'chooseValue' | 'custom';
  readonly domainPayloadSchema?: string;
}) {
  const result = await input.version.putMergeResolutionPayload({
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    optionId: input.option.optionId,
    kind: input.option.kind,
    targetRef: TARGET_REF,
    expectedTargetHead: input.target,
    value: input.value,
    purpose: input.purpose,
    ...(input.domainPayloadSchema ? { domainPayloadSchema: input.domainPayloadSchema } : {}),
  });
  if (!result.ok) throw new Error(`expected payload put success: ${result.error.code}`);
  return result.value;
}

function basicConflict(): VersionMergeConflict {
  const structural = metadata('w9-06-cell-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  return conflictRecord('8', structural, diffValue('base'), diffValue('ours'), diffValue('theirs'));
}

function redactedOptionConflict(): VersionMergeConflict {
  const structural = metadata('w9-06-redacted-conflict', 'sheet-1!B1', 'cells.values', ['value']);
  return conflictRecord(
    '9',
    structural,
    diffValue('base'),
    diffValue('ours'),
    { kind: 'redacted', reason: 'permission-denied' },
  );
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
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ]),
    },
  });
}

function expectDiagnosticMessages(value: unknown, messages: readonly string[]): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining(
        messages.map((message) => expect.objectContaining({ message })),
      ),
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
  const conflictId = `conflict:w9-06:${digit}`;
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
    optionId: `option:w9-06:${kind}:${digit}`,
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

import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionMergeResult,
  VersionMergeResultId,
  VersionRefName,
  VersionSealedResolutionPayloadRef,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import type {
  ObjectDigest as VersionStoreObjectDigest,
  VersionObjectType,
} from '../../../document/version-store/object-digest';
import {
  MERGE_PREVIEW_OBJECT_TYPE,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergePreviewArtifactRef,
  mergeResolutionSetArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { REVIEW_EXTENSION_OBJECT_TYPE } from '../version-merge-review-artifacts';

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
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
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
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: { ...resolution, sealedPayloadRef: mismatchedDigestPayload },
          messages: ['sealed payload object binding does not match.'],
          leakCanaries: [option.optionId, 'theirs'],
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
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: { ...resolution, sealedPayloadRef: customPurposePayload },
          messages: [
            'sealed payload purpose is not executable.',
            'sealed payload value does not match resolution option.',
          ],
          leakCanaries: [option.optionId, 'custom'],
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

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
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
          messages: ['sealed payload object binding does not match.'],
          leakCanaries: [option.optionId, 'theirs'],
        });

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          targetRef: 'scenario/stale-sealed-payload' as VersionRefName,
          expectedTargetHead,
          resolution: { ...resolutionFor(conflict, 'acceptTheirs'), sealedPayloadRef: payload },
          messages: ['sealed payload object binding does not match.'],
          leakCanaries: ['scenario/stale-sealed-payload', option.optionId, 'theirs'],
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

  it('rejects stale digests, wrong artifact refs, principal metadata, and duplicate refs before writes', async () => {
    let mergeCommitCallCount = 0;
    await withPersistedConflictPreview(
      'reject-hardened-bindings',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        expect(preview.conflicts.length).toBeGreaterThan(1);
        const firstConflict = preview.conflicts[0];
        const secondConflict = preview.conflicts[1];
        const firstOption = requireResolutionOption(firstConflict, 'acceptTheirs');
        const firstResolution = resolutionFor(firstConflict, 'acceptTheirs');
        const secondResolution = resolutionFor(secondConflict, 'acceptTheirs');
        const forgedPayloadInput = {
          provider,
          graphId,
          documentScope,
          preview,
          conflict: firstConflict,
          option: firstOption,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: firstOption.value as any,
        };
        const firstPayload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict: firstConflict,
          option: firstOption,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: firstOption.value as any,
          purpose: 'chooseValue',
        });

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            {
              ...firstResolution,
              expectedConflictDigest: `${firstConflict.conflictDigest}:stale`,
              sealedPayloadRef: firstPayload,
            },
            secondResolution,
          ],
          messages: ['resolution does not match the merge conflict.'],
          leakCanaries: [firstOption.optionId, 'theirs'],
          expectPayloadOperation: false,
        });

        const wrongPreviewDigest = await putWrongPreviewArtifact({
          provider,
          graphId,
          documentScope,
          preview,
        });
        const wrongArtifactPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          dependencyResultDigest: wrongPreviewDigest,
        });
        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            { ...firstResolution, sealedPayloadRef: wrongArtifactPayload },
            secondResolution,
          ],
          messages: ['sealed payload artifact binding does not match.'],
          leakCanaries: [wrongPreviewDigest.digest, firstOption.optionId, 'theirs'],
        });

        const principalCanary = 'principal-secret-sealed-payload';
        const principalPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          extraPayload: { principalScope: principalCanary },
        });
        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            { ...firstResolution, sealedPayloadRef: principalPayload },
            secondResolution,
          ],
          messages: ['sealed payload object is invalid.'],
          leakCanaries: [principalCanary, firstOption.optionId, 'theirs'],
        });

        const missingDigestPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          omitPayloadKeys: ['conflictDigest'],
        });
        const staleAuthority = 'workspace-stale-sealed-payload';
        const authorityPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          extraPayload: { authority: { workspaceId: staleAuthority, principalScope: null } },
        });
        for (const [payload, messages, leakCanaries] of [
          [
            missingDigestPayload,
            ['sealed payload object is invalid.'],
            [firstOption.optionId, 'theirs'],
          ],
          [
            authorityPayload,
            ['sealed payload object binding does not match.'],
            [staleAuthority, firstOption.optionId, 'theirs'],
          ],
        ] as const) {
          await expectSealedApplyRejected({
            provider,
            graphId,
            documentScope,
            sourceWb,
            preview,
            expectedTargetHead,
            resolution: [{ ...firstResolution, sealedPayloadRef: payload }, secondResolution],
            messages,
            leakCanaries,
          });
        }

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            { ...firstResolution, sealedPayloadRef: firstPayload },
            { ...secondResolution, sealedPayloadRef: firstPayload },
          ],
          messages: ['duplicate sealed payload ref supplied.'],
          leakCanaries: [firstOption.optionId, 'theirs'],
        });
      },
      {
        applyMergeService: {
          mergeCommit: async () => {
            mergeCommitCallCount += 1;
          },
        },
      },
      ['A1', 'B1'],
    );
    expect(mergeCommitCallCount).toBe(0);
  });

  it('rejects sealed payload refs when a targeted save remains review-only', async () => {
    await withPersistedConflictPreview(
      'reject-review-only-sealed-ref',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
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
        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: payload,
        };

        const reviewOnlySaved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          resolutions: [resolution],
        });
        expect(reviewOnlySaved).toMatchObject({
          ok: false,
          error: {
            code: 'target_unavailable',
            target: 'workbook.version.saveMergeResolutions',
          },
        });
        if (reviewOnlySaved.ok) throw new Error('expected review-only sealed save rejection');
        expectStableResolutionMismatchDiagnostics({
          diagnostics: reviewOnlySaved.error.diagnostics,
          operation: 'saveMergeResolutions',
          messages: ['review-only merge attempts cannot save sealed resolution payload refs.'],
          leakCanaries: [conflict.conflictId, conflict.conflictDigest, option.optionId, 'theirs'],
        });

        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          resolutions: [resolution],
        });
        expect(saved).toMatchObject({
          ok: false,
          error: {
            code: 'target_unavailable',
            target: 'workbook.version.saveMergeResolutions',
          },
        });
        if (saved.ok) throw new Error('expected sealed resolution save to be rejected');
        expectStableResolutionMismatchDiagnostics({
          diagnostics: saved.error.diagnostics,
          operation: 'saveMergeResolutions',
          messages: ['review-only merge attempts cannot save sealed resolution payload refs.'],
          leakCanaries: [conflict.conflictId, conflict.conflictDigest, option.optionId, 'theirs'],
        });

        const namespace = namespaceForDocumentScope(documentScope, graphId);
        const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(namespace, [
          resolution,
        ]);
        const graph = await provider.openGraph(namespace, provider.accessContext);
        await expect(
          graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
        ).resolves.toBe(false);
      },
      {},
      ['A1', 'B1'],
    );
  });
});

async function expectSealedApplyRejected(input: {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly resolution: VersionApplyMergeResolution | readonly VersionApplyMergeResolution[];
  readonly messages: readonly string[];
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly leakCanaries?: readonly string[];
  readonly expectPayloadOperation?: boolean;
}): Promise<void> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const targetRef = input.targetRef ?? ('refs/heads/main' as VersionMainRefName);
  const resolutions = Array.isArray(input.resolution) ? input.resolution : [input.resolution];
  const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(
    namespace,
    resolutions,
  );
  const expectedResolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
    resultDigest: internalSha256Digest(input.preview.resultDigest),
    resolutionSetDigest: expectedResolutionSet.digest,
    targetRef,
    expectedTargetHead: input.expectedTargetHead,
  });

  const result = await input.sourceWb.version.applyMerge(
    {
      resultId: input.preview.resultId,
      resultDigest: input.preview.resultDigest,
      previewArtifactDigest: input.preview.previewArtifactDigest,
      resolutions,
    },
    { targetRef, expectedTargetHead: input.expectedTargetHead },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.applyMerge',
    },
  });
  if (result.ok) throw new Error('expected sealed apply to be rejected');
  expectStableResolutionMismatchDiagnostics({
    diagnostics: result.error.diagnostics,
    operation: 'applyMerge',
    messages: input.messages,
    expectPayloadOperation: input.expectPayloadOperation,
    leakCanaries: diagnosticLeakCanaries({
      preview: input.preview,
      resolutions,
      targetRef,
      expectedTargetHead: input.expectedTargetHead,
      extra: input.leakCanaries ?? [],
    }),
  });

  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  await expect(
    graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
  ).resolves.toBe(false);
  await expect(
    graph.hasObject(resolvedMergeAttemptArtifactRef(expectedResolvedAttempt.digest)),
  ).resolves.toBe(false);
}

function expectStableResolutionMismatchDiagnostics(input: {
  readonly diagnostics: readonly unknown[];
  readonly operation: 'applyMerge' | 'saveMergeResolutions';
  readonly messages: readonly string[];
  readonly leakCanaries?: readonly string[];
  readonly expectPayloadOperation?: boolean;
}): void {
  expect(input.diagnostics).toStrictEqual(
    input.messages.map((message) => ({
      code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
      severity: 'error',
      message,
      owner: 'version-store',
      data: {
        ...(input.expectPayloadOperation === false ? {} : { operation: input.operation }),
        recoverability: 'none',
        messageTemplateId: `version.${input.operation}.VERSION_MERGE_RESOLUTION_MISMATCH`,
        redacted: true,
        ...(input.expectPayloadOperation === false
          ? {}
          : { payload: { operation: input.operation } }),
        mutationGuarantee: 'no-write-attempted',
      },
    })),
  );
  expectNoDiagnosticLeaks(input.diagnostics, input.leakCanaries ?? []);
}

function diagnosticLeakCanaries(input: {
  readonly preview: PersistedConflictPreview;
  readonly resolutions: readonly VersionApplyMergeResolution[];
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly extra: readonly string[];
}): readonly string[] {
  return compactStrings([
    input.preview.resultId,
    input.preview.resultDigest.digest,
    ...input.resolutions.flatMap((resolution) => [
      resolution.conflictId,
      resolution.expectedConflictDigest,
      resolution.optionId,
      resolution.sealedPayloadRef?.payloadId,
      resolution.sealedPayloadRef?.payloadDigest.digest,
    ]),
    input.targetRef,
    input.expectedTargetHead.commitId,
    input.expectedTargetHead.revision.value,
    ...input.extra,
  ]);
}

function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

async function putResolutionPayload(input: {
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
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
    targetRef: input.targetRef ?? ('refs/heads/main' as VersionMainRefName),
    expectedTargetHead: input.expectedTargetHead,
    value: input.value,
    purpose: input.purpose,
  });
  if (!result.ok) throw new Error(`expected sealed payload put success: ${result.error.code}`);
  return result.value;
}

async function putWrongPreviewArtifact(input: {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly preview: PersistedConflictPreview;
}): Promise<ObjectDigest> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  const record = await objectRecord(namespace, MERGE_PREVIEW_OBJECT_TYPE, {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: input.preview.base,
    ours: input.preview.ours,
    theirs: input.preview.theirs,
    changes: [],
    conflicts: input.preview.conflicts,
  });
  const persisted = await graph.putObjects([record]);
  expect(persisted).toMatchObject({ status: 'success' });
  return record.digest;
}

async function putForgedResolutionPayload(input: {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly dependencyResultDigest?: ObjectDigest;
  readonly value: any;
  readonly omitPayloadKeys?: readonly string[];
  readonly extraPayload?: Readonly<Record<string, unknown>>;
}): Promise<VersionSealedResolutionPayloadRef> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  const dependencyDigest = internalSha256Digest(
    input.dependencyResultDigest ?? input.preview.resultDigest,
  );
  const payload = {
    schemaVersion: 1,
    recordKind: 'mergeResolutionPayload',
    attemptId: input.preview.resultId,
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    previewArtifactDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    conflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    expectedConflictDigest: input.conflict.conflictDigest,
    optionId: input.option.optionId,
    kind: input.option.kind,
    targetRef: 'refs/heads/main' as VersionMainRefName,
    expectedTargetHead: input.expectedTargetHead,
    authority: payloadAuthorityForNamespace(namespace),
    purpose: 'chooseValue',
    value: input.value,
    ...(input.extraPayload ?? {}),
  };
  for (const key of input.omitPayloadKeys ?? []) delete (payload as Record<string, unknown>)[key];
  const record = await createVersionObjectRecord(namespace, {
    objectType: REVIEW_EXTENSION_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [mergePreviewArtifactRef(dependencyDigest)],
    payload,
  });
  const persisted = await graph.putObjects([record]);
  expect(persisted).toMatchObject({ status: 'success' });
  return {
    schemaVersion: 1,
    kind: 'sealedResolutionPayload',
    payloadId: `merge-payload:${record.digest.digest}` as `merge-payload:${string}`,
    payloadDigest: record.digest,
    storageMode: 'serverEncrypted',
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    conflictId: input.conflict.conflictId,
    optionId: input.option.optionId,
    resolutionKind: input.option.kind,
  };
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
    installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
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
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
    if (!checkoutBase.ok) {
      throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
    }
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
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

function payloadAuthorityForNamespace(namespace: VersionGraphNamespace) {
  return {
    workspaceId: namespace.workspaceId ?? null,
    principalScope: namespace.principalScope ?? null,
  };
}

function internalSha256Digest(digest: ObjectDigest): VersionStoreObjectDigest {
  if (digest.algorithm !== 'sha256') {
    throw new Error(`expected sha256 object digest: ${digest.algorithm}`);
  }
  return { algorithm: 'sha256', digest: digest.digest };
}

function mutateDigest(digest: ObjectDigest): ObjectDigest {
  const first = digest.digest[0] === '0' ? '1' : '0';
  return {
    algorithm: digest.algorithm,
    digest: `${first}${digest.digest.slice(1)}`,
  };
}

function compactStrings(values: readonly unknown[]): readonly string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(
      `expected commit success: ${result.error.code}: ${JSON.stringify(result.error)}`,
    );
  }
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
  return {
    workspaceId: `workspace-${graphId}`,
    documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}`,
    principalScope: 'principal-user-1',
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

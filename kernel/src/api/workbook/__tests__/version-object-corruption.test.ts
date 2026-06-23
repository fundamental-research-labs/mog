import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeResultId,
  VersionSemanticValue,
  WorkbookCommitId,
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
  mergeResolutionSetArtifactRef,
  mergeResultIdForPreviewDigest,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'version-object-corruption';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
const RAW_OBJECT_PREIMAGE_CANARY = 'raw-object-preimage-secret';
const RAW_OBJECT_PREIMAGE_PATH = 'storedRecord.preimage.payload';
const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;

describe('WorkbookVersion version object corruption public boundaries', () => {
  it('maps corrupt persisted preview artifacts read by review endpoints to repair diagnostics', async () => {
    await withPersistedConflictPreview('review-corrupt-preview', async (fixture) => {
      corruptStoredRecord(fixture.graph, fixture.previewRecord);
      await expect(
        fixture.graph.getObjectRecord({
          kind: 'object',
          objectType: 'workbook.mergePreview.v1',
          digest: fixture.preview.resultDigest,
        }),
      ).rejects.toMatchObject({ diagnostic: { code: 'VERSION_OBJECT_CORRUPTION' } });

      const result = await fixture.version.getMergeConflictDetail(
        conflictDetailInput(fixture, { valueRole: 'theirs' }),
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.getMergeConflictDetail',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });

  it('maps corrupt persisted preview artifacts read by apply replay to repair diagnostics', async () => {
    await withPersistedConflictPreview('apply-corrupt-preview', async (fixture) => {
      corruptStoredRecord(fixture.graph, fixture.previewRecord);

      const result = await fixture.version.applyMerge(
        {
          resultId: fixture.preview.resultId,
          resultDigest: fixture.preview.resultDigest,
        },
        { mode: 'preview' },
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.applyMerge',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });

  it('maps corrupt saved resolution-set artifacts read by review endpoints to repair diagnostics', async () => {
    await withPersistedConflictPreview('review-corrupt-resolution-set', async (fixture) => {
      const saved = await saveResolution(fixture);
      const resolutionRecord = await fixture.graph.getObjectRecord(
        mergeResolutionSetArtifactRef(saved.resolutionSetDigest),
      );
      corruptStoredRecord(fixture.graph, resolutionRecord);

      const result = await fixture.version.getMergeConflictDetail(
        conflictDetailInput(fixture, {
          valueRole: 'theirs',
          resolutionSetDigest: saved.resolutionSetDigest,
        }),
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.getMergeConflictDetail',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });

  it('maps corrupt resolved-attempt artifacts read by review endpoints to repair diagnostics', async () => {
    await withPersistedConflictPreview('review-corrupt-resolved-attempt', async (fixture) => {
      const saved = await saveResolution(fixture);
      if (!saved.resolvedAttemptDigest) throw new Error('expected resolved attempt digest');
      const attemptRecord = await fixture.graph.getObjectRecord(
        resolvedMergeAttemptArtifactRef(saved.resolvedAttemptDigest),
      );
      corruptStoredRecord(fixture.graph, attemptRecord);

      const result = await fixture.version.getMergeConflictDetail(
        conflictDetailInput(fixture, {
          valueRole: 'theirs',
          resolvedAttemptDigest: saved.resolvedAttemptDigest,
        }),
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.getMergeConflictDetail',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });

  it('preserves repair recoverability and redacts corrupt object details on the diff surface', async () => {
    const version = new WorkbookVersionImpl({
      versioning: {
        diffService: {
          diff: async () => ({
            status: 'degraded',
            diagnostics: [
              {
                code: 'VERSION_OBJECT_CORRUPTION',
                severity: 'corruption',
                recoverability: 'retry',
                safeMessage: `Do not expose ${RAW_OBJECT_PREIMAGE_CANARY}`,
                details: {
                  path: RAW_OBJECT_PREIMAGE_PATH,
                  source: RAW_OBJECT_PREIMAGE_CANARY,
                },
              },
            ],
          }),
        },
      },
    } as any);

    const result = await version.diff(COMMIT_A, COMMIT_B);

    expectRepairDiagnostic(result, {
      target: 'workbook.version.diff',
      code: 'VERSION_OBJECT_CORRUPTION',
    });
    expectNoLeaks(result);
  });

  it('redacts raw object preimage text on the disabled revert surface', async () => {
    const version = new WorkbookVersionImpl({} as any);

    const result = await version.revert(
      {
        target: { kind: 'commit', commitId: COMMIT_A },
        preflight: {
          gaps: [
            {
              gapId: 'gap-1',
              reason: `${RAW_OBJECT_PREIMAGE_PATH}:${RAW_OBJECT_PREIMAGE_CANARY}`,
            },
          ],
        },
      },
      { includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_REVERT_HISTORY_GAP',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({ reason: 'redacted' }),
            }),
          }),
        ]),
      },
    });
    expectNoLeaks(result);
  });
});

type Fixture = {
  readonly graph: Awaited<
    ReturnType<ReturnType<typeof createInMemoryVersionStoreProvider>['openGraph']>
  >;
  readonly version: WorkbookVersionImpl;
  readonly previewRecord: VersionObjectRecord<unknown>;
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
  };
  readonly conflict: VersionMergeConflict;
  readonly expectedTargetHead: VersionCommitExpectedHead;
};

async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const graph = await provider.openGraph(namespace, provider.accessContext);
  const conflict = conflictRecord('1');
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
  expect(await graph.putObjects([previewRecord])).toMatchObject({ status: 'success' });

  await run({
    graph,
    version: new WorkbookVersionImpl({ versioning: { provider } } as any),
    previewRecord,
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
    },
    conflict,
    expectedTargetHead: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
    },
  });
}

function conflictDetailInput(
  fixture: Fixture,
  options: {
    readonly valueRole: 'base' | 'ours' | 'theirs';
    readonly resolutionSetDigest?: ObjectDigest;
    readonly resolvedAttemptDigest?: ObjectDigest;
  },
) {
  return {
    resultId: fixture.preview.resultId,
    resultDigest: fixture.preview.resultDigest,
    redactionPolicyDigest: fixture.preview.resultDigest,
    conflictId: fixture.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(fixture.conflict.conflictDigest),
    valueRole: options.valueRole,
    purpose: 'review',
    ...(options.resolutionSetDigest ? { resolutionSetDigest: options.resolutionSetDigest } : {}),
    ...(options.resolvedAttemptDigest
      ? { resolvedAttemptDigest: options.resolvedAttemptDigest }
      : {}),
  } as const;
}

async function saveResolution(fixture: Fixture): Promise<{
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
}> {
  const saved = await fixture.version.saveMergeResolutions({
    resultId: fixture.preview.resultId,
    resultDigest: fixture.preview.resultDigest,
    redactionPolicyDigest: fixture.preview.resultDigest,
    targetRef: 'refs/heads/main' as any,
    expectedTargetHead: fixture.expectedTargetHead,
    resolutions: [resolutionFor(fixture.conflict, 'acceptTheirs')],
  });
  if (!saved.ok || !saved.value.resolutionSetDigest) {
    throw new Error(`expected saved resolution artifacts: ${JSON.stringify(saved)}`);
  }
  return {
    resolutionSetDigest: saved.value.resolutionSetDigest,
    ...(saved.value.resolvedAttemptDigest
      ? { resolvedAttemptDigest: saved.value.resolvedAttemptDigest }
      : {}),
  };
}

function corruptStoredRecord(graph: Fixture['graph'], record: VersionObjectRecord<unknown>): void {
  graph.objectStore.putCorruptRecordForTesting(record.digest, {
    ...record,
    preimage: {
      ...record.preimage,
      payload: {
        rawObjectPreimage: RAW_OBJECT_PREIMAGE_CANARY,
        path: RAW_OBJECT_PREIMAGE_PATH,
      },
    },
  });
}

function expectRepairDiagnostic(
  result: unknown,
  expected: { readonly target: string; readonly code: string },
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: expected.target,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: expected.code,
          severity: 'error',
          data: expect.objectContaining({
            recoverability: 'repair',
            redacted: true,
          }),
        }),
      ]),
    },
  });
}

function expectNoLeaks(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_OBJECT_PREIMAGE_CANARY);
  expect(serialized).not.toContain(RAW_OBJECT_PREIMAGE_PATH);
  expect(serialized).not.toContain('rawObjectPreimage');
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

function conflictRecord(digit: string): VersionMergeConflict {
  const structural = metadata('object-corruption-conflict', 'sheet-1!A1', 'cell', ['value']);
  const base = diffValue('base');
  const ours = diffValue('ours');
  const theirs = diffValue('theirs');
  const conflictId = `conflict:object-corruption:${digit}`;
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
  kind: VersionMergeConflict['resolutionOptions'][number]['kind'],
  value: VersionDiffValue,
  digit: string,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:object-corruption:${kind}:${digit}`,
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

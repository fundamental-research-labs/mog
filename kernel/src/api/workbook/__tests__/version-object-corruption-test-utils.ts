import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
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

const DOCUMENT_ID = 'version-object-corruption';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const RAW_OBJECT_PREIMAGE_CANARY = 'raw-object-preimage-secret';
export const RAW_OBJECT_PREIMAGE_PATH = 'storedRecord.preimage.payload';

export type ObjectCorruptionFixture = {
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

export async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: ObjectCorruptionFixture) => Promise<void>,
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

export function conflictDetailInput(
  fixture: ObjectCorruptionFixture,
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
      ? {
          resolvedAttemptDigest: options.resolvedAttemptDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: fixture.expectedTargetHead,
        }
      : {}),
  } as const;
}

export async function saveResolution(fixture: ObjectCorruptionFixture): Promise<{
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

export function corruptStoredRecord(
  graph: ObjectCorruptionFixture['graph'],
  record: VersionObjectRecord<unknown>,
): void {
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

export function expectRepairDiagnostic(
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

export function expectNoLeaks(value: unknown): void {
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

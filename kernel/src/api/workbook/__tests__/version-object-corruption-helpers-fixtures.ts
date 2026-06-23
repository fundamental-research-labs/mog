import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import type { VersionObjectRecord } from '../../../document/version-store/object-store';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import {
  AUTHOR,
  CREATED_AT,
  DOCUMENT_ID,
  DOCUMENT_RUN_ID,
} from './version-object-corruption-helpers-constants';
import {
  conflictDigestObject,
  conflictRecord,
  resolutionFor,
} from './version-object-corruption-helpers-conflicts';
import { objectRecord } from './version-object-corruption-helpers-objects';

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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

import type { VersionMergeChange, VersionRecordRevision } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import {
  createWorkbookVersionCommitService,
  type VersionMergeCommitCapture,
  type VersionNormalCommitCapture,
  type VersionNormalCommitCaptureFinalizeResult,
  type WorkbookVersionCommitServiceCommitResult,
} from '../commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from '../provider';

export const CREATED_AT = '2026-06-20T00:00:00.000Z';
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export async function setupMergeInputs() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const branchService = createProviderBackedBranchLifecycleService({ provider });
  const branch = await branchService.createBranch({
    name: 'scenario/incoming',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: VERSION_AUTHOR,
  });
  expect(branch.ok).toBe(true);
  if (!branch.ok)
    throw new Error(`expected incoming branch create success: ${branch.diagnostics[0]?.code}`);

  const oursService = createWorkbookVersionCommitService({
    provider,
    captureNormalCommit: createNormalCommitCapture('ours'),
  });
  const ours = await oursService.commit({
    expectedHead: {
      commitId: initialized.rootCommit.id as any,
      revision: initialized.initialHead.revision,
    },
  });
  expectCommitSuccess(ours);

  const theirsService = createWorkbookVersionCommitService({
    provider,
    captureNormalCommit: createNormalCommitCapture('theirs'),
  });
  const theirs = await theirsService.commit({
    targetRef: 'refs/heads/scenario/incoming' as any,
    expectedHead: {
      commitId: initialized.rootCommit.id as any,
      revision: branch.branch.ref.refVersion,
    },
  });
  expectCommitSuccess(theirs);

  return { provider, initialized, ours, theirs };
}

export async function objectRecord(
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

export async function initializeInput(
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
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

export function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentRef.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentRef.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}

export function createThrowingNormalCommitCapture(
  forbiddenPayload: string,
): VersionNormalCommitCapture {
  return async () => {
    throw new Error(forbiddenPayload);
  };
}

export function createNormalCommitCaptureWithInvalidSemanticRecord(
  label: string,
  finalize: (result: VersionNormalCommitCaptureFinalizeResult) => void,
  forbiddenPayload: string,
): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentRef.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        forbiddenPayload,
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentRef.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
    finalize,
  });
}

export function createNormalCommitCaptureWithoutMutationSegments(
  label: string,
  finalize: (result: VersionNormalCommitCaptureFinalizeResult) => void,
  forbiddenPayload: string,
): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentRef.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        forbiddenPayload,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
    finalize,
  });
}

export function createNormalCommitCaptureWithoutSnapshotRoot(
  label: string,
  finalize: (result: VersionNormalCommitCaptureFinalizeResult) => void,
): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => ({
    status: 'success',
    input: {
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentRef.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
    finalize,
  });
}

export function createMergeCommitCapture(label: string): VersionMergeCommitCapture {
  return async ({ namespace, currentRef, base, ours, theirs, changes, resolutionCount }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        base,
        ours,
        theirs,
        target: currentRef.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes,
        resolutionCount,
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: base,
          oursCommitId: ours,
          theirsCommitId: theirs,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}

export function mergeChange(changeId: string): VersionMergeChange {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells.values',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
    },
    base: { kind: 'value', value: 'base' },
    ours: { kind: 'value', value: 'ours' },
    theirs: { kind: 'value', value: 'theirs' },
    merged: { kind: 'value', value: 'theirs' },
  };
}

export function expectRefRevision(
  result: Extract<WorkbookVersionCommitServiceCommitResult, { status: 'success' }>,
): VersionRecordRevision {
  if (!result.commitRef.refRevision) {
    throw new Error('expected commit ref revision');
  }
  return result.commitRef.refRevision;
}

export function expectCommitSuccess(
  result: WorkbookVersionCommitServiceCommitResult,
): asserts result is Extract<WorkbookVersionCommitServiceCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function expectMainRefUnchanged(
  provider: VersionStoreProvider,
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>,
): Promise<void> {
  await expectMainRefMatches(provider, initialized.rootCommit.id, initialized.initialHead.revision);
}

export async function expectMainRefMatches(
  provider: VersionStoreProvider,
  commitId: WorkbookCommitId,
  revision: VersionRecordRevision,
): Promise<void> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
  await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
    status: 'success',
    ref: {
      name: VERSION_GRAPH_MAIN_REF,
      commitId,
      revision,
    },
  });
}

export function expectFailedFinalize(
  finalize: { mock: { calls: readonly (readonly unknown[])[] } },
  diagnostics: readonly VersionStoreDiagnostic[],
): void {
  expect(finalize.mock.calls).toHaveLength(1);
  expect(finalize.mock.calls[0]?.[0]).toEqual({
    status: 'failed',
    diagnostics,
  } satisfies VersionNormalCommitCaptureFinalizeResult);
}

export function expectPublicSafeDiagnostics(
  diagnostics: readonly VersionStoreDiagnostic[],
  forbiddenPayload: string,
): void {
  expect(JSON.stringify(diagnostics)).not.toContain(forbiddenPayload);
  expect(JSON.stringify(diagnostics)).not.toContain('Error:');
  for (const diagnostic of diagnostics) {
    expect(diagnostic).toMatchObject({
      redacted: true,
      message: diagnostic.safeMessage,
    });
  }
}

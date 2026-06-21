import { jest } from '@jest/globals';
import type { VersionMergeChange, VersionRecordRevision } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createWorkbookVersionCommitService,
  type VersionMergeCommitCapture,
  type VersionNormalCommitCapture,
  type WorkbookVersionCommitServiceCommitResult,
} from '../commit-service';
import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph-store';
import type { VersionObjectType } from '../object-digest';
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
} from '../provider';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersionCommitService', () => {
  it('normalizes direct branch-name targetRef commits to concrete provider refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const branchService = createProviderBackedBranchLifecycleService({ provider });
    const branch = await branchService.createBranch({
      name: 'scenario/direct-service',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: VERSION_AUTHOR,
    });
    expect(branch).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/direct-service',
        ref: {
          targetCommitId: initialized.rootCommit.id,
          refVersion: { kind: 'counter', value: '0' },
        },
      },
    });
    const captureNormalCommit = jest.fn(createNormalCommitCapture('branch-child'));
    const service = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit,
    });

    const committed = await service.commit({
      targetRef: 'scenario/direct-service' as any,
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    expect(captureNormalCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRef: expect.objectContaining({
          name: 'refs/heads/scenario/direct-service',
          commitId: initialized.rootCommit.id,
        }),
        options: expect.objectContaining({
          targetRef: 'refs/heads/scenario/direct-service',
        }),
      }),
    );
    expect(committed).toMatchObject({
      status: 'success',
      commitRef: {
        refName: 'refs/heads/scenario/direct-service',
        resolvedFrom: 'refs/heads/scenario/direct-service',
        refRevision: { kind: 'counter', value: '1' },
      },
      main: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
    if (committed.status !== 'success') {
      throw new Error(`expected branch commit success: ${committed.diagnostics[0]?.code}`);
    }

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readRef('refs/heads/scenario/direct-service')).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/direct-service',
        commitId: committed.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });
    await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: VERSION_GRAPH_MAIN_REF,
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
  });

  it('creates two-parent merge commits through the production commit service', async () => {
    const { provider, initialized, ours, theirs } = await setupMergeInputs();
    const captureMergeCommit = jest.fn(createMergeCommitCapture('merge-clean'));
    const service = createWorkbookVersionCommitService({
      provider,
      captureMergeCommit,
    });
    const change = mergeChange('merge-change-1');

    const merged = await service.mergeCommit({
      base: initialized.rootCommit.id,
      ours: ours.commit.id,
      theirs: theirs.commit.id,
      targetRef: VERSION_GRAPH_MAIN_REF as any,
      expectedTargetHead: {
        commitId: ours.commit.id as any,
        revision: expectRefRevision(ours),
      },
      changes: [change],
      resolutionCount: 0,
    });

    expectCommitSuccess(merged);
    expect(captureMergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRef: expect.objectContaining({
          name: VERSION_GRAPH_MAIN_REF,
          commitId: ours.commit.id,
        }),
        base: initialized.rootCommit.id,
        ours: ours.commit.id,
        theirs: theirs.commit.id,
        targetRef: VERSION_GRAPH_MAIN_REF,
        changes: [change],
        resolutionCount: 0,
      }),
    );
    expect(merged.commit.payload.parentCommitIds).toEqual([ours.commit.id, theirs.commit.id]);
    expect(merged.commitRef).toEqual({
      id: merged.commit.id,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_MAIN_REF,
      refRevision: { kind: 'counter', value: '2' },
    });

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: VERSION_GRAPH_MAIN_REF,
        commitId: merged.commit.id,
        revision: { kind: 'counter', value: '2' },
      },
    });
    await expect(graph.readRef('refs/heads/scenario/incoming')).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/incoming',
        commitId: theirs.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });
  });

  it('blocks merge commits when target head fencing is stale before capture runs', async () => {
    const { provider, initialized, ours, theirs } = await setupMergeInputs();
    const captureMergeCommit = jest.fn(createMergeCommitCapture('stale'));
    const service = createWorkbookVersionCommitService({
      provider,
      captureMergeCommit,
    });

    const stale = await service.mergeCommit({
      base: initialized.rootCommit.id,
      ours: initialized.rootCommit.id,
      theirs: theirs.commit.id,
      targetRef: VERSION_GRAPH_MAIN_REF as any,
      expectedTargetHead: {
        commitId: initialized.rootCommit.id as any,
        revision: initialized.initialHead.revision,
      },
      changes: [mergeChange('merge-stale')],
      resolutionCount: 0,
    });

    expect(stale).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_REF_CONFLICT' })],
    });
    expect(captureMergeCommit).not.toHaveBeenCalled();

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: VERSION_GRAPH_MAIN_REF,
        commitId: ours.commit.id,
        revision: expectRefRevision(ours),
      },
    });
  });

  it('fails closed without a production merge materialization service', async () => {
    const { provider, initialized, ours, theirs } = await setupMergeInputs();
    const service = createWorkbookVersionCommitService({ provider });

    const failed = await service.mergeCommit({
      base: initialized.rootCommit.id,
      ours: ours.commit.id,
      theirs: theirs.commit.id,
      targetRef: VERSION_GRAPH_MAIN_REF as any,
      expectedTargetHead: {
        commitId: ours.commit.id as any,
        revision: expectRefRevision(ours),
      },
      changes: [mergeChange('missing-capture')],
      resolutionCount: 0,
    });

    expect(failed).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
    });
  });

  it('fast-forwards merge apply by advancing the target ref to an existing descendant', async () => {
    const { provider, initialized, ours } = await setupMergeInputs();
    const branchService = createProviderBackedBranchLifecycleService({ provider });
    const branch = await branchService.createBranch({
      name: 'scenario/fast-forward',
      targetCommitId: ours.commit.id,
      expectedAbsent: true,
      createdBy: VERSION_AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.diagnostics[0]?.code}`);

    const theirsService = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit: createNormalCommitCapture('fast-forward-theirs'),
    });
    const theirs = await theirsService.commit({
      targetRef: 'refs/heads/scenario/fast-forward' as any,
      expectedHead: {
        commitId: ours.commit.id as any,
        revision: branch.branch.ref.refVersion,
      },
    });
    expectCommitSuccess(theirs);

    const service = createWorkbookVersionCommitService({ provider });
    const fastForward = await service.fastForwardMerge({
      base: initialized.rootCommit.id,
      ours: ours.commit.id,
      theirs: theirs.commit.id,
      targetRef: VERSION_GRAPH_MAIN_REF as any,
      expectedTargetHead: {
        commitId: ours.commit.id as any,
        revision: expectRefRevision(ours),
      },
    });

    expect(fastForward).toMatchObject({
      status: 'success',
      commit: { id: theirs.commit.id },
      commitRef: {
        id: theirs.commit.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: VERSION_GRAPH_MAIN_REF,
        refRevision: { kind: 'counter', value: '2' },
      },
      mutationGuarantee: 'ref-fast-forwarded',
    });

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: theirs.commit.id,
        revision: { kind: 'counter', value: '2' },
      },
    });
  });
});

async function setupMergeInputs() {
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
  if (!branch.ok) throw new Error(`expected incoming branch create success: ${branch.diagnostics[0]?.code}`);

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
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
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

function createMergeCommitCapture(label: string): VersionMergeCommitCapture {
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

function mergeChange(changeId: string): VersionMergeChange {
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

function expectRefRevision(
  result: Extract<WorkbookVersionCommitServiceCommitResult, { status: 'success' }>,
): VersionRecordRevision {
  if (!result.commitRef.refRevision) {
    throw new Error('expected commit ref revision');
  }
  return result.commitRef.refRevision;
}

function expectCommitSuccess(
  result: WorkbookVersionCommitServiceCommitResult,
): asserts result is Extract<WorkbookVersionCommitServiceCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit success: ${result.diagnostics[0]?.code}`);
  }
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

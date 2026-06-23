import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommit } from '../commit-store';
import {
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { RefVersion } from '../ref-store';
import {
  createInMemoryVersionGraphStore,
  type CommitVersionGraphInput,
  type InitializeVersionGraphInput,
  type VersionGraphCommitPageResult,
  type VersionGraphWriteResult,
} from '../graph-store';
import { orderTopologicalNewestFirst } from '../graph-store-traversal';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

function expectListSuccess(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected listCommits success: ${result.diagnostics[0]?.code}`);
  }
}

function expectListFailed(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected listCommits failure');
  }
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(NAMESPACE, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

async function graphInput(label: string): Promise<InitializeVersionGraphInput> {
  const snapshotRootRecord = await objectRecord('workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord('workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });

  return {
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

function commitInput(
  input: InitializeVersionGraphInput,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
  };
}

describe('InMemoryVersionGraphStore listCommits completeness projection', () => {
  it('keeps complete list reads diagnostic-clean', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const child = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(child);

    const page = await graph.listCommits();

    expectListSuccess(page);
    expect(page.diagnostics).toEqual([]);
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      child.commit.id,
      initialized.commit.id,
    ]);
  });

  it('marks stale list cursors as access-filtered graph metadata incompleteness', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    const page = await graph.listCommits({ pageToken: 'vpt_pending_token_1234' });

    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_STALE_PAGE_CURSOR',
        operation: 'listCommits',
        option: 'pageToken',
        details: expect.objectContaining({
          completenessMarker: 'diagnostic-read',
          completenessScope: 'graph-metadata',
          completenessCondition: 'stale',
          accessFiltered: true,
          cursorCategory: 'unsupportedCursor',
          pageTokenUnsupported: true,
        }),
      }),
    ]);
  });

  it('marks missing traversal parents as access-filtered history gaps', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const missingParentId = commit('ab');
    const gapCommit: WorkbookCommit = {
      ...initialized.commit,
      payload: {
        ...initialized.commit.payload,
        parentCommitIds: [missingParentId],
      },
    };

    const ordered = orderTopologicalNewestFirst(
      gapCommit.id,
      new Map([[gapCommit.id, gapCommit]]),
      'listCommits',
    );

    expect(ordered.commits).toEqual([]);
    expect(ordered.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_MISSING_PARENT',
        severity: 'corruption',
        operation: 'listCommits',
        commitId: missingParentId,
        details: expect.objectContaining({
          completenessMarker: 'diagnostic-read',
          completenessScope: 'graph-metadata',
          completenessCondition: 'history-gap',
          accessFiltered: true,
          missingCommitRole: 'parent',
          childCommitId: gapCommit.id,
        }),
      }),
    ]);
  });

  it('marks cyclic traversal as access-filtered corrupt graph metadata', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const child = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(child);
    const cyclicRoot: WorkbookCommit = {
      ...initialized.commit,
      payload: {
        ...initialized.commit.payload,
        parentCommitIds: [child.commit.id],
      },
    };
    const cyclicChild: WorkbookCommit = {
      ...child.commit,
      payload: {
        ...child.commit.payload,
        parentCommitIds: [initialized.commit.id],
      },
    };

    const ordered = orderTopologicalNewestFirst(
      cyclicRoot.id,
      new Map([
        [cyclicRoot.id, cyclicRoot],
        [cyclicChild.id, cyclicChild],
      ]),
      'listCommits',
    );

    expect(ordered.commits).toEqual([]);
    expect(ordered.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
        severity: 'corruption',
        operation: 'listCommits',
        commitId: cyclicRoot.id,
        details: expect.objectContaining({
          completenessMarker: 'diagnostic-read',
          completenessScope: 'graph-metadata',
          completenessCondition: 'corrupt',
          accessFiltered: true,
          corruptTraversalCondition: 'parentCycle',
          childCommitId: cyclicChild.id,
        }),
      }),
    ]);
  });
});

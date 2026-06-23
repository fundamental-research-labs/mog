import type { WorkbookCommit } from '../commit-store';
import {
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
} from '../graph-store';
import { orderTopologicalNewestFirst } from '../graph-store-traversal';
import {
  AUTHOR,
  NAMESPACE,
  commit,
  commitInput,
  expectGraphSuccess,
  expectListFailed,
  expectListSuccess,
  graphInput,
} from './graph-store-test-utils';

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

describe('InMemoryVersionGraphStore commit listing', () => {
  it('lists current main commits in topological newest-first order', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const child = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(child);
    const grandchild = await graph.commit(
      commitInput(await graphInput('grandchild'), child.commit.id, child.main.revision),
    );
    expectGraphSuccess(grandchild);

    const page = await graph.listCommits();
    expectListSuccess(page);
    expect(page).toMatchObject({
      order: 'topological-newest',
      pageSize: 50,
      readRevision: grandchild.main.revision,
    });
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      grandchild.commit.id,
      child.commit.id,
      initialized.commit.id,
    ]);
    expect(page.commits.map((commitRecord) => commitRecord.parents)).toEqual([
      [child.commit.id],
      [initialized.commit.id],
      [],
    ]);

    const mainPage = await graph.listCommits({ ref: VERSION_GRAPH_MAIN_REF });
    expectListSuccess(mainPage);
    expect(mainPage.commits.map((commitRecord) => commitRecord.id)).toEqual([
      grandchild.commit.id,
      child.commit.id,
      initialized.commit.id,
    ]);
  });

  it('lists commits reachable from a branch ref head', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const branch = graph.refStore.createBranch({
      name: 'scenario/list-commits',
      targetCommitId: initialized.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    const main = await graph.commit(
      commitInput(await graphInput('main'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(main);
    const branchCommit = await graph.commit({
      ...(await graphInput('branch')),
      targetRef: 'refs/heads/scenario/list-commits',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
      parentCommitIds: [initialized.commit.id],
    });
    expectGraphSuccess(branchCommit);

    const page = await graph.listCommits({ ref: 'refs/heads/scenario/list-commits' });
    expectListSuccess(page);
    expect(page.readRevision).toEqual(branchCommit.ref.revision);
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      branchCommit.commit.id,
      initialized.commit.id,
    ]);
  });

  it('lists commits reachable from an explicit commit id', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const child = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(child);
    const grandchild = await graph.commit(
      commitInput(await graphInput('grandchild'), child.commit.id, child.main.revision),
    );
    expectGraphSuccess(grandchild);

    const page = await graph.listCommits({ from: child.commit.id });
    expectListSuccess(page);
    expect(page.readRevision).toEqual(grandchild.main.revision);
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      child.commit.id,
      initialized.commit.id,
    ]);
  });

  it('rejects ambiguous list roots before reading refs', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const page = await graph.listCommits({
      ref: VERSION_GRAPH_MAIN_REF,
      from: initialized.commit.id,
    });
    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_INVALID_OPTIONS',
        operation: 'listCommits',
        option: 'ref',
      }),
    ]);
  });

  it('rejects malformed explicit commit roots before reading refs', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    const page = await graph.listCommits({ from: 'commit:sha256:bad' });
    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_INVALID_COMMIT_ID',
        operation: 'listCommits',
        option: 'from',
      }),
    ]);
  });

  it('returns dangling ref diagnostics for branch heads whose commit is missing', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const missingCommitId = commit('99');
    const branch = graph.refStore.createBranch({
      name: 'scenario/dangling-list',
      targetCommitId: missingCommitId,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);

    const page = await graph.listCommits({ ref: 'refs/heads/scenario/dangling-list' });
    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_DANGLING_REF',
        operation: 'listCommits',
        refName: 'refs/heads/scenario/dangling-list',
      }),
      expect.objectContaining({
        code: 'VERSION_MISSING_OBJECT',
        operation: 'listCommits',
        commitId: missingCommitId,
      }),
    ]);
  });

  it('rejects invalid list page sizes before reading refs', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    for (const pageSize of [0, 501, 1.5]) {
      const page = await graph.listCommits({ pageSize });
      expectListFailed(page);
      expect(page.diagnostics).toEqual([
        expect.objectContaining({
          code: 'VERSION_INVALID_OPTIONS',
          operation: 'listCommits',
          option: 'pageSize',
        }),
      ]);
    }
  });

  it('returns an explicit stale cursor diagnostic for unsupported page tokens', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    const page = await graph.listCommits({ pageToken: 'vpt_pending_token_1234' });
    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_STALE_PAGE_CURSOR',
        operation: 'listCommits',
        option: 'pageToken',
        details: expect.objectContaining({ pageTokenUnsupported: true }),
      }),
    ]);
  });
});

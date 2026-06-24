import type { WorkbookCommit } from '../commit-store';
import { createInMemoryVersionGraphStore } from '../graph';
import { orderTopologicalNewestFirst } from '../graph/graph-store-traversal';
import {
  NAMESPACE,
  commit,
  commitInput,
  expectGraphSuccess,
  expectListFailed,
  expectListSuccess,
  graphInput,
} from './graph-store-test-utils';

export function registerListCommitsCompletenessScenarios(): void {
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

  it('marks unavailable list cursors as access-filtered graph metadata incompleteness', async () => {
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
          cursorCategory: 'staleCursor',
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
}

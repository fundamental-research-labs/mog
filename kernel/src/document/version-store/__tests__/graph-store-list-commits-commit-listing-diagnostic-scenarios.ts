import { VERSION_GRAPH_MAIN_REF, createInMemoryVersionGraphStore } from '../graph';
import {
  AUTHOR,
  NAMESPACE,
  commit,
  expectGraphSuccess,
  expectListFailed,
  graphInput,
} from './graph-store-test-utils';

export function registerListCommitsCommitListingDiagnosticScenarios(): void {
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

  it('returns an explicit stale cursor diagnostic for unavailable page tokens', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    const page = await graph.listCommits({ pageToken: 'vpt_pending_token_1234' });
    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_STALE_PAGE_CURSOR',
        operation: 'listCommits',
        option: 'pageToken',
        details: expect.objectContaining({ cursorCategory: 'staleCursor' }),
      }),
    ]);
  });
}

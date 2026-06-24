import { jest } from '@jest/globals';

import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { createWorkbookVersionCommitService } from '../commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph';
import { createInMemoryVersionStoreProvider, namespaceForDocumentScope } from '../provider';
import {
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
  createNormalCommitCapture,
  expectInitializeSuccess,
  initializeInput,
} from './commit-service-test-support';

export function registerCommitServiceTargetRefScenarios(): void {
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
}

import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { createWorkbookVersionCommitService } from '../commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph';
import { namespaceForDocumentScope } from '../provider';
import {
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
  createNormalCommitCapture,
  expectCommitSuccess,
  expectRefRevision,
  setupMergeInputs,
} from './commit-service-test-support';

export function registerMergeCommitFastForwardScenarios(): void {
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
    if (!branch.ok)
      throw new Error(`expected branch create success: ${branch.diagnostics[0]?.code}`);

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
}

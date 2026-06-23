import { jest } from '@jest/globals';

import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { createWorkbookVersionCommitService } from '../commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph-store';
import { namespaceForDocumentScope } from '../provider';
import {
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
  createMergeCommitCapture,
  createNormalCommitCapture,
  expectCommitSuccess,
  expectRefRevision,
  mergeChange,
  objectRecord,
  setupMergeInputs,
} from './commit-service-test-support';

describe('WorkbookVersionCommitService merge commits', () => {
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

  it('persists resolved merge-attempt identity on merge commits', async () => {
    const { provider, initialized, ours, theirs } = await setupMergeInputs();
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
    const graph = await provider.openGraph(namespace);
    const resolvedAttempt = await objectRecord(namespace, 'workbook.resolvedMergeAttempt.v1', {
      recordKind: 'resolvedMergeAttempt',
    });
    expect(await graph.putObjects([resolvedAttempt])).toMatchObject({ status: 'success' });
    const captureMergeCommit = jest.fn(createMergeCommitCapture('merge-attempt-bound'));
    const service = createWorkbookVersionCommitService({
      provider,
      captureMergeCommit,
    });
    const change = mergeChange('merge-bound-change');

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
      resolvedMergeAttemptDigest: resolvedAttempt.digest,
    });

    expectCommitSuccess(merged);
    expect(captureMergeCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedMergeAttemptDigest: resolvedAttempt.digest,
      }),
    );
    expect(merged.commit.payload.resolvedMergeAttemptDigest).toEqual(resolvedAttempt.digest);
    expect(merged.commit.record.preimage.dependencies).toEqual(
      expect.arrayContaining([
        {
          kind: 'object',
          objectType: 'workbook.resolvedMergeAttempt.v1',
          digest: resolvedAttempt.digest,
        },
      ]),
    );
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
});

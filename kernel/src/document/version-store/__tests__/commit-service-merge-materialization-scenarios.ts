import { jest } from '@jest/globals';

import { createWorkbookVersionCommitService } from '../commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph';
import { namespaceForDocumentScope } from '../provider';
import {
  DOCUMENT_SCOPE,
  createMergeCommitCapture,
  expectCommitSuccess,
  expectRefRevision,
  mergeChange,
  objectRecord,
  setupMergeInputs,
} from './commit-service-test-support';

export function registerMergeCommitMaterializationScenarios(): void {
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
}

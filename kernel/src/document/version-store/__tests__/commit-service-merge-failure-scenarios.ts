import { jest } from '@jest/globals';

import { createWorkbookVersionCommitService } from '../commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph';
import { namespaceForDocumentScope } from '../provider';
import {
  DOCUMENT_SCOPE,
  createMergeCommitCapture,
  expectRefRevision,
  mergeChange,
  setupMergeInputs,
} from './commit-service-test-support';

export function registerMergeCommitFailureScenarios(): void {
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
}

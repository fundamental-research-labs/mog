import { expect, it, jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';

import { createWorkbookVersionMergeService } from '../../../document/version-store/merge-service';
import {
  createCommit,
  graphWithRoot,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function registerPublicMergeBaseGateAlreadyMergedAncestorScenarios() {
  it('allows public already-merged ancestor previews to reach the merge service', async () => {
    const graph = await graphWithRoot('graph-public-already-merged-ancestor');
    const theirs = await createCommit(graph, {
      label: 'theirs-ancestor',
      parentCommitIds: [graph.rootCommitId],
    });
    const ours = await createCommit(graph, {
      label: 'ours-descendant',
      parentCommitIds: [theirs],
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });
    const merge = jest.fn(
      (input: VersionMergeInput, options?: Parameters<typeof service.merge>[1]) =>
        service.merge(input, options),
    );
    const version = publicWorkbookVersion(graph.provider, merge);

    await expect(version.merge({ base: graph.rootCommitId, ours, theirs })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'alreadyMerged',
        base: graph.rootCommitId,
        ours,
        theirs,
        changes: [],
        conflicts: [],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      },
    });
    expect(merge).toHaveBeenCalledTimes(1);
  });
}

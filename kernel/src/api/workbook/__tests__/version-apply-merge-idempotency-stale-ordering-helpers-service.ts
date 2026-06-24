import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { MergeVersionGraphInput } from '../../../document/version-store/graph';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import type { VersionGraphStore } from '../../../document/version-store/provider-graph-store';
import { graphCommitContent } from './version-apply-merge-idempotency-stale-ordering-helpers-graph';

export function graphBackedApplyMergeService({
  graph,
  namespace,
}: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
}): Record<string, unknown> {
  return {
    mergeCommit: async (input: {
      readonly base: WorkbookCommitId;
      readonly ours: WorkbookCommitId;
      readonly theirs: WorkbookCommitId;
      readonly targetRef: VersionMainRefName;
      readonly expectedTargetHead: VersionCommitExpectedHead;
      readonly resolvedMergeAttemptDigest?: ObjectDigest;
    }) => {
      const merge = await graph.mergeCommit({
        ...(await graphCommitContent(namespace, 'merge')),
        targetRef: input.targetRef,
        expectedHeadCommitId: input.ours,
        expectedTargetRefVersion: input.expectedTargetHead.revision,
        mergeParentCommitId: input.theirs,
        ...(input.resolvedMergeAttemptDigest
          ? { resolvedMergeAttemptDigest: input.resolvedMergeAttemptDigest }
          : {}),
      } satisfies MergeVersionGraphInput);
      if (merge.status !== 'success') return merge;
      return {
        status: 'success',
        commitRef: {
          id: merge.commit.id,
          refName: merge.ref.name,
          resolvedFrom: merge.ref.name,
          refRevision: merge.ref.revision,
        },
        diagnostics: [],
      };
    },
  };
}

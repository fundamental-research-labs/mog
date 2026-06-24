import { expect, it } from '@jest/globals';

import { mapApplyMergeWriteResult } from '../version/apply-merge/write-result/version-apply-merge-write-result';
import { commitId } from './version-merge-base-gate-test-utils';

export function describeMergeBaseApplyScenarios() {
  it('returns stale-target-head apply diagnostics without accepting merge application', () => {
    const plan = {
      base: commitId('1'),
      ours: commitId('2'),
      theirs: commitId('3'),
      changes: [],
      resolutionCount: 0,
    };

    const result = mapApplyMergeWriteResult(
      {
        status: 'staleTargetHead',
        base: plan.base,
        ours: plan.ours,
        theirs: plan.theirs,
        diagnostics: [],
      },
      plan,
      'merge-commit-created',
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: plan.base,
      ours: plan.ours,
      theirs: plan.theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleTargetHead',
          }),
          mutationGuarantee: 'ref-not-mutated',
          redacted: true,
        }),
      ],
    });
  });
}

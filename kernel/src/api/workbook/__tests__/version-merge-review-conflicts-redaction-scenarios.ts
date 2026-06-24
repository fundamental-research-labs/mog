import {
  normalizeMergeReviewConflicts,
  selectConflictDetailValue,
} from '../version/merge-review/version-merge-review-conflicts';
import {
  expectNoDiagnosticLeaks,
  redactedValueConflict,
} from './version-merge-review-conflicts-test-utils';

export function registerMergeReviewConflictRedactionScenarios(): void {
  it('denies redacted conflict values as resolution payload detail', async () => {
    const normalized = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      redactedValueConflict(),
    ]);
    if (!normalized.ok) throw new Error('expected redacted conflict normalization success');
    const conflict = normalized.conflictSet.conflicts[0];
    const option = conflict.resolutionOptions.find(
      (candidate) => candidate.kind === 'acceptTheirs',
    );
    if (!option) throw new Error('expected acceptTheirs option');

    const review = selectConflictDetailValue(
      'getMergeConflictDetail',
      normalized.conflictSet,
      conflict,
      { valueRole: 'theirs', purpose: 'review' },
    );
    expect(review).toMatchObject({
      ok: true,
      value: { kind: 'redacted', reason: 'permission-denied' },
    });

    const payload = selectConflictDetailValue(
      'getMergeConflictDetail',
      normalized.conflictSet,
      conflict,
      {
        valueRole: 'resolved',
        purpose: 'resolution',
        optionId: option.optionId,
        kind: option.kind,
      },
    );
    expect(payload).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_PERMISSION_DENIED' })],
    });
    expectNoDiagnosticLeaks(payload, [conflict.conflictId, option.optionId]);
  });
}

import { normalizeMergeReviewConflicts } from '../version/merge-review/version-merge-review-conflicts';
import {
  expectNoDiagnosticLeaks,
  formulaConflict,
  rowColumnConflict,
  rowColumnFields,
} from './version-merge-review-conflicts-test-utils';

export function registerMergeReviewConflictNormalizationScenarios(): void {
  it('normalizes stable conflict ordering and rejects unsupported group approval metadata', async () => {
    const formula = formulaConflict({ result: 2, conflictIdDigit: '1' });
    const rowColumn = rowColumnConflict({
      conflictIdDigit: '3',
      fields: rowColumnFields('row', 4),
    });
    const forward = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      formula,
      rowColumn,
    ]);
    const reversed = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      rowColumn,
      formula,
    ]);
    if (!forward.ok || !reversed.ok) throw new Error('expected conflict normalization success');

    expect(forward.conflictSet.conflicts.map((conflict) => conflict.conflictId)).toEqual(
      reversed.conflictSet.conflicts.map((conflict) => conflict.conflictId),
    );

    const grouped = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      {
        ...formula,
        groupId: 'group:secret-cross-owner',
        groupDigest: { algorithm: 'sha256', digest: 'a'.repeat(64) },
        ownerApprovals: [{ owner: 'owner-secret', status: 'approved' }],
      },
    ]);
    expect(grouped).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD' })],
    });
    expectNoDiagnosticLeaks(grouped, ['group:secret-cross-owner', 'owner-secret']);
  });
}

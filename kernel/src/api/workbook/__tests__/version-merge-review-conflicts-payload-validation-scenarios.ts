import type { VersionSemanticValue } from '@mog-sdk/contracts/api';

import {
  normalizeMergeReviewConflicts,
  validateResolutionPayloadPurpose,
} from '../version/merge-review/version-merge-review-conflicts';
import {
  conflictRecord,
  diffValue,
  expectNoDiagnosticLeaks,
  formulaConflict,
  metadata,
} from './version-merge-review-conflicts-test-utils';

export function registerMergeReviewConflictPayloadValidationScenarios(): void {
  it('rejects resolution options that are not bound to their source conflict', async () => {
    const conflict = formulaConflict({ result: 2, conflictIdDigit: '1' });
    const result = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      {
        ...conflict,
        resolutionOptions: conflict.resolutionOptions.map((option) =>
          option.kind === 'acceptTheirs'
            ? { ...option, conflictId: 'conflict:legacy:other-secret' }
            : option,
        ),
      },
    ]);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD' })],
    });
    expectNoDiagnosticLeaks(result, ['conflict:legacy:other-secret']);
  });

  it('rejects sparse structural property paths as invalid preview artifacts', async () => {
    const conflict = formulaConflict({ result: 2, conflictIdDigit: '1' });
    const propertyPath = new Array(1) as string[];
    const result = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      {
        ...conflict,
        structural: {
          ...conflict.structural,
          propertyPath,
        },
      },
    ]);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD' })],
    });
    expectNoDiagnosticLeaks(result, ['legacy-formula-conflict']);
  });

  it('rejects sparse semantic projection arrays as invalid preview artifacts', async () => {
    const sparseValues = new Array(1) as VersionSemanticValue[];
    const structural = metadata('legacy-array-conflict', 'sheet-1!C1', 'cells.values', ['value']);
    const ours = diffValue({ kind: 'array', values: sparseValues });
    const result = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      conflictRecord('4', structural, diffValue(null), ours, diffValue('literal')),
    ]);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_INVALID_COMMIT_PAYLOAD' })],
    });
    expectNoDiagnosticLeaks(result, ['legacy-array-conflict']);
  });

  it('returns mismatch diagnostics for malformed chooseValue payloads', async () => {
    const normalized = await normalizeMergeReviewConflicts('getMergeConflictDetail', [
      formulaConflict({ result: 2, conflictIdDigit: '1' }),
    ]);
    if (!normalized.ok) throw new Error('expected conflict normalization success');
    const conflict = normalized.conflictSet.conflicts[0];
    const option = conflict.resolutionOptions.find((candidate) => candidate.kind === 'acceptOurs');
    if (!option) throw new Error('expected acceptOurs option');

    const diagnostics = validateResolutionPayloadPurpose(conflict, option, {
      purpose: 'chooseValue',
      value: { kind: 'value', value: { kind: 'object', fields: [undefined] } },
    } as unknown as Parameters<typeof validateResolutionPayloadPurpose>[2]);

    expect(diagnostics).toEqual([
      expect.objectContaining({ issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH' }),
    ]);
  });
}

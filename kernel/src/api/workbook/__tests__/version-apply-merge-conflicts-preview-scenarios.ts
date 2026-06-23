import { expect, it, jest } from '@jest/globals';

import {
  BASE,
  conflictedResult,
  OURS,
  resolutionFor,
  sameCellConflict,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function describeApplyMergeConflictPreviewScenarios(): void {
  it('returns conflicted previews when resolutions are not supplied', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = workbookVersionWithVersioning({ mergeService: { merge } });

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, { mode: 'preview' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'conflicted',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [conflict],
        diagnostics: [],
        requiredResolutionCount: 1,
        mutationGuarantee: 'preview-only',
      },
    });
  });

  it('plans conflicted previews when each conflict has a matching resolution option', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = workbookVersionWithVersioning({ mergeService: { merge } });

    await expect(
      version.applyMerge(
        {
          base: BASE,
          ours: OURS,
          theirs: THEIRS,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        },
        { mode: 'preview' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'planned',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [
          {
            structural: conflict.structural,
            base: conflict.base,
            ours: conflict.ours,
            theirs: conflict.theirs,
            merged: { kind: 'value', value: 'theirs' },
          },
        ],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 1,
        mutationGuarantee: 'preview-only',
      },
    });
  });
}

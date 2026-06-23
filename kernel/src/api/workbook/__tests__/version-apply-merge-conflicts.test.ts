import { jest } from '@jest/globals';

import {
  BASE,
  conflictedResult,
  EXPECTED_TARGET_HEAD,
  MERGE,
  OURS,
  resolutionFor,
  sameCellConflict,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

describe('WorkbookVersion applyMerge conflict resolution', () => {
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

  it('applies resolved conflicts through the merge commit write service', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const mergeCommit = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: MERGE,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      diagnostics: [],
    }));
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { mergeCommit },
    });
    const resolution = resolutionFor(conflict, 'acceptTheirs');
    const resolvedChange = {
      structural: conflict.structural,
      base: conflict.base,
      ours: conflict.ours,
      theirs: conflict.theirs,
      merged: { kind: 'value' as const, value: 'theirs' },
    };

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS, resolutions: [resolution] },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: MERGE,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: { kind: 'counter', value: '2' },
        },
        changes: [resolvedChange],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 1,
        mutationGuarantee: 'merge-commit-created',
      },
    });
    expect(mergeCommit).toHaveBeenCalledWith({
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      changes: [resolvedChange],
      resolutionCount: 1,
    });
  });

  it('blocks resolution sets with stale conflict digests', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = workbookVersionWithVersioning({ mergeService: { merge } });
    const resolution = {
      ...resolutionFor(conflict, 'acceptOurs'),
      expectedConflictDigest: 'sha256:stale',
    };

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS, resolutions: [resolution] },
        { mode: 'preview' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
            data: expect.objectContaining({
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
  });
});

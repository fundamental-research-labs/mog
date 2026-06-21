import { jest } from '@jest/globals';

import type {
  VersionApplyMergeResolution,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeResult,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];

describe('WorkbookVersion applyMerge preview planner', () => {
  it('plans clean merge previews without mutating through a write service', async () => {
    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [
        {
          structural: metadata('merge-change-a1', 'sheet-1!A1'),
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: 'ours' },
          merged: { kind: 'value', value: 'ours' },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const write = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge }, writeService: { commit: write } },
    } as any);

    await expect(version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toEqual({
      status: 'planned',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: result.changes,
      conflicts: [],
      diagnostics: [],
      resolutionCount: 0,
      mutationGuarantee: 'preview-only',
    });
    expect(merge).toHaveBeenCalledWith({ base: BASE, ours: OURS, theirs: THEIRS }, {});
    expect(write).not.toHaveBeenCalled();
  });

  it('returns conflicted previews when resolutions are not supplied', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toEqual({
      status: 'conflicted',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [conflict],
      diagnostics: [],
      requiredResolutionCount: 1,
      mutationGuarantee: 'preview-only',
    });
  });

  it('plans conflicted previews when each conflict has a matching resolution option', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(
      version.applyMerge({
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        resolutions: [resolutionFor(conflict, 'acceptTheirs')],
      }),
    ).resolves.toMatchObject({
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
    });
  });

  it('blocks resolution sets with stale conflict digests', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);
    const resolution = {
      ...resolutionFor(conflict, 'acceptOurs'),
      expectedConflictDigest: 'sha256:stale',
    };

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS, resolutions: [resolution] }),
    ).resolves.toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
          redacted: true,
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
  });

  it('validates applyMerge input before merge preview is requested', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(
      version.applyMerge({
        base: 'commit:sha256:BAD' as any,
        ours: OURS,
        theirs: THEIRS,
        resolutions: 'bad' as any,
        extra: true,
      } as any),
    ).resolves.toMatchObject({
      status: 'blocked',
      base: null,
      ours: OURS,
      theirs: THEIRS,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ issueCode: 'VERSION_INVALID_OPTIONS' }),
      ]),
      mutationGuarantee: 'preview-only',
    });
    expect(merge).not.toHaveBeenCalled();
  });
});

function conflictedResult(conflict: VersionMergeConflict): VersionMergeResult {
  return {
    status: 'conflicted',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes: [],
    conflicts: [conflict],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

function sameCellConflict(): VersionMergeConflict {
  const conflictId = 'conflict:sha256:same-cell-a1';
  return {
    conflictId,
    conflictDigest: 'sha256:same-cell-a1',
    conflictKind: 'same-property',
    structural: metadata('merge-conflict-a1', 'sheet-1!A1'),
    base: { kind: 'value', value: 'base' },
    ours: { kind: 'value', value: 'ours' },
    theirs: { kind: 'value', value: 'theirs' },
    resolutionOptions: [
      option(conflictId, 'acceptOurs', 'ours'),
      option(conflictId, 'acceptTheirs', 'theirs'),
      option(conflictId, 'acceptBase', 'base'),
    ],
  };
}

function resolutionFor(
  conflict: VersionMergeConflict,
  kind: 'acceptOurs' | 'acceptTheirs' | 'acceptBase',
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`missing option ${kind}`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

function option(
  conflictId: string,
  kind: 'acceptOurs' | 'acceptTheirs' | 'acceptBase',
  value: string,
) {
  return {
    optionId: `option:${kind}`,
    conflictId,
    kind,
    value: { kind: 'value' as const, value },
    recalcRequired: true,
  };
}

function metadata(changeId: string, entityId: string) {
  return {
    kind: 'metadata' as const,
    changeId,
    domain: 'cells.values',
    entityId,
    propertyPath: ['value'],
  };
}

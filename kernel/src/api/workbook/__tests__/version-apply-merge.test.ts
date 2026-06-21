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
const MERGE = `commit:sha256:${'4'.repeat(64)}` as VersionMergeInput['ours'];
const TARGET_REF = 'refs/heads/main';
const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};
const DIGEST_A = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
const DIGEST_B = { algorithm: 'sha256', digest: 'b'.repeat(64) } as const;
const DIGEST_C = { algorithm: 'sha256', digest: 'c'.repeat(64) } as const;

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

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, { mode: 'preview' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'planned',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: result.changes,
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'preview-only',
      },
    });
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('applies clean merge plans through a two-parent merge commit write service', async () => {
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
          theirs: { kind: 'value', value: 'theirs' },
          merged: { kind: 'value', value: 'theirs' },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
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
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge }, writeService: { mergeCommit } },
    } as any);

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
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
        changes: result.changes,
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'merge-commit-created',
      },
    });
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );
    expect(mergeCommit).toHaveBeenCalledWith({
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      changes: result.changes,
      resolutionCount: 0,
    });
  });

  it('fast-forwards apply mode without previewing or creating a merge commit', async () => {
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const fastForwardMerge = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: THEIRS,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      diagnostics: [],
      mutationGuarantee: 'ref-fast-forwarded',
    }));
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
      },
    } as any);

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'applied',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: THEIRS,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: { kind: 'counter', value: '2' },
        },
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-fast-forwarded',
      },
    });
    expect(fastForwardMerge).toHaveBeenCalledWith({
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('passes through terminal fast-forward apply metadata from the write service', async () => {
    const merge = jest.fn();
    const mergeCommit = jest.fn();
    const fastForwardMerge = jest.fn(async () => ({
      status: 'fastForwarded',
      commitRef: {
        id: THEIRS,
        refName: TARGET_REF,
        resolvedFrom: TARGET_REF,
        refRevision: { kind: 'counter' as const, value: '2' },
      },
      resultId: 'merge-result:fast-forward-main',
      previewArtifactDigest: DIGEST_C,
      resultDigest: DIGEST_A,
      resolutionSetDigest: DIGEST_B,
      resolvedAttemptDigest: DIGEST_C,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: THEIRS,
      applicationPlanDigest: DIGEST_A,
      diagnostics: [],
      mutationGuarantee: 'ref-fast-forwarded',
    }));
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
      },
    } as any);

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'fastForwarded',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: THEIRS,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: { kind: 'counter', value: '2' },
        },
        resultId: 'merge-result:fast-forward-main',
        previewArtifactDigest: DIGEST_C,
        resultDigest: DIGEST_A,
        resolutionSetDigest: DIGEST_B,
        resolvedAttemptDigest: DIGEST_C,
        targetRef: TARGET_REF,
        headBefore: OURS,
        headAfter: THEIRS,
        applicationPlanDigest: DIGEST_A,
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-fast-forwarded',
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('plans fast-forward previews as zero-change plans', async () => {
    const merge = jest.fn(async () => ancestryResult('fastForward'));
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge }, writeService: { mergeCommit } },
    } as any);

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, { mode: 'preview' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'planned',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'preview-only',
      },
    });
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('blocks fast-forward apply previews when no fast-forward writer is available', async () => {
    const merge = jest.fn(async () => ancestryResult('fastForward'));
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge }, writeService: { mergeCommit } },
    } as any);

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_STORE_UNAVAILABLE',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('plans already-merged previews as zero-change plans', async () => {
    const merge = jest.fn(async () => ancestryResult('alreadyMerged'));
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, { mode: 'preview' }),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'planned',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'preview-only',
      },
    });
  });

  it('returns alreadyMerged in apply mode without writing', async () => {
    const merge = jest.fn(async () => ancestryResult('alreadyMerged'));
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge }, writeService: { mergeCommit } },
    } as any);

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'alreadyMerged',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        commitRef: {
          id: OURS,
          refName: TARGET_REF,
          resolvedFrom: TARGET_REF,
          refRevision: EXPECTED_TARGET_HEAD.revision,
        },
        changes: [],
        conflicts: [],
        diagnostics: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      },
    });
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('returns conflicted previews when resolutions are not supplied', async () => {
    const conflict = sameCellConflict();
    const merge = jest.fn(async () => conflictedResult(conflict));
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

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
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

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
    const version = new WorkbookVersionImpl({
      versioning: { mergeService: { merge }, writeService: { mergeCommit } },
    } as any);
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
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);
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

  it('blocks apply mode before preview when target head fencing is incomplete', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
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
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('validates persisted result inputs before merge preview is requested', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({ versioning: { mergeService: { merge } } } as any);

    await expect(
      version.applyMerge(
        {
          resultId: 'merge-result:not-a-digest',
          resultDigest: DIGEST_A,
        } as any,
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();

    await expect(
      version.applyMerge(
        {
          resultId: `merge-result:${'a'.repeat(64)}`,
          previewArtifactDigest: { algorithm: 'sha256', digest: 'not-a-digest' },
          resultDigest: DIGEST_A,
        } as any,
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();

    await expect(
      version.applyMerge(
        {
          resultId: `merge-result:${DIGEST_B.digest}`,
          previewArtifactDigest: DIGEST_B,
          resultDigest: DIGEST_A,
        } as any,
        { mode: 'preview' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_MERGE_RESOLUTION_MISMATCH' }),
        ]),
      },
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

function ancestryResult(status: 'fastForward' | 'alreadyMerged'): VersionMergeResult {
  return {
    status,
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes: [],
    conflicts: [],
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

import { expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';

import {
  BASE,
  metadata,
  OURS,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function registerCleanMergePreviewScenario(): void {
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
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { commit: write },
    });

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
}

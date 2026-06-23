import { expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';
import {
  BASE,
  invalidCommitPayloadFailureMatcher,
  mergeInput,
  OURS,
  THEIRS,
  workbookVersionWithMergeService,
} from './version-merge-provider-test-utils';

export function describeMergeProviderAncestryScenarios(): void {
  it.each(['fastForward', 'alreadyMerged'] as const)(
    'passes through provider %s ancestry previews',
    async (status) => {
      const result: VersionMergeResult = {
        status,
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      };
      const merge = jest.fn(async () => result);
      const version = workbookVersionWithMergeService(merge);

      await expect(version.merge(mergeInput())).resolves.toStrictEqual({
        ok: true,
        value: result,
      });
    },
  );

  it('blocks provider ancestry previews that include merge changes', async () => {
    const merge = jest.fn(async () => ({
      status: 'fastForward',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'merge-change-1',
            domain: 'cell',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: null },
          theirs: { kind: 'value', value: 'ready' },
          merged: { kind: 'value', value: 'ready' },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    }));
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge(mergeInput())).resolves.toMatchObject(
      invalidCommitPayloadFailureMatcher(),
    );
  });
}

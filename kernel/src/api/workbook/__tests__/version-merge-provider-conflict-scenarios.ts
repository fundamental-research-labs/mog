import { expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';
import {
  BASE,
  invalidCommitPayloadFailureMatcher,
  mergeInput,
  OURS,
  resolutionOption,
  THEIRS,
  workbookVersionWithMergeService,
} from './version-merge-provider-test-utils';

export function describeMergeProviderConflictPassThroughScenarios(): void {
  it('passes through provider conflicts with stable identity fields', async () => {
    const result: VersionMergeResult = {
      status: 'conflicted',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [
        {
          conflictId: 'conflict:cell:sheet-1:B1:value',
          conflictDigest: 'sha256:merge-conflict-digest',
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            changeId: 'merge-conflict-1',
            domain: 'cell',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: 'base' },
          ours: { kind: 'value', value: 'ours' },
          theirs: { kind: 'value', value: 'theirs' },
          resolutionOptions: [
            resolutionOption('acceptOurs', 'ours'),
            resolutionOption('acceptTheirs', 'theirs'),
            resolutionOption('acceptBase', 'base'),
          ],
        },
      ],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge(mergeInput())).resolves.toStrictEqual({
      ok: true,
      value: result,
    });
  });
}

export function describeMergeProviderConflictValidationScenarios(): void {
  it.each(['conflictId', 'conflictDigest', 'resolutionOptions'] as const)(
    'blocks provider conflicts without %s',
    async (missingField) => {
      const conflict: Record<string, unknown> = {
        conflictId: 'conflict:cell:sheet-1:B1:value',
        conflictDigest: 'sha256:merge-conflict-digest',
        conflictKind: 'same-property',
        structural: {
          kind: 'metadata',
          changeId: 'merge-conflict-1',
          domain: 'cell',
          entityId: 'sheet-1!B1',
          propertyPath: ['value'],
        },
        base: { kind: 'value', value: 'base' },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: 'theirs' },
        resolutionOptions: [
          resolutionOption('acceptOurs', 'ours'),
          resolutionOption('acceptTheirs', 'theirs'),
          resolutionOption('acceptBase', 'base'),
        ],
      };
      delete conflict[missingField];

      const merge = jest.fn(async () => ({
        status: 'conflicted',
        base: BASE,
        ours: OURS,
        theirs: THEIRS,
        changes: [],
        conflicts: [conflict],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      }));
      const version = workbookVersionWithMergeService(merge);

      await expect(version.merge(mergeInput())).resolves.toMatchObject(
        invalidCommitPayloadFailureMatcher(),
      );
    },
  );

  it('blocks provider conflicts without the complete first-slice resolution option set', async () => {
    const merge = jest.fn(async () => ({
      status: 'conflicted',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [
        {
          conflictId: 'conflict:cell:sheet-1:B1:value',
          conflictDigest: 'sha256:merge-conflict-digest',
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            changeId: 'merge-conflict-1',
            domain: 'cell',
            entityId: 'sheet-1!B1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: 'base' },
          ours: { kind: 'value', value: 'ours' },
          theirs: { kind: 'value', value: 'theirs' },
          resolutionOptions: [
            resolutionOption('acceptOurs', 'ours'),
            resolutionOption('acceptTheirs', 'theirs'),
          ],
        },
      ],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    }));
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge(mergeInput())).resolves.toMatchObject(
      invalidCommitPayloadFailureMatcher(),
    );
  });
}

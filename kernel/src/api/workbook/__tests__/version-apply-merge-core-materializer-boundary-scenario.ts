import { expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';

import {
  BASE,
  EXPECTED_TARGET_HEAD,
  metadata,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

export function registerUnsupportedDomainMergeScenario(): void {
  it('blocks clean merge plans the merge materializer cannot apply', async () => {
    const manifestRuntime = versionDomainSupportManifestRuntime();
    const sheets = manifestRuntime.domainSupportManifest.domains.find(
      (row) => row.matrixRowId === 'sheets',
    );
    expect(sheets?.capabilityStates.merge).toBe('supported');

    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [
        {
          structural: metadata('merge-change-sheet-lifecycle', 'sheet-2', 'sheet', ['sheet']),
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: null },
          theirs: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'name', value: 'Inserted' },
                { key: 'index', value: 1 },
              ],
            },
          },
          merged: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'name', value: 'Inserted' },
                { key: 'index', value: 1 },
              ],
            },
          },
        },
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const mergeCommit = jest.fn();
    const version = workbookVersionWithVersioning(
      {
        mergeService: { merge },
        writeService: { mergeCommit },
      },
      manifestRuntime,
    );

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
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({ domain: 'sheet' }),
            }),
          }),
        ],
      },
    });
    expect(merge).toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}

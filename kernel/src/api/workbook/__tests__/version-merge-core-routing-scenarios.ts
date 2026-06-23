import { expect, it, jest } from '@jest/globals';

import {
  BASE_COMMIT_ID,
  OURS_COMMIT_ID,
  THEIRS_COMMIT_ID,
  workbookVersionWithMergeService,
} from './version-merge-core-test-utils';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

export function registerVersionMergeCoreRoutingScenarios(): void {
  it('routes explicit commit-id preview requests to the attached merge service', async () => {
    const manifestRuntime = versionDomainSupportManifestRuntime();
    const cellsValues = manifestRuntime.domainSupportManifest.domains.find(
      (row) => row.matrixRowId === 'cells.values',
    );
    expect(cellsValues?.capabilityStates.merge).toBe('supported');

    const merge = jest.fn(async () => ({
      status: 'clean',
      base: BASE_COMMIT_ID,
      ours: OURS_COMMIT_ID,
      theirs: THEIRS_COMMIT_ID,
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
    const version = workbookVersionWithMergeService(merge, manifestRuntime);

    await expect(
      version.merge(
        {
          base: BASE_COMMIT_ID,
          ours: OURS_COMMIT_ID,
          theirs: THEIRS_COMMIT_ID,
        },
        { mode: 'preview', includeDiagnostics: true },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'clean',
        base: BASE_COMMIT_ID,
        ours: OURS_COMMIT_ID,
        theirs: THEIRS_COMMIT_ID,
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
      },
    });
    expect(merge).toHaveBeenCalledWith(
      {
        base: BASE_COMMIT_ID,
        ours: OURS_COMMIT_ID,
        theirs: THEIRS_COMMIT_ID,
      },
      { mode: 'preview', includeDiagnostics: true },
    );
  });
}

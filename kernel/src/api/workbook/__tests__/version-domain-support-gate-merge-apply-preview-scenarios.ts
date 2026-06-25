import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { BASE, OURS, THEIRS, mergeInput } from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export function registerMergeGateApplyPreviewScenarios(): void {
  it('plans applyMerge preview after public merge capability validation passes', async () => {
    const mergeResult = {
      status: 'clean' as const,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only' as const,
    };
    const merge = jest.fn(async () => mergeResult);
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.applyMerge(mergeInput(), { mode: 'preview' })).resolves.toEqual({
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
    expect(merge).toHaveBeenCalledWith(mergeInput(), {
      mode: 'preview',
    });
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}

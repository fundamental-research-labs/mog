import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { BASE, OURS, THEIRS, mergeInput } from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export function registerMergeGatePreviewRoutingScenarios(): void {
  it('routes merge preview after public merge capability validation passes', async () => {
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
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.merge(mergeInput())).resolves.toEqual({
      ok: true,
      value: mergeResult,
    });
    expect(merge).toHaveBeenCalledWith(mergeInput(), {});
  });
}

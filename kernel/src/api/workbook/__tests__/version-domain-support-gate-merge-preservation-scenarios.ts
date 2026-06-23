import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  BASE,
  OURS,
  THEIRS,
  plannedCheckoutResult,
} from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT as CREATED_AT,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export function registerMergeGatePreservationScenarios(): void {
  it('preserves supported commit and checkout behavior when public merge support is enabled', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      summary: {
        id: THEIRS,
        parents: [OURS],
        createdAt: CREATED_AT,
        author: { actorKind: 'user', displayName: 'User One' },
      },
      diagnostics: [],
    }));
    const checkout = jest.fn(async () => plannedCheckoutResult(BASE));
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        checkoutService: { checkout },
        domainSupportManifest: freshManifest(),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: true,
      value: { id: THEIRS },
    });
    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
      },
    });
    expect(commit).toHaveBeenCalled();
    expect(checkout).toHaveBeenCalled();
  });
}

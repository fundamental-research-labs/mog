import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import {
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
  mergeCapabilityRegistryMismatch,
  mergeInput,
} from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerMergeGateApplyRegistryScenarios(): void {
  it('blocks applyMerge before previewing or invoking write services when the manifest downgrades merge state below the registry', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    merge: 'contracted',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(
      version.applyMerge(mergeInput(), {
        targetRef: TARGET_REF as any,
        expectedTargetHead: EXPECTED_TARGET_HEAD,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([mergeCapabilityRegistryMismatch('applyMerge')]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}

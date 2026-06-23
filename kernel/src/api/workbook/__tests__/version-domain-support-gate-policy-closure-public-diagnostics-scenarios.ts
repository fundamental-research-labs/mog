import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerPolicyClosurePublicDiagnosticsScenarios(): void {
  it('does not expose eval-only expected-failing capability states through public diagnostics', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? (domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    capture: 'expected-failing',
                  } as any,
                }) as any)
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    const result = await version.commit();

    expect(result).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'unknown-capability-state',
                domainId: 'cells.values',
                capabilityKey: 'capture',
              }),
            }),
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain('expected-failing');
    expect(commit).not.toHaveBeenCalled();
  });
}

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

export function registerDomainSupportCapabilityPolicyCommitScenarios(): void {
  it('blocks commit before invoking the write service when a required capability is not supported', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  capabilityStates: {
                    ...capabilityStates(),
                    capture: 'contracted',
                  },
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
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
                diagnosticCode: 'capability-state-blocked',
                domainId: 'cells.values',
                capabilityKey: 'capture',
                capabilityState: 'contracted',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit before invoking the write service when policy write admission is block', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values'
              ? domainRow(id, {
                  writeAdmissionMode: 'block',
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
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
                diagnosticCode: 'write-admission-mode-blocked',
                domainId: 'cells.values',
                policyField: 'writeAdmissionMode',
                policyValue: 'redacted',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit when a manifest only carries the legacy scalar capabilityState', async () => {
    const commit = jest.fn();
    const legacyRow = domainRow('cells.values') as any;
    delete legacyRow.capabilityStates;
    legacyRow.capabilityState = 'supported';
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({
          domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
            id === 'cells.values' ? legacyRow : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: TEN_MINUTES_MS },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
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
                diagnosticCode: 'capability-states-missing',
                domainId: 'cells.values',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });
}

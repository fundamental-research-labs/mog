import { jest } from '@jest/globals';

import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';
import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import { validateVersionDomainSupportManifestGate } from '../version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  exportSupportedVersionDomainPolicyRegistry as exportSupportedPolicyRegistry,
  exportSupportedVersionDomainSupportManifest as exportSupportedManifest,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainCapabilityStates as capabilityStates,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

describe('WorkbookVersion domain support policy gate closure', () => {
  it('fails closed per required capability when a manifest source is missing', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          writeService: { commit: jest.fn() },
        },
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
          payload: expect.objectContaining({
            operation: 'commit',
            capabilityKey: 'capture',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
          payload: expect.objectContaining({
            operation: 'commit',
            capabilityKey: 'persistence',
          }),
        }),
      ]),
    );
  });

  it('does not let caller registries promote merge support beyond public runtime policy', async () => {
    const domainSupportManifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => {
        const row = domainRow(id);
        return id === 'cells.values'
          ? {
              ...row,
              capabilityStates: {
                ...row.capabilityStates,
                merge: 'supported',
              },
            }
          : row;
      }),
    });
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest,
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            domainPolicyRegistry: exportSupportedPolicyRegistry(domainSupportManifest),
          },
        },
      } as any,
      'merge',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'merge',
            diagnosticCode: 'domain-policy-registry-mismatch',
            policyField: 'capabilityStates.merge',
            policyValue: 'supported',
          }),
        }),
      ]),
    );
  });

  it('does not let caller registries promote export support for any public registry row', async () => {
    const domainSupportManifest = exportSupportedManifest();
    const exportUnsupportedPublicRows = PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.filter(
      (row) => row.capabilityStates.export !== 'supported',
    );
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest,
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            domainPolicyRegistry: exportSupportedPolicyRegistry(domainSupportManifest),
          },
        },
      } as any,
      'export',
    );

    const promotedMismatchRows = diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.issueCode === 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID' &&
          diagnostic.payload.diagnosticCode === 'domain-policy-registry-mismatch' &&
          diagnostic.payload.policyField === 'capabilityStates.export',
      )
      .map((diagnostic) => diagnostic.payload.matrixRowId);

    expect(promotedMismatchRows).toHaveLength(exportUnsupportedPublicRows.length);
    expect(new Set(promotedMismatchRows)).toEqual(
      new Set(exportUnsupportedPublicRows.map((row) => row.matrixRowId)),
    );
  });

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
});

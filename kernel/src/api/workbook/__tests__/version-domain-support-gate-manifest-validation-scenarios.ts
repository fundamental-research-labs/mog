import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { OURS, THEIRS } from './version-domain-support-gate-test-helpers';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT as CREATED_AT,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS as ONE_MINUTE_MS,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  selfPromotedVersionDomainSupportManifest as selfPromotedManifest,
} from './version-domain-support-test-utils';

export function registerDomainSupportGateManifestValidationScenarios(): void {
  it('blocks commit before invoking the write service when the manifest is stale', async () => {
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
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: freshManifest({ generatedAt: '2026-06-20T00:00:00.000Z' }),
        domainSupportManifestOptions: { now: NOW, maxAgeMs: ONE_MINUTE_MS },
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
                diagnosticCode: 'manifest-stale',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks commit when an attached manifest self-promotes beyond the public policy registry', async () => {
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        domainSupportManifest: selfPromotedManifest(),
        domainSupportManifestOptions: {
          now: NOW,
          maxAgeMs: TEN_MINUTES_MS,
          domainPolicyRegistry: {
            schemaVersion: 'version-domain-policy-registry.v1',
            generatedAt: CREATED_AT,
            domains: selfPromotedManifest().domains,
          },
        },
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
                diagnosticCode: 'domain-policy-registry-mismatch',
                domainId: 'recalc-caches',
                policyField: 'domainClass',
                policyValue: 'redacted',
              }),
            }),
          }),
        ]),
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });
}

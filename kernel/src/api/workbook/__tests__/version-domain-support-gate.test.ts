import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
} from './version-domain-support-gate-test-helpers';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_CREATED_AT as CREATED_AT,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS as ONE_MINUTE_MS,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  selfPromotedVersionDomainSupportManifest as selfPromotedManifest,
} from './version-domain-support-test-utils';

describe('WorkbookVersion domain support manifest gate', () => {
  it('fails closed before invoking version-capable services when no manifest source is attached', async () => {
    const commit = jest.fn();
    const checkout = jest.fn();
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit, fastForwardMerge, mergeCommit },
        checkoutService: { checkout },
        mergeService: { merge },
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    await expect(version.checkout({ kind: 'commit', id: BASE })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.checkout',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'checkout',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    await expect(version.merge({ base: BASE, ours: OURS, theirs: THEIRS })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.merge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'merge',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });

    expect(commit).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('fails closed for persisted applyMerge writer aliases when no manifest source is attached', async () => {
    const fastForward = jest.fn();
    const applyFastForwardMerge = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        versionWriteService: { fastForward },
        applyFastForwardMerge,
      },
    } as any);

    await expect(
      version.applyMerge(
        {
          resultId: 'merge-result:review-main',
          resultDigest: { algorithm: 'sha256', digest: 'a'.repeat(64) },
        } as any,
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(fastForward).not.toHaveBeenCalled();
    expect(applyFastForwardMerge).not.toHaveBeenCalled();
  });

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

  it('fails closed when an advertised required manifest source is missing', async () => {
    const readDomainSupportManifest = jest.fn(async () => null);
    const commit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        writeService: { commit },
        readDomainSupportManifest,
        requireDomainSupportManifest: true,
      },
    } as any);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.commit',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(readDomainSupportManifest).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});

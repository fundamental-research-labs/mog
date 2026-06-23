import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
} from './version-domain-support-gate-test-helpers';

export function registerDomainSupportGateMissingManifestScenarios(): void {
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
}

import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { WorkbookVersionImpl } from '../version';
import {
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
  mergeInput,
} from './version-domain-support-gate-merge-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

export function registerMergeGateApplyAdmissionScenarios(): void {
  it('blocks applyMerge before previewing or invoking write services when the manifest is invalid', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: {
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
        domainSupportManifest: freshManifest({ schemaVersion: '999' }),
        domainSupportManifestOptions: { now: NOW },
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
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'schema-version-unsupported',
              }),
            }),
          }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('blocks applyMerge before previewing or invoking write services when policy write admission is block', async () => {
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
                  writeAdmissionMode: 'block',
                })
              : domainRow(id),
          ),
        }),
        domainSupportManifestOptions: { now: NOW },
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
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'applyMerge',
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
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}

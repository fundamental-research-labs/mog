import { expect, it, jest } from '@jest/globals';
import type { VersionRevertInput } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
  VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE,
  VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
} from '../version/revert/version-revert';
import { COMMIT_B, MAIN_REF, MAIN_REVISION, singleCommitInput } from './version-revert-test-utils';

export function registerRevertAdmissionPreflightMatrixScenarios(): void {
  it.each([
    {
      label: 'unsupported domains',
      input: {
        ...singleCommitInput(),
        preflight: {
          unsupportedDomains: [
            {
              domain: 'pivot-cache',
              matrixRowId: 'pivot-cache.records',
              reason: 'unsupportedDetectedDomain',
            },
          ],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
      payload: {
        domain: 'pivot-cache',
        matrixRowId: 'pivot-cache.records',
        reason: 'unsupportedDetectedDomain',
      },
    },
    {
      label: 'opaque domains',
      input: {
        ...singleCommitInput(),
        preflight: {
          opaqueDomains: [
            {
              domain: 'external-links',
              matrixRowId: 'external-links.package-fidelity',
              reason: 'opaqueDomain',
            },
          ],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE,
      payload: {
        domain: 'external-links',
        matrixRowId: 'external-links.package-fidelity',
        reason: 'opaqueDomain',
      },
    },
    {
      label: 'history gaps',
      input: {
        ...singleCommitInput(),
        preflight: {
          gaps: [{ gapId: 'gap:legacy-import:1', reason: 'known-gap' }],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
      payload: { gapId: 'gap:legacy-import:1', reason: 'known-gap' },
    },
    {
      label: 'target ref CAS',
      input: {
        ...singleCommitInput(),
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
        preflight: {
          cas: {
            refName: MAIN_REF,
            expectedRevision: MAIN_REVISION,
            reason: 'target-ref-cas',
          },
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
      payload: { refName: MAIN_REF, reason: 'target-ref-cas', expectedHeadProvided: true },
    },
    {
      label: 'review invalidation',
      input: {
        ...singleCommitInput(),
        preflight: {
          reviewInvalidation: [
            {
              reviewId: 'review-1',
              expectedRevision: 3,
              reason: 'reverted-subject',
            },
          ],
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
      payload: { reviewId: 'review-1', expectedRevision: 3, reason: 'reverted-subject' },
    },
  ])(
    'rejects $label with stable diagnostics while revert is unavailable',
    async ({ input, code, payload }) => {
      const revert = jest.fn();
      const version = new WorkbookVersionImpl({
        versioning: {},
      } as any);

      await expect(
        version.revert(input, { dryRun: true, includeDiagnostics: true }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.revert',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  dependency: 'upstreamRevertContract',
                  dryRun: true,
                }),
              }),
            }),
            expect.objectContaining({
              code,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  ...payload,
                }),
              }),
            }),
          ]),
        },
      });
      expect(revert).not.toHaveBeenCalled();
    },
  );
}

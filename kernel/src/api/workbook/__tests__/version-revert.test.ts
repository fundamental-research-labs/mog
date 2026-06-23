import { jest } from '@jest/globals';
import type { VersionRevertInput } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
  VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE,
  VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
} from '../version-revert';

const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as const;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as const;
const COMMIT_C = `commit:sha256:${'c'.repeat(64)}` as const;
const MAIN_REF = 'refs/heads/main' as const;
const MAIN_REVISION = { kind: 'counter', value: '7' } as const;

describe('WorkbookVersion revert facade disabled admission', () => {
  it.each([
    {
      label: 'versionControl feature gate',
      ctx: { featureGates: { capabilities: { versionControl: false } } },
      message: 'The versionControl feature gate is disabled for this workbook.',
      reason: 'versionControlDisabled',
    },
    {
      label: 'editing feature gate',
      ctx: { featureGates: { editing: false } },
      message: 'Workbook editing is disabled by host feature gates.',
      reason: 'editingDisabled',
    },
  ])('blocks revert before provider access when disabled by $label', async ({ ctx, message, reason }) => {
    const revert = jest.fn();
    const version = new WorkbookVersionImpl({
      ...ctx,
      versioning: { revertService: { revert } },
    } as any);

    await expect(version.revert(singleCommitInput())).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            message,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                capability: 'version:revert',
                reason,
              }),
            }),
          }),
        ],
      },
    });
    expect(revert).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'single commit',
      input: singleCommitInput(),
      code: VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
      payload: { targetKind: 'commit' },
    },
    {
      label: 'commit range',
      input: {
        target: { kind: 'range', baseCommitId: COMMIT_A, headCommitId: COMMIT_B },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
      payload: { targetKind: 'range' },
    },
    {
      label: 'merge commit mainline selection',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 1 },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
      payload: { targetKind: 'mergeCommit', mainlineParent: 1 },
    },
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
      label: 'stale heads',
      input: {
        ...singleCommitInput(),
        targetRef: MAIN_REF,
        preflight: {
          staleHead: {
            refName: MAIN_REF,
            expectedCommitId: COMMIT_B,
            actualCommitId: COMMIT_C,
          },
        },
      } satisfies VersionRevertInput,
      code: VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
      payload: { refName: MAIN_REF, expectedCommitId: COMMIT_B, actualCommitId: COMMIT_C },
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
  ])('rejects $label with stable diagnostics while revert is unavailable', async ({ input, code, payload }) => {
    const revert = jest.fn();
    const version = new WorkbookVersionImpl({
      versioning: { revertService: { revert } },
    } as any);

    await expect(version.revert(input, { dryRun: true, includeDiagnostics: true })).resolves.toMatchObject({
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
  });
});

function singleCommitInput(): VersionRevertInput {
  return {
    target: { kind: 'commit', commitId: COMMIT_A },
  };
}

import { jest } from '@jest/globals';

import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithVersioning,
} from './version-apply-merge-test-utils';

export function registerApplyMergeValidationTargetOptionsTests(): void {
  it('blocks apply mode before preview when target head fencing is incomplete', async () => {
    const merge = jest.fn();
    const version = workbookVersionWithVersioning({ mergeService: { merge } });

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' }),
        ]),
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it.each([
    ['targetRef', { expectedTargetHead: EXPECTED_TARGET_HEAD, materializeActiveCheckout: true }],
    ['expectedTargetHead', { targetRef: TARGET_REF, materializeActiveCheckout: true }],
  ] as const)(
    'blocks materializeActiveCheckout apply mode before preview or writes when %s is omitted',
    async (_label, options) => {
      const merge = jest.fn();
      const fastForwardMerge = jest.fn();
      const mergeCommit = jest.fn();
      const checkout = jest.fn();
      const version = workbookVersionWithVersioning({
        checkoutService: { checkout },
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
      });

      await expect(
        version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, options),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_INVALID_OPTIONS',
              message: 'materializeActiveCheckout requires targetRef and expectedTargetHead.',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  option: 'materializeActiveCheckout',
                }),
                mutationGuarantee: 'no-write-attempted',
              }),
            }),
          ],
        },
      });
      expect(merge).not.toHaveBeenCalled();
      expect(fastForwardMerge).not.toHaveBeenCalled();
      expect(mergeCommit).not.toHaveBeenCalled();
      expect(checkout).not.toHaveBeenCalled();
    },
  );

  it('blocks preview mode materializeActiveCheckout=true before preview or writes', async () => {
    const merge = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const checkout = jest.fn();
    const version = workbookVersionWithVersioning({
      checkoutService: { checkout },
      mergeService: { merge },
      writeService: { fastForwardMerge, mergeCommit },
    });

    await expect(
      version.applyMerge({ base: BASE, ours: OURS, theirs: THEIRS }, {
        mode: 'preview',
        materializeActiveCheckout: true,
      } as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            message: 'materializeActiveCheckout is valid only in apply mode.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                option: 'materializeActiveCheckout',
              }),
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
  });

  it.each(['refs/heads/not-applyable.lock', 'refs/heads/main/not-applyable'])(
    'blocks unsafe apply mode targetRef %s before preview or writes',
    async (targetRef) => {
      const merge = jest.fn();
      const fastForwardMerge = jest.fn();
      const mergeCommit = jest.fn();
      const version = workbookVersionWithVersioning({
        mergeService: { merge },
        writeService: { fastForwardMerge, mergeCommit },
      });

      await expect(
        version.applyMerge(
          { base: BASE, ours: OURS, theirs: THEIRS },
          { targetRef: targetRef as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_INVALID_OPTIONS',
              data: expect.objectContaining({
                redacted: true,
                mutationGuarantee: 'no-write-attempted',
              }),
            }),
          ],
        },
      });
      expect(merge).not.toHaveBeenCalled();
      expect(fastForwardMerge).not.toHaveBeenCalled();
      expect(mergeCommit).not.toHaveBeenCalled();
    },
  );
}

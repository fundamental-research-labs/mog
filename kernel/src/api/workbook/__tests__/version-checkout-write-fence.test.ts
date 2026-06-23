import { jest } from '@jest/globals';

import {
  createMockCtx,
  createWorkbook,
  plannedCheckoutResult,
} from './version-checkout-test-utils';

describe('WorkbookVersion checkout write fence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('holds the workbook checkout write fence while the service materializes', async () => {
    const commitId = `commit:sha256:${'5'.repeat(64)}`;
    let wb: ReturnType<typeof createWorkbook>;
    const observedStatusRevisions: string[] = [];
    const checkout = jest.fn(async () => {
      const status = await wb.version.getSurfaceStatus();
      observedStatusRevisions.push(status.dirty.statusRevision);
      return plannedCheckoutResult(commitId);
    });
    wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    const beforeStatus = await wb.version.getSurfaceStatus();
    expect(beforeStatus.dirty.statusRevision).toContain('checkout:idle');
    expect(beforeStatus.dirty.checkoutSafe).toBe(true);

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: true,
      value: {
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
      },
    });

    expect(observedStatusRevisions).toEqual([expect.stringContaining('checkout:busy')]);
    const afterStatus = await wb.version.getSurfaceStatus();
    expect(afterStatus.dirty.statusRevision).toContain('checkout:idle');
    expect(afterStatus.dirty.checkoutSafe).toBe(true);
  });

  it('releases the workbook checkout write fence when the service throws', async () => {
    const commitId = `commit:sha256:${'6'.repeat(64)}`;
    const checkout = jest
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('provider unavailable');
      })
      .mockImplementationOnce(async () => plannedCheckoutResult(commitId));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_PROVIDER_ERROR',
          }),
        ],
      },
    });
    const afterFailureStatus = await wb.version.getSurfaceStatus();
    expect(afterFailureStatus.dirty.statusRevision).toContain('checkout:idle');
    expect(afterFailureStatus.dirty.checkoutSafe).toBe(true);

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: true,
      value: {
        materialization: 'planned',
      },
    });
    expect(checkout).toHaveBeenCalledTimes(2);
  });

  it('fails closed before checkout service calls when the write fence cannot be acquired', async () => {
    const checkout = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        writeGate: {
          assertWritable: jest.fn(() => {
            throw new Error('read only');
          }),
        },
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    await expect(
      wb.version.checkout({ kind: 'commit', id: `commit:sha256:${'7'.repeat(64)}` }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE',
            data: expect.objectContaining({
              payload: expect.objectContaining({ reason: 'writeGateRejected' }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
  });
});

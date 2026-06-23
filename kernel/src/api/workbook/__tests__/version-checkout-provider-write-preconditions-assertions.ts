import { expect } from '@jest/globals';

export type ProviderWritePreconditionCounts = {
  readonly pendingRemoteSegmentCount?: number;
  readonly remoteSyncApplyActiveCount?: number;
  readonly pendingRemotePromotionActiveCount?: number;
};

type CheckoutProviderWritePreconditionWorkbook = {
  readonly version: {
    getSurfaceStatus(): Promise<unknown>;
    checkout(input: { readonly kind: 'head' }): Promise<unknown>;
  };
};

export async function expectCheckoutBlockedByProviderWrites(
  wb: CheckoutProviderWritePreconditionWorkbook,
  counts: ProviderWritePreconditionCounts,
): Promise<void> {
  await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
    dirty: {
      pendingProviderWrites: true,
      checkoutSafe: false,
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWrites',
          data: expect.objectContaining(counts),
        }),
      ],
    },
  });

  await expect(wb.version.checkout({ kind: 'head' })).resolves.toMatchObject({
    ok: false,
    error: {
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
          data: expect.objectContaining({
            payload: expect.objectContaining({
              reason: 'pendingProviderWrites',
              ...counts,
            }),
          }),
        }),
      ],
    },
  });
}

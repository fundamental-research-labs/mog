import { jest } from '@jest/globals';

import { createMockCtx, createMockEventBus, createWorkbook } from './version-checkout-test-utils';

describe('WorkbookVersion checkout facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('degrades without fabricating workbook state when no checkout service is attached', async () => {
    const wb = createWorkbook();

    await expect(
      wb.version.checkout({ kind: 'commit', id: `commit:sha256:${'1'.repeat(64)}` }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              redacted: true,
              payload: expect.objectContaining({ targetKind: 'commit' }),
            }),
          }),
        ],
      },
    });
  });

  it('rejects dirty checkout before calling the attached checkout service', async () => {
    const eventBus = createMockEventBus();
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const wb = createWorkbook({
      eventBus,
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout, planCheckout },
        },
      }),
    });

    eventBus.emit({ type: 'test:dirty' });
    const result = await wb.version.checkout({
      kind: 'commit',
      id: `commit:sha256:${'3'.repeat(64)}`,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
            data: expect.objectContaining({ recoverability: 'none', redacted: true }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });

  it('rejects requireClean:false without invoking checkout services', async () => {
    const checkout = jest.fn();
    const planCheckout = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout, planCheckout },
        },
      }),
    });

    const result = await wb.version.checkout(
      { kind: 'commit', id: `commit:sha256:${'4'.repeat(64)}` },
      { requireClean: false },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              payload: expect.objectContaining({ option: 'requireClean' }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(planCheckout).not.toHaveBeenCalled();
  });
});

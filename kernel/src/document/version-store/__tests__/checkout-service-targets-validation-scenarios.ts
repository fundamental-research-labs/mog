import type { CheckoutMaterializationRequest } from '../checkout-service';

import { commit, createStores, expectPlanFailed } from './checkout-service-test-helpers';
import {
  createTargetCheckoutService,
  createTrackedCommitReader,
} from './checkout-service-targets-helpers';

export function registerCheckoutServiceTargetValidationScenarios(): void {
  it('rejects invalid and detached target grammar without reading commits', async () => {
    const stores = createStores();
    const { commitReader, readCommit } = createTrackedCommitReader(stores);
    const service = createTargetCheckoutService(stores, { commitReader });

    const invalidCommit = await service.planCheckout({
      target: 'commit',
      commitId: 'not-a-commit',
    });
    const detached = await service.planCheckout({
      target: 'detached',
      commitId: commit('aa'),
    } as unknown as CheckoutMaterializationRequest);

    expectPlanFailed(invalidCommit);
    expect(invalidCommit.error.code).toBe('invalidCheckoutTarget');
    expect(invalidCommit.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_INVALID_TARGET',
    });
    expectPlanFailed(detached);
    expect(detached.error.code).toBe('unsupportedCheckoutTarget');
    expect(detached.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED',
    });
    expect(readCommit).not.toHaveBeenCalled();
  });

  it('redacts malformed ref target diagnostics before reading commits', async () => {
    const stores = createStores();
    const { commitReader, readCommit } = createTrackedCommitReader(stores);
    const rawRefName = 'scenario/Secret Branch';
    const service = createTargetCheckoutService(stores, { commitReader });

    const result = await service.planCheckout({
      target: 'ref',
      refName: rawRefName,
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('invalidCheckoutTarget');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_INVALID_TARGET',
      details: {
        received: 'redacted',
        receivedKind: 'string',
        redacted: true,
      },
      sourceDiagnostics: expect.arrayContaining([
        expect.objectContaining({
          value: 'redacted',
        }),
      ]),
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain(rawRefName);
    expect(JSON.stringify(result.diagnostics)).not.toContain('Secret');
    expect(readCommit).not.toHaveBeenCalled();
  });
}

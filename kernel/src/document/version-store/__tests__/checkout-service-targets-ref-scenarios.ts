import { createInMemoryRefStore } from '../refs/ref-store';

import {
  AUTHOR,
  NAMESPACE,
  createCommitFixture,
  createStores,
  expectMutationOk,
  expectPlanFailed,
  expectPlanOk,
} from './checkout-service-test-helpers';
import {
  createTargetCheckoutService,
  createTrackedCommitReader,
} from './checkout-service-targets-helpers';

export function registerCheckoutServiceTargetRefScenarios(): void {
  it('returns missing-ref diagnostics before commit reads', async () => {
    const stores = createStores();
    const { commitReader, readCommit } = createTrackedCommitReader(stores);
    const service = createTargetCheckoutService(stores, {
      commitReader,
      refReader: {
        readRef: () => ({ ok: true, ref: null, diagnostics: [] }),
      },
    });

    const result = await service.planCheckout({
      target: 'ref',
      refName: 'scenario/missing',
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutRefNotFound');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_MISSING_REF',
      refName: 'scenario/missing',
    });
    expect(readCommit).not.toHaveBeenCalled();
  });

  it('does not mutate ref state while resolving a checkout plan', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'main');
    const refStore = createInMemoryRefStore({
      versionDocumentId: NAMESPACE.documentId,
      now: () => '2026-06-20T00:00:00.000Z',
    });
    const main = refStore.initializeMain({ targetCommitId: fixture.commit.id, createdBy: AUTHOR });
    expectMutationOk(main);
    const before = refStore.getRef('main');
    const attemptedWrites: string[] = [];
    const service = createTargetCheckoutService(stores, {
      refReader: {
        readRef: (refName) => refStore.getRef(refName),
      },
    });

    const result = await service.planCheckout({ target: 'ref', refName: 'main' });

    expectPlanOk(result);
    expect(refStore.getRef('main')).toEqual(before);
    expect(attemptedWrites).toEqual([]);
  });
}

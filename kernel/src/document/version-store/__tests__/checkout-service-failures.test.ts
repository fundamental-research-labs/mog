import { createCheckoutMaterializationService } from '../checkout-service';

import {
  commit,
  createCommitFixture,
  createService,
  createStores,
  expectPlanFailed,
} from './checkout-service-test-helpers';

describe('CheckoutMaterializationService planning', () => {
  it('preserves missing-commit diagnostics from the supplied commit reader', async () => {
    const stores = createStores();
    const service = createService(stores);

    const result = await service.planCheckout({
      target: 'commit',
      commitId: commit('ee'),
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutCommitNotFound');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_MISSING_COMMIT',
      commitId: commit('ee'),
      sourceDiagnostics: [
        expect.objectContaining({
          code: 'VERSION_OBJECT_STORE_FAILURE',
        }),
      ],
    });
  });

  it('rejects commits with blocking materialization completeness diagnostics', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'unsupported-domain', {
      completenessDiagnostics: [
        {
          code: 'opaqueDomainUnsupported',
          severity: 'error',
          message: 'Opaque domain cannot be materialized.',
          path: 'opaqueDomains[0]',
        },
      ],
    });
    const service = createService(stores);

    const result = await service.planCheckout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutCommitUnmaterializable');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
      commitId: fixture.commit.id,
      sourceDiagnostics: [
        expect.objectContaining({
          code: 'opaqueDomainUnsupported',
          severity: 'error',
        }),
      ],
    });
  });

  it('returns missing dependency diagnostics when materialization objects are absent', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'missing-dependency');
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) =>
          dependency.kind === 'object' && dependency.objectType === 'workbook.semanticChangeSet.v1'
            ? false
            : stores.objectStore.hasObject(dependency),
      },
    });

    const result = await service.planCheckout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutDependencyMissing');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_CHECKOUT_MISSING_DEPENDENCY',
        commitId: fixture.commit.id,
        objectDigest: fixture.semanticChangeSetRecord.digest,
        dependency: {
          kind: 'object',
          objectType: 'workbook.semanticChangeSet.v1',
          digest: fixture.semanticChangeSetRecord.digest,
        },
      }),
    ]);
  });
});

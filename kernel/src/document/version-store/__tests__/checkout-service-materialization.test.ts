import { jest } from '@jest/globals';

import { createCheckoutMaterializationService } from '../checkout-service';

import {
  createCommitFixture,
  createStores,
  expectPlanFailed,
  expectPlanOk,
} from './checkout-service-test-helpers';

describe('CheckoutMaterializationService planning', () => {
  it('applies a full-snapshot checkout only through an attached snapshot materializer', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'apply-root');
    const applySnapshot = jest.fn(async () => ({
      status: 'applied' as const,
      diagnostics: [
        {
          code: 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC' as const,
          severity: 'info' as const,
          message: 'Applied fixture snapshot.',
          commitId: fixture.commit.id,
        },
      ],
    }));
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      snapshotReader: {
        readSnapshotRoot: (dependency) => stores.objectStore.getObjectRecord(dependency),
      },
      snapshotMaterializer: {
        applySnapshot,
      },
    });

    const result = await service.checkout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanOk(result);
    expect(result.materialization).toBe('applied');
    expect(result.mutationGuarantee).toBe('workbook-state-materialized');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC',
        commitId: fixture.commit.id,
      }),
    ]);
    expect(applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'fullSnapshot',
        commitId: fixture.commit.id,
        snapshotRoot: {
          label: 'apply-root',
          sheets: [],
        },
        plan: expect.objectContaining({
          commitId: fixture.commit.id,
          snapshotRootDigest: fixture.snapshotRootRecord.digest,
        }),
      }),
    );
  });

  it('reports partial-mutation uncertainty when the snapshot materializer throws', async () => {
    const stores = createStores();
    const fixture = await createCommitFixture(stores, 'apply-failure');
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      snapshotReader: {
        readSnapshotRoot: (dependency) => stores.objectStore.getObjectRecord(dependency),
      },
      snapshotMaterializer: {
        applySnapshot: async () => {
          throw new Error('materializer failed');
        },
      },
    });

    const result = await service.checkout({
      target: 'commit',
      commitId: fixture.commit.id,
    });

    expectPlanFailed(result);
    expect(result.error.code).toBe('checkoutSnapshotApplyFailed');
    expect(result.mutationGuarantee).toBe('unknown-after-partial-mutation');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
        commitId: fixture.commit.id,
      }),
    ]);
  });
});

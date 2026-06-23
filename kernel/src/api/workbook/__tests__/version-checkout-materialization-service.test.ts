import { jest } from '@jest/globals';

import { createCheckoutMaterializationService } from '../../../document/version-store/checkout-service';
import {
  createCommit,
  createMockCtx,
  createStores,
  createWorkbook,
} from './version-checkout-test-utils';

describe('WorkbookVersion checkout materialization service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates through an attached CheckoutMaterializationService and returns a public plan', async () => {
    const stores = createStores();
    const commit = await createCommit(stores, 'root');
    const checkoutService = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });
    const planCheckout = jest.spyOn(checkoutService, 'planCheckout');
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService,
        },
      }),
    });

    const result = await wb.version.checkout({ kind: 'commit', id: commit.id });

    expect(planCheckout).toHaveBeenCalledWith({ target: 'commit', commitId: commit.id });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          strategy: 'fullSnapshot',
          commitId: commit.id,
          parentCommitIds: [],
          target: {
            kind: 'commit',
            commitId: commit.id,
          },
          requiredDependencies: [
            { role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' },
            { role: 'semanticChangeSet', objectType: 'workbook.semanticChangeSet.v1' },
          ],
          requiredDependencyCount: 2,
        },
        diagnostics: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('digest');
  });

  it('falls back to a public plan when the attached service has no snapshot materializer', async () => {
    const stores = createStores();
    const commit = await createCommit(stores, 'plan-only-root');
    const checkoutService = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });
    const checkout = jest.spyOn(checkoutService, 'checkout');
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService,
        },
      }),
    });

    const result = await wb.version.checkout({ kind: 'commit', id: commit.id });

    expect(checkout).toHaveBeenCalledWith({ target: 'commit', commitId: commit.id });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        mutationGuarantee: 'no-workbook-mutation',
        plan: {
          commitId: commit.id,
        },
      },
    });
  });

  it('maps applied checkout results from an attached snapshot materializer', async () => {
    const stores = createStores();
    const commit = await createCommit(stores, 'applied-root');
    const applySnapshot = jest.fn(async () => ({ status: 'applied' as const }));
    const checkoutService = createCheckoutMaterializationService({
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
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService,
        },
      }),
    });

    const result = await wb.version.checkout({ kind: 'commit', id: commit.id });

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
        plan: {
          commitId: commit.id,
        },
        diagnostics: [],
      },
    });
    expect(applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        commitId: commit.id,
        snapshotRoot: {
          label: 'applied-root',
          sheets: [],
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('digest');
  });
});

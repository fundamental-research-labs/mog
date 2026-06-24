import { describe, expect, it, jest } from '@jest/globals';
import type { VersionCheckoutTarget } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import type {
  ActiveCheckoutMaterializationRecord,
  ActiveCheckoutMaterializationStore,
} from '../../../document/version-store/active-checkout-materialization-store';
import type {
  CheckoutMaterializationResult,
  CheckoutResolvedMaterializationTarget,
} from '../../../document/version-store/checkout-service';
import type { ObjectDigest, WorkbookCommitId } from '../../../document/version-store/object-digest';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import type { RefName } from '../../../document/version-store/refs/ref-name';
import { checkoutWorkbookVersion } from '../version-checkout';
import { withVersionManifest } from './version-domain-support-test-utils';

const OLD_COMMIT_ID = commitId('1');
const DETACHED_COMMIT_ID = commitId('2');
const FEATURE_COMMIT_ID = commitId('3');
const FAILED_COMMIT_ID = commitId('4');
const FEATURE_BRANCH = 'scenario/active-checkout-marker-lifecycle';
const FEATURE_REF = 'refs/heads/scenario/active-checkout-marker-lifecycle';
const SNAPSHOT_DIGEST = objectDigest('a');
const SEMANTIC_DIGEST = objectDigest('b');

describe('WorkbookVersion active checkout marker lifecycle', () => {
  it('clears a durable attached marker after explicit detached commit checkout', async () => {
    const { ctx, store } = await createCheckoutHarness({
      result: appliedCheckoutResult({
        kind: 'commit',
        commitId: DETACHED_COMMIT_ID,
      }),
    });
    await seedAttachedMarker(store);

    const result = await checkoutWorkbookVersion(ctx, {
      kind: 'commit',
      id: DETACHED_COMMIT_ID,
    } as VersionCheckoutTarget);

    expect(result).toMatchObject({
      status: 'success',
      materialization: 'applied',
      plan: {
        target: { kind: 'commit', commitId: DETACHED_COMMIT_ID },
      },
    });
    await expect(store.read()).resolves.toBeNull();
  });

  it('rewrites the durable marker after explicit attached ref checkout', async () => {
    const { ctx, store } = await createCheckoutHarness({
      result: appliedCheckoutResult({
        kind: 'ref',
        refName: FEATURE_BRANCH as RefName,
        commitId: FEATURE_COMMIT_ID,
        refVersion: { kind: 'counter', value: '7' },
        refIncarnationId: 'ref-incarnation:active-checkout-marker-lifecycle',
      }),
    });
    await seedAttachedMarker(store);

    const result = await checkoutWorkbookVersion(ctx, {
      kind: 'ref',
      name: FEATURE_REF,
    } as VersionCheckoutTarget);

    expect(result).toMatchObject({
      status: 'success',
      materialization: 'applied',
      plan: {
        target: {
          kind: 'ref',
          refName: FEATURE_REF,
          commitId: FEATURE_COMMIT_ID,
        },
      },
    });
    await expect(store.read()).resolves.toMatchObject({
      checkedOutCommitId: FEATURE_COMMIT_ID,
      branchName: 'scenario/active-checkout-marker-lifecycle',
      refHeadAtMaterialization: FEATURE_COMMIT_ID,
    });
  });

  it('clears the old durable marker when attached ref marker rewrite fails', async () => {
    const store = createWriteFailingAttachedMarkerStore();
    const { ctx } = await createCheckoutHarness({
      store,
      result: appliedCheckoutResult({
        kind: 'ref',
        refName: FEATURE_BRANCH as RefName,
        commitId: FEATURE_COMMIT_ID,
        refVersion: { kind: 'counter', value: '8' },
        refIncarnationId: 'ref-incarnation:active-checkout-marker-write-failure',
      }),
    });

    const result = await checkoutWorkbookVersion(ctx, {
      kind: 'ref',
      name: FEATURE_REF,
    } as VersionCheckoutTarget);

    expect(result).toMatchObject({
      status: 'success',
      materialization: 'applied',
    });
    await expect(store.read()).resolves.toBeNull();
  });

  it('clears the durable marker after rollback-safe checkout materialization failure', async () => {
    const { ctx, store } = await createCheckoutHarness({
      result: {
        ok: false,
        error: {
          code: 'checkoutSnapshotApplyFailed',
          message: 'Checkout materializer rejected the target before publishing.',
        },
        diagnostics: [
          {
            code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
            severity: 'error',
            message: 'Checkout materializer rejected the target before publishing.',
            commitId: FAILED_COMMIT_ID,
            details: { cause: 'rollbackSafeGap' },
          },
        ],
        mutationGuarantee: 'no-workbook-mutation',
      },
    });
    await seedAttachedMarker(store);

    const result = await checkoutWorkbookVersion(ctx, {
      kind: 'commit',
      id: FAILED_COMMIT_ID,
    } as VersionCheckoutTarget);

    expect(result).toMatchObject({
      status: 'degraded',
      mutationGuarantee: 'no-workbook-mutation',
    });
    await expect(store.read()).resolves.toBeNull();
  });
});

async function createCheckoutHarness(input: {
  readonly result: CheckoutMaterializationResult;
  readonly store?: ActiveCheckoutMaterializationStore;
}) {
  let store: ActiveCheckoutMaterializationStore;
  let provider: {
    readonly openActiveCheckoutMaterializationStore: () => Promise<ActiveCheckoutMaterializationStore>;
  };
  if (input.store) {
    store = input.store;
    provider = {
      openActiveCheckoutMaterializationStore: async () => store,
    };
  } else {
    const inMemoryProvider = createInMemoryVersionStoreProvider({
      documentScope: {
        documentId: `active-checkout-marker-lifecycle-${Math.random().toString(36).slice(2)}`,
      },
    });
    store = await inMemoryProvider.openActiveCheckoutMaterializationStore();
    provider = inMemoryProvider;
  }
  const checkout = jest.fn(async () => input.result);
  const ctx = {
    versioning: withVersionManifest({
      provider,
      checkoutService: { checkout },
    }),
  } as unknown as DocumentContext;

  return { ctx, store, checkout };
}

async function seedAttachedMarker(store: ActiveCheckoutMaterializationStore): Promise<void> {
  await store.write({
    checkedOutCommitId: OLD_COMMIT_ID,
    branchName: 'main',
    refHeadAtMaterialization: OLD_COMMIT_ID,
    updatedAt: '2026-06-24T00:00:00.000Z',
  });
}

function createWriteFailingAttachedMarkerStore(): ActiveCheckoutMaterializationStore {
  let record: ActiveCheckoutMaterializationRecord | null = {
    documentScopeKey: 'active-checkout-marker-lifecycle',
    checkedOutCommitId: OLD_COMMIT_ID,
    branchName: 'main',
    refHeadAtMaterialization: OLD_COMMIT_ID,
    updatedAt: '2026-06-24T00:00:00.000Z',
  };
  return {
    async read() {
      return record ? Object.freeze({ ...record }) : null;
    },
    async write(_record: Omit<ActiveCheckoutMaterializationRecord, 'documentScopeKey'>) {
      throw new Error('injected active checkout marker write failure');
    },
    async clear() {
      record = null;
    },
  };
}

function appliedCheckoutResult(
  target: CheckoutResolvedMaterializationTarget,
): CheckoutMaterializationResult {
  return {
    ok: true,
    materialization: 'applied',
    plan: {
      strategy: 'fullSnapshot',
      resolvedTarget: target,
      commitId: target.commitId,
      parentCommitIds: [],
      snapshotRootDigest: SNAPSHOT_DIGEST,
      semanticChangeSetDigest: SEMANTIC_DIGEST,
      mutationSegmentDigests: [],
      requiredDependencies: [
        {
          role: 'snapshotRoot',
          objectType: 'workbook.snapshotRoot.v1',
          digest: SNAPSHOT_DIGEST,
        },
        {
          role: 'semanticChangeSet',
          objectType: 'workbook.semanticChangeSet.v1',
          digest: SEMANTIC_DIGEST,
        },
      ],
      requiredDependencyDigests: [SNAPSHOT_DIGEST, SEMANTIC_DIGEST],
    },
    diagnostics: [],
    mutationGuarantee: 'workbook-state-materialized',
  };
}

function commitId(hex: string): WorkbookCommitId {
  return `commit:sha256:${hex.repeat(64)}` as WorkbookCommitId;
}

function objectDigest(hex: string): ObjectDigest {
  return {
    algorithm: 'sha256',
    digest: hex.repeat(64),
  };
}

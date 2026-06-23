import { jest } from '@jest/globals';

import {
  createCheckoutMaterializationService,
  type CheckoutMaterializationRequest,
} from '../checkout-service';
import { createInMemoryRefStore } from '../ref-store';

import {
  AUTHOR,
  NAMESPACE,
  commit,
  createCommitFixture,
  createStores,
  expectMutationOk,
  expectPlanFailed,
  expectPlanOk,
  refVersion,
} from './checkout-service-test-helpers';

describe('CheckoutMaterializationService planning', () => {
  it('resolves HEAD and main through supplied readers before reading commits', async () => {
    const stores = createStores();
    const root = await createCommitFixture(stores, 'root');
    const child = await createCommitFixture(stores, 'child', {
      parentCommitIds: [root.commit.id],
    });
    const refStore = createInMemoryRefStore({
      versionDocumentId: NAMESPACE.documentId,
      now: () => '2026-06-20T00:00:00.000Z',
    });
    const main = refStore.initializeMain({ targetCommitId: root.commit.id, createdBy: AUTHOR });
    expectMutationOk(main);

    const calls: string[] = [];
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      headReader: {
        readHead: () => {
          calls.push('head');
          return {
            ok: true,
            head: {
              mode: 'attached',
              refName: 'scenario/work',
              commitId: child.commit.id,
              refVersion: refVersion('7'),
              refIncarnationId: 'ref-incarnation:scenario-work',
            },
            diagnostics: [],
          };
        },
      },
      refReader: {
        readRef: (refName) => {
          calls.push(`ref:${refName}`);
          return refStore.getRef(refName);
        },
      },
    });

    const head = await service.planCheckout({ target: 'ref', refName: 'HEAD' });
    const mainResult = await service.planCheckout({ target: 'ref', refName: 'main' });

    expectPlanOk(head);
    expectPlanOk(mainResult);
    expect(head.plan.resolvedTarget).toEqual({
      kind: 'head',
      refName: 'scenario/work',
      commitId: child.commit.id,
      refVersion: refVersion('7'),
      refIncarnationId: 'ref-incarnation:scenario-work',
    });
    expect(mainResult.plan.resolvedTarget).toMatchObject({
      kind: 'ref',
      refName: 'main',
      commitId: root.commit.id,
      refVersion: main.ref.refVersion,
      refIncarnationId: main.ref.refIncarnationId,
    });
    expect(calls).toEqual(['head', 'ref:main']);
  });

  it('rejects invalid and detached target grammar without reading commits', async () => {
    const stores = createStores();
    const readCommit = jest.fn(stores.commitStore.readCommit.bind(stores.commitStore));
    const service = createCheckoutMaterializationService({
      commitReader: { readCommit },
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });

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
    const readCommit = jest.fn(stores.commitStore.readCommit.bind(stores.commitStore));
    const rawRefName = 'scenario/Secret Branch';
    const service = createCheckoutMaterializationService({
      commitReader: { readCommit },
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });

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

  it('returns missing-ref diagnostics before commit reads', async () => {
    const stores = createStores();
    const readCommit = jest.fn(stores.commitStore.readCommit.bind(stores.commitStore));
    const service = createCheckoutMaterializationService({
      commitReader: { readCommit },
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
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
    const service = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
      refReader: {
        readRef: (refName) => refStore.getRef(refName),
      },
    });

    const result = await service.planCheckout({ target: 'ref', refName: 'main' });

    expectPlanOk(result);
    expect(refStore.getRef('main')).toEqual(before);
    expect(attemptedWrites).toEqual([]);
  });
});

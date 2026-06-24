import { createInMemoryRefStore } from '../refs/ref-store';

import {
  AUTHOR,
  NAMESPACE,
  createCommitFixture,
  createStores,
  expectMutationOk,
  expectPlanOk,
  refVersion,
} from './checkout-service-test-helpers';
import { createTargetCheckoutService } from './checkout-service-targets-helpers';

export function registerCheckoutServiceTargetResolutionScenarios(): void {
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
    const service = createTargetCheckoutService(stores, {
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
}

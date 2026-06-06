import { ViewportCoordinatorRegistry } from '../viewport-coordinator-registry';
import { VALUE_TYPE_NUMBER } from '../binary-viewport-buffer';
import { buildPackedMultiViewportPatches, buildTestMutationBuffer } from '../mutation-test-builder';

describe('ViewportCoordinatorRegistry hydration backfill', () => {
  it('fires the handler immediately when a registered coordinator has no buffer', () => {
    const registry = new ViewportCoordinatorRegistry();
    let handlerCallCount = 0;
    registry.setOnHydrationDeficit(() => {
      handlerCallCount += 1;
    });

    const coordinator = registry.register('main');
    expect(coordinator.base.hasBuffer()).toBe(false);

    const mutation = buildTestMutationBuffer({
      patches: [{ row: 0, col: 0, numberValue: 7, display: '7', flags: VALUE_TYPE_NUMBER }],
    });
    const packed = buildPackedMultiViewportPatches([
      { viewportId: 'main', mutationBuffer: mutation },
    ]);
    registry.applyMultiViewportPatches(packed);

    expect(handlerCallCount).toBe(1);
    expect(registry.hasHydrationDeficit).toBe(false);
  });
});

import { jest } from '@jest/globals';
import { DocumentLifecycleSystem } from '../document-lifecycle-system';

type SchedulerHarness = Pick<
  DocumentLifecycleSystem,
  'scheduleDeferredHydration' | 'ensureDeferredHydration'
> & {
  actor: { getSnapshot: () => { context: { computeBridge: unknown; rustDocument?: unknown } } };
  deferredHydrationPending: boolean;
  deferredHydrationPromise: Promise<void> | null;
  deferredHydrationTimer: ReturnType<typeof setTimeout> | null;
  startDeferredHydrationNow: (() => void) | null;
  hostLifecycleInput: unknown;
  environment: 'browser' | 'headless';
  importDurabilityPending: boolean;
};

function createSchedulerHarness(completeDeferredHydration: jest.Mock): SchedulerHarness {
  const harness = Object.create(DocumentLifecycleSystem.prototype) as SchedulerHarness;
  harness.actor = {
    getSnapshot: () => ({
      context: {
        computeBridge: {
          completeDeferredHydration,
        },
      },
    }),
  };
  harness.deferredHydrationPending = true;
  harness.deferredHydrationPromise = null;
  harness.deferredHydrationTimer = null;
  harness.startDeferredHydrationNow = null;
  harness.hostLifecycleInput = {};
  harness.environment = 'browser';
  harness.importDurabilityPending = false;
  return harness;
}

describe('DocumentLifecycleSystem deferred hydration scheduling', () => {
  it('promotes host-backed background hydration when an explicit durability barrier waits', async () => {
    const completeDeferredHydration = jest.fn().mockResolvedValue(undefined);
    const harness = createSchedulerHarness(completeDeferredHydration);

    const scheduled = harness.scheduleDeferredHydration();

    expect(completeDeferredHydration).not.toHaveBeenCalled();

    await harness.ensureDeferredHydration();
    await scheduled;

    expect(completeDeferredHydration).toHaveBeenCalledTimes(1);
    expect(harness.deferredHydrationPending).toBe(false);
    expect(harness.importDurabilityPending).toBe(false);
    expect(harness.deferredHydrationTimer).toBeNull();
    expect(harness.startDeferredHydrationNow).toBeNull();
  });
});

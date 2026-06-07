import { jest } from '@jest/globals';
import type { SheetId } from '@mog-sdk/contracts/core';
import { DocumentLifecycleSystem } from '../document-lifecycle-system';

type SchedulerHarness = Pick<
  DocumentLifecycleSystem,
  | 'scheduleDeferredHydration'
  | 'ensureDeferredHydration'
  | 'awaitMaterialized'
  | 'getMaterializationState'
> & {
  actor: {
    getSnapshot: () => {
      context: {
        computeBridge: unknown;
        rustDocument?: unknown;
        initialSheetIds: string[];
      };
      matches: (state: string) => boolean;
      value: string;
    };
  };
  deferredHydrationPending: boolean;
  deferredHydrationPromise: Promise<void> | null;
  deferredHydrationTimer: ReturnType<typeof setTimeout> | null;
  startDeferredHydrationNow: (() => void) | null;
  hostLifecycleInput: unknown;
  environment: 'browser' | 'headless';
  importDurabilityPending: boolean;
  materializationError: null;
};

function createSchedulerHarness(completeDeferredHydration: jest.Mock): SchedulerHarness {
  const harness = Object.create(DocumentLifecycleSystem.prototype) as SchedulerHarness;
  harness.actor = {
    getSnapshot: () => ({
      context: {
        computeBridge: {
          completeDeferredHydration,
        },
        initialSheetIds: ['critical-sheet', 'secondary-sheet'],
      },
      matches: (state: string) => state === 'ready',
      value: 'ready',
    }),
  };
  harness.deferredHydrationPending = true;
  harness.deferredHydrationPromise = null;
  harness.deferredHydrationTimer = null;
  harness.startDeferredHydrationNow = null;
  harness.hostLifecycleInput = {};
  harness.environment = 'browser';
  harness.importDurabilityPending = false;
  harness.materializationError = null;
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

  it('does not force full hydration for the already materialized critical sheet', async () => {
    const completeDeferredHydration = jest.fn().mockResolvedValue(undefined);
    const harness = createSchedulerHarness(completeDeferredHydration);

    await harness.awaitMaterialized('critical-sheet' as SheetId);

    expect(completeDeferredHydration).not.toHaveBeenCalled();
    expect(harness.deferredHydrationPromise).toBeNull();
    expect(harness.getMaterializationState()).toMatchObject({
      phase: 'CriticalSheetReady',
      isDeferred: true,
      isMaterialized: false,
      pendingScope: 'allSheets',
      initialActiveSheetId: 'critical-sheet',
    });
  });

  it('forces full hydration for a non-critical sheet-scoped barrier', async () => {
    const completeDeferredHydration = jest.fn().mockResolvedValue(undefined);
    const harness = createSchedulerHarness(completeDeferredHydration);

    await harness.awaitMaterialized('secondary-sheet' as SheetId);

    expect(completeDeferredHydration).toHaveBeenCalledTimes(1);
    expect(harness.deferredHydrationPending).toBe(false);
    expect(harness.importDurabilityPending).toBe(false);
  });

  it('reports all-sheets hydrating once the full hydration run is scheduled', async () => {
    const completeDeferredHydration = jest.fn().mockResolvedValue(undefined);
    const harness = createSchedulerHarness(completeDeferredHydration);

    const scheduled = harness.scheduleDeferredHydration();

    expect(harness.getMaterializationState()).toMatchObject({
      phase: 'AllSheetsHydrating',
      isDeferred: true,
      isMaterialized: false,
      pendingScope: 'allSheets',
      initialActiveSheetId: 'critical-sheet',
    });

    harness.startDeferredHydrationNow?.();
    await scheduled;
  });
});

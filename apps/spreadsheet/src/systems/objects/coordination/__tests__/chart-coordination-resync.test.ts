/**
 * Chart Coordination Sequencing Tests
 *
 * Verifies that setupChartCoordination's objectInteraction → chartActor
 * sync handles rapid emissions correctly:
 *
 * 1. Current chart selection always syncs into chartActor.
 * 2. Out-of-order async resolution must NOT overwrite a later emission's
 * SYNC_SELECTION send. lost selection after a real-UI gesture
 * because chart.list resolved out-of-order; sequences
 * emissions monotonically so a stale resolution drops its result.
 * 3. chart:selected/chart:deselected events fire only on membership change.
 *
 * The harness `selectChart()` no longer needs to detour through cell A1
 * because the monotonic seq guard
 * makes the chart-machine's selection state stable.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { setupChartCoordination, type ChartCoordinationConfig } from '../chart-coordination';

// =============================================================================
// Helpers
// =============================================================================

interface MockSubscriber {
  callbacks: Array<(state: unknown) => void>;
  emit: (state: unknown) => void;
}

function createMockSubscriber(): MockSubscriber {
  const callbacks: Array<(state: unknown) => void> = [];
  return {
    callbacks,
    emit: (state) => {
      for (const cb of callbacks) cb(state);
    },
  };
}

interface MockChartActor {
  send: jest.Mock;
}

interface MockEventBus {
  emit: jest.Mock;
}

interface SetupResult {
  chartActor: MockChartActor;
  eventBus: MockEventBus;
  setHasSelectedChartObject: jest.Mock;
  emitObjectState: (selectedIds: string[]) => Promise<void>;
  /** Async get() controller — call resolve() to release the deferred result. */
  emitObjectStateDeferred: (selectedIds: string[]) => { resolve: () => void };
  cleanup: () => void;
}

async function buildSetup(opts: {
  chartIds: string[];
  activeSheetChartIds?: string[];
  /** When true, ws.charts.get() returns a deferred promise the caller can resolve manually. */
  deferGet?: boolean;
}): Promise<SetupResult> {
  const chartActor: MockChartActor = { send: jest.fn() };
  const eventBus: MockEventBus = { emit: jest.fn() };
  const setHasSelectedChartObject = jest.fn();
  const subscriber = createMockSubscriber();

  const objectInteractionActor = {
    subscribe: (cb: (state: unknown) => void) => {
      subscriber.callbacks.push(cb);
      return { unsubscribe: () => {} };
    },
    getSnapshot: () => ({}),
  };

  const pendingResolvers: Array<() => void> = [];
  const ws = {
    sheetId: 'sheet-1',
    charts: {
      get: jest.fn().mockImplementation((id: string) => {
        if (!opts.deferGet) {
          return Promise.resolve(opts.chartIds.includes(id) ? { id } : null);
        }
        return new Promise<{ id: string } | null>((resolve) => {
          pendingResolvers.push(() => resolve(opts.chartIds.includes(id) ? { id } : null));
        });
      }),
    },
  };
  const activeSheetChartIds = opts.activeSheetChartIds ?? opts.chartIds;
  const activeSheet = {
    sheetId: 'stale-active-sheet',
    charts: {
      get: jest.fn().mockImplementation((id: string) => {
        return Promise.resolve(activeSheetChartIds.includes(id) ? { id } : null);
      }),
    },
  };
  const workbook = {
    getSheetById: jest.fn().mockReturnValue(ws),
    activeSheet,
  };

  const config: ChartCoordinationConfig = {
    chartActor: chartActor as unknown as ChartCoordinationConfig['chartActor'],
    selectionActor: {} as ChartCoordinationConfig['selectionActor'],
    objectInteractionActor:
      objectInteractionActor as unknown as ChartCoordinationConfig['objectInteractionActor'],
    getActiveSheetId: () => 'sheet-1',
    workbook: workbook as unknown as ChartCoordinationConfig['workbook'],
    eventBus: eventBus as unknown as ChartCoordinationConfig['eventBus'],
    setHasSelectedChartObject,
  };

  jest.doMock('../../machines/object-interaction-machine', () => ({
    getObjectInteractionSnapshot: (state: unknown) => state,
  }));

  const { cleanup } = setupChartCoordination(config);

  const emitObjectState = async (selectedIds: string[]): Promise<void> => {
    subscriber.emit({
      context: {
        selectedIds,
        activeHandle: null,
        editingObjectId: null,
        shiftKey: false,
        operation: null,
        insertShapeType: null,
        insertStartPosition: null,
        insertCurrentPosition: null,
      },
      value: 'idle',
      matches: () => false,
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const emitObjectStateDeferred = (selectedIds: string[]): { resolve: () => void } => {
    subscriber.emit({
      context: {
        selectedIds,
        activeHandle: null,
        editingObjectId: null,
        shiftKey: false,
        operation: null,
      },
      value: 'idle',
      matches: () => false,
    });
    const resolver = pendingResolvers[pendingResolvers.length - 1];
    return {
      resolve: () => {
        if (resolver) resolver();
      },
    };
  };

  return {
    chartActor,
    eventBus,
    setHasSelectedChartObject,
    emitObjectState,
    emitObjectStateDeferred,
    cleanup,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('setupChartCoordination — sequencing & membership', () => {
  afterEach(() => {
    jest.dontMock('../../machines/object-interaction-machine');
  });

  it('emits SYNC_SELECTION once on initial chart selection', async () => {
    const { chartActor, setHasSelectedChartObject, emitObjectState, cleanup } = await buildSetup({
      chartIds: ['chart-1'],
    });

    await emitObjectState(['chart-1']);

    const syncCalls = chartActor.send.mock.calls.filter((c) => c[0]?.type === 'SYNC_SELECTION');
    expect(syncCalls.length).toBe(1);
    expect(syncCalls[0][0].chartIds).toEqual(['chart-1']);
    expect(setHasSelectedChartObject).toHaveBeenLastCalledWith(true);

    cleanup();
  });

  it('resolves selected chart IDs against the getter active sheet', async () => {
    const { chartActor, setHasSelectedChartObject, emitObjectState, cleanup } = await buildSetup({
      chartIds: ['chart-1'],
      activeSheetChartIds: [],
    });

    await emitObjectState(['chart-1']);

    expect(chartActor.send).toHaveBeenLastCalledWith({
      type: 'SYNC_SELECTION',
      chartIds: ['chart-1'],
    });
    expect(setHasSelectedChartObject).toHaveBeenLastCalledWith(true);

    cleanup();
  });

  it('clears derived chart contextual-tab state when no chart is selected', async () => {
    const { setHasSelectedChartObject, emitObjectState, cleanup } = await buildSetup({
      chartIds: ['chart-1'],
    });

    await emitObjectState(['chart-1']);
    await emitObjectState([]);

    expect(setHasSelectedChartObject.mock.calls.map((call) => call[0])).toEqual([true, false]);

    cleanup();
  });

  it('re-syncs chartActor when membership is unchanged', async () => {
    const { chartActor, emitObjectState, cleanup } = await buildSetup({
      chartIds: ['chart-1'],
    });

    // Three identical emissions still sync. This is intentionally idempotent:
    // document reload can reset chartActor while imported chart IDs remain stable.
    await emitObjectState(['chart-1']);
    await emitObjectState(['chart-1']);
    await emitObjectState(['chart-1']);

    const syncCalls = chartActor.send.mock.calls.filter((c) => c[0]?.type === 'SYNC_SELECTION');
    expect(syncCalls.length).toBe(3);
    expect(syncCalls.map((c) => c[0].chartIds)).toEqual([['chart-1'], ['chart-1'], ['chart-1']]);

    cleanup();
  });

  it('emits chart:selected event on initial selection (membership change)', async () => {
    const { eventBus, emitObjectState, cleanup } = await buildSetup({
      chartIds: ['chart-1'],
    });

    await emitObjectState(['chart-1']);

    const selectedEvents = eventBus.emit.mock.calls.filter((c) => c[0]?.type === 'chart:selected');
    expect(selectedEvents.length).toBe(1);
    expect(selectedEvents[0][0].chartId).toBe('chart-1');

    cleanup();
  });

  it('emits chart:deselected event on selection clear (membership change)', async () => {
    const { eventBus, emitObjectState, cleanup } = await buildSetup({
      chartIds: ['chart-1'],
    });

    await emitObjectState(['chart-1']);
    await emitObjectState([]);

    const deselectedEvents = eventBus.emit.mock.calls.filter(
      (c) => c[0]?.type === 'chart:deselected',
    );
    expect(deselectedEvents.length).toBe(1);
    expect(deselectedEvents[0][0].chartId).toBe('chart-1');

    cleanup();
  });

  it('drops out-of-order async resolutions — later emission wins', async () => {
    // This test simulates the race: a rapid-fire sequence of
    // emissions ([] → [chartId] → [] → [chartId]) where chart.list()
    // resolves OUT OF ORDER. Without the seq guard, an early resolution
    // could overwrite a later emission, leaving chart-machine in 'idle'
    // even though selection IS stable.
    const { chartActor, emitObjectStateDeferred, cleanup } = await buildSetup({
      chartIds: ['chart-1'],
      deferGet: true,
    });

    // Fire two emissions back-to-back. Each selected chart emission calls ws.charts.get() which
    // returns a deferred promise. We resolve them out-of-order: the
    // SECOND emission's promise first, then the FIRST emission's promise.
    const e1 = emitObjectStateDeferred([]); // first: empty selection
    const e2 = emitObjectStateDeferred(['chart-1']); // second: chart selected

    // Resolve the SECOND emission first — chart-machine should see [chart-1].
    e2.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Resolve the FIRST emission AFTER. With the seq guard, this resolution
    // must be dropped (it's stale); without the guard, it would overwrite.
    e1.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The most recent SYNC_SELECTION send should reflect the second
    // emission's state — [chart-1], not [].
    const syncCalls = chartActor.send.mock.calls.filter((c) => c[0]?.type === 'SYNC_SELECTION');
    expect(syncCalls.length).toBeGreaterThan(0);
    const lastSync = syncCalls[syncCalls.length - 1];
    expect(lastSync[0].chartIds).toEqual(['chart-1']);

    cleanup();
  });
});

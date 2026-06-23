import { jest } from '@jest/globals';

import { setupEventSubscriptions } from '../event-subscriptions';

type EventRecord = {
  type: string;
  sheetId?: string;
  row?: number;
  col?: number;
  oldValue?: unknown;
  newValue?: unknown;
  position?: { row: number; col: number };
};

function createMockWorkbook() {
  const handlers = new Map<string, Array<(event: EventRecord) => void>>();

  return {
    on: jest.fn((eventName: string, handler: (event: EventRecord) => void) => {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);

      return () => {
        const current = handlers.get(eventName) ?? [];
        const idx = current.indexOf(handler);
        if (idx >= 0) current.splice(idx, 1);
      };
    }),
    emit: (event: EventRecord) => {
      for (const handler of handlers.get(event.type) ?? []) {
        handler(event);
      }
    },
  };
}

function setupWithWorkbook(
  workbook: ReturnType<typeof createMockWorkbook>,
  overrides: {
    readonly invalidateAll?: () => void;
    readonly rebindWorkbookViewport?: () => void;
  } = {},
) {
  return setupEventSubscriptions({
    workbook: workbook as any,
    getRenderer: () => null,
    getCurrentSheetId: () => 'sheet1',
    invalidateAll: overrides.invalidateAll ?? jest.fn(),
    updateRendererContext: jest.fn(),
    setFrozenPanes: jest.fn(),
    setViewportConfig: jest.fn(),
    rebindWorkbookViewport: overrides.rebindWorkbookViewport,
  });
}

describe('Event Subscriptions sparkline integration', () => {
  it('invalidates rendering after checkout materializes a new workbook context', () => {
    const workbook = createMockWorkbook();
    const invalidateAll = jest.fn();
    const rebindWorkbookViewport = jest.fn();
    setupWithWorkbook(workbook, { invalidateAll, rebindWorkbookViewport });

    workbook.emit({
      type: 'workbook:version-checkout-materialized',
      commitId: 'commit:sha256:test',
      targetKind: 'ref',
      refName: 'scenario/manual-smoke',
      timestamp: 1,
    });

    expect(rebindWorkbookViewport).toHaveBeenCalledTimes(1);
    expect(invalidateAll).toHaveBeenCalledTimes(1);
    expect(rebindWorkbookViewport.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateAll.mock.invocationCallOrder[0],
    );
  });

  it('refreshes contextual selection state for the complete sparkline event family', () => {
    const workbook = createMockWorkbook();
    const subscriptions = setupWithWorkbook(workbook);
    const onSparklineTopologyChanged = jest.fn();
    const sparklineEvents = [
      'sparkline:changed',
      'sparkline:created',
      'sparkline:updated',
      'sparkline:deleted',
      'sparkline:dataChanged',
      'sparklineGroup:created',
      'sparklineGroup:updated',
      'sparklineGroup:deleted',
      'sparklines:cleared',
    ];

    subscriptions.setSparklineConfig({
      sparklineManager: {} as any,
      getCurrentSheetId: () => 'sheet1',
      onSparklineTopologyChanged,
    });

    for (const eventName of sparklineEvents) {
      workbook.emit({ type: eventName, sheetId: 'sheet1' });
    }

    expect(onSparklineTopologyChanged).toHaveBeenCalledTimes(sparklineEvents.length);
  });

  it('ignores sparkline topology events for inactive sheets', () => {
    const workbook = createMockWorkbook();
    const subscriptions = setupWithWorkbook(workbook);
    const onSparklineTopologyChanged = jest.fn();

    subscriptions.setSparklineConfig({
      sparklineManager: {} as any,
      getCurrentSheetId: () => 'sheet1',
      onSparklineTopologyChanged,
    });

    workbook.emit({ type: 'sparkline:created', sheetId: 'sheet2' });

    expect(onSparklineTopologyChanged).not.toHaveBeenCalled();
  });

  it('replaces previous sparkline subscriptions when the manager is rewired', () => {
    const workbook = createMockWorkbook();
    const subscriptions = setupWithWorkbook(workbook);
    const firstRefresh = jest.fn();
    const secondRefresh = jest.fn();

    subscriptions.setSparklineConfig({
      sparklineManager: {} as any,
      getCurrentSheetId: () => 'sheet1',
      onSparklineTopologyChanged: firstRefresh,
    });
    subscriptions.setSparklineConfig({
      sparklineManager: {} as any,
      getCurrentSheetId: () => 'sheet1',
      onSparklineTopologyChanged: secondRefresh,
    });

    workbook.emit({ type: 'sparkline:created', sheetId: 'sheet1' });

    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).toHaveBeenCalledTimes(1);
  });

  it('drains pending table auto-expansion tasks', async () => {
    const workbook = createMockWorkbook();
    const subscriptions = setupWithWorkbook(workbook);
    let releaseExpansion: ((value: boolean) => void) | null = null;
    const autoExpandTableRow = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseExpansion = resolve;
        }),
    );

    subscriptions.setTableAutoExpansionConfig({
      checkAutoExpansion: jest.fn(async () => ({
        id: 'Table1',
        sheetId: 'sheet1',
        name: 'Table1',
      })),
      autoExpandTableRow,
      autoExpandTableColumn: jest.fn(async () => false),
      getCurrentSheetId: () => 'sheet1',
    });

    workbook.emit({
      type: 'cell:changed',
      sheetId: 'sheet1',
      row: 4,
      col: 2,
      oldValue: null,
      newValue: 'new value',
    });
    await Promise.resolve();

    const drained = subscriptions.drainTableAutoExpansion();
    let didDrain = false;
    void drained.then(() => {
      didDrain = true;
    });
    await Promise.resolve();

    expect(autoExpandTableRow).toHaveBeenCalledWith('Table1');
    expect(didDrain).toBe(false);

    releaseExpansion?.(true);
    await drained;

    expect(didDrain).toBe(true);
  });
});

import { jest } from '@jest/globals';

import { setupEventSubscriptions } from '../event-subscriptions';

type EventRecord = { type: string; sheetId?: string; position?: { row: number; col: number } };

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

function setupWithWorkbook(workbook: ReturnType<typeof createMockWorkbook>) {
  return setupEventSubscriptions({
    workbook: workbook as any,
    getRenderer: () => null,
    getCurrentSheetId: () => 'sheet1',
    invalidateAll: jest.fn(),
    updateRendererContext: jest.fn(),
    setFrozenPanes: jest.fn(),
    setViewportConfig: jest.fn(),
  });
}

describe('Event Subscriptions sparkline integration', () => {
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
});

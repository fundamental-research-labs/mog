import { jest } from '@jest/globals';

import {
  FORMULA_BAR_WORKBOOK_REFRESH_EVENTS,
  subscribeToFormulaBarWorkbookRefreshes,
} from '../formula-bar-refresh-subscriptions';

describe('subscribeToFormulaBarWorkbookRefreshes', () => {
  it('subscribes to workbook events that can rewrite formula text', () => {
    const unsubscribes = [jest.fn(), jest.fn()];
    let nextUnsubscribe = 0;
    const on = jest.fn(
      (_event: string, _handler: () => void) => unsubscribes[nextUnsubscribe++] ?? jest.fn(),
    );

    const unsubscribe = subscribeToFormulaBarWorkbookRefreshes({ on }, jest.fn());

    expect(on.mock.calls.map(([event]) => event)).toEqual(FORMULA_BAR_WORKBOOK_REFRESH_EVENTS);

    unsubscribe();
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(unsubscribes[1]).toHaveBeenCalledTimes(1);
  });

  it('runs the refresh callback when a subscribed workbook event fires', () => {
    const handlers = new Map<string, () => void>();
    const on = jest.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return jest.fn();
    });
    const refresh = jest.fn();

    subscribeToFormulaBarWorkbookRefreshes({ on }, refresh);
    handlers.get('sheet:deleted')?.();
    handlers.get('sheet:renamed')?.();

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

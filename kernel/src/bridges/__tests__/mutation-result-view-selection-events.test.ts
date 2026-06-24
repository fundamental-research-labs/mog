import { jest } from '@jest/globals';

import type { IEventBus } from '@mog-sdk/contracts/events';

import { MutationResultHandler } from '../mutation-result-handler';
import type { MutationResult } from '../compute/compute-bridge';

function createMockEventBus(): IEventBus & {
  emittedEvents: Array<{ type: string; [k: string]: unknown }>;
} {
  const emittedEvents: Array<{ type: string; [k: string]: unknown }> = [];
  return {
    emittedEvents,
    on: jest.fn(() => () => {}),
    off: jest.fn(),
    emit: jest.fn((event: { type: string }) => {
      emittedEvents.push(event as { type: string; [k: string]: unknown });
    }),
    once: jest.fn(() => () => {}),
  } as unknown as IEventBus & { emittedEvents: Array<{ type: string; [k: string]: unknown }> };
}

function buildMutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: null as unknown as undefined,
    ...overrides,
  } as MutationResult;
}

describe('MutationResultHandler view selection events', () => {
  it('emits view:selection-changed for viewSelectionChanges', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    const result = buildMutationResult({
      viewSelectionChanges: [
        {
          sheetId: 'sheet-2',
          activeCell: { row: 3, col: 2 },
          ranges: [{ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }],
        },
      ],
    } as Partial<MutationResult>);

    handler.applyAndNotify(result);

    const event = eventBus.emittedEvents.find((e) => e.type === 'view:selection-changed');
    expect(event).toMatchObject({
      sheetId: 'sheet-2',
      activeCell: { row: 3, col: 2 },
      ranges: [{ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }],
      source: 'user',
    });
  });
});

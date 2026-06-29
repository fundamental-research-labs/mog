import { jest } from '@jest/globals';
import type { IEventBus } from '@mog-sdk/contracts/events';

import type { MutationResult } from '../compute/compute-bridge';
import { MutationResultHandler } from '../mutation-result-handler';

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

it('preserves system source on workbook settings events', () => {
  const eventBus = createMockEventBus();
  const handler = new MutationResultHandler(eventBus);

  handler.applyAndNotify(
    {
      workbookSettingsChanges: [
        {
          kind: 'Set',
          changedKeys: ['customSettings'],
          settings: { customSettings: { 'mog.activeSheetId': 'sheet-1' } },
        },
      ],
    } as Partial<MutationResult> as MutationResult,
    'system',
  );

  expect(eventBus.emittedEvents).toContainEqual(
    expect.objectContaining({
      type: 'workbook:settings-changed',
      changedKey: 'customSettings',
      source: 'system',
    }),
  );
});

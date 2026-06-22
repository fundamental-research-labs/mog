import { jest } from '@jest/globals';

import type { IEventBus } from '@mog-sdk/contracts/events';

import type { FloatingObjectChange, MutationResult } from '../compute/compute-bridge';
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

function buildMutationResult(floatingObjectChanges: FloatingObjectChange[]): MutationResult {
  return {
    recalc: null as unknown as undefined,
    propertyChanges: undefined,
    dimensionChanges: undefined,
    mergeChanges: undefined,
    visibilityChanges: undefined,
    commentChanges: undefined,
    filterChanges: undefined,
    tableChanges: undefined,
    slicerChanges: undefined,
    sheetChanges: undefined,
    cfChanges: undefined,
    namedRangeChanges: undefined,
    groupingChanges: undefined,
    sparklineChanges: undefined,
    sortingChanges: undefined,
    floatingObjectChanges,
    floatingObjectGroupChanges: undefined,
    pivotChanges: undefined,
    undoDescription: undefined,
  } as MutationResult;
}

describe('MutationResultHandler chart floating-object events', () => {
  it('emits chart:updated for field-level chart updates', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    handler.applyAndNotify(
      buildMutationResult([
        {
          sheetId: 'sheet-1',
          objectId: 'chart-7',
          objectType: 'chart',
          kind: { type: 'updated', changedFields: ['title'] },
        } as unknown as FloatingObjectChange,
      ]),
    );

    expect(eventBus.emittedEvents.find((e) => e.type === 'chart:updated')).toMatchObject({
      sheetId: 'sheet-1',
      chartId: 'chart-7',
      changedFields: ['title'],
    });
  });

  it('emits chart:updated for chart size updates', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    handler.applyAndNotify(
      buildMutationResult([
        {
          sheetId: 'sheet-1',
          objectId: 'chart-8',
          objectType: 'chart',
          kind: { type: 'updated', changedFields: ['width', 'height'] },
        } as unknown as FloatingObjectChange,
      ]),
    );

    expect(eventBus.emittedEvents.find((e) => e.type === 'chart:updated')).toMatchObject({
      sheetId: 'sheet-1',
      chartId: 'chart-8',
      changedFields: ['width', 'height'],
    });
  });

  it('does not emit chart:updated for non-chart floating object updates', () => {
    const eventBus = createMockEventBus();
    const handler = new MutationResultHandler(eventBus);

    handler.applyAndNotify(
      buildMutationResult([
        {
          sheetId: 'sheet-1',
          objectId: 'shape-8',
          objectType: 'shape',
          kind: { type: 'updated', changedFields: ['fill'] },
          data: { id: 'shape-8', type: 'shape' },
        } as unknown as FloatingObjectChange,
      ]),
    );

    expect(eventBus.emittedEvents.some((e) => e.type === 'chart:updated')).toBe(false);
  });
});

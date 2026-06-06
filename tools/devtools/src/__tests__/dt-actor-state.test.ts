import { describe, expect, test } from 'bun:test';
import { createConsoleAPI } from '../console/api';
import { EventStore } from '../event-store';
import { ActorRecorder } from '../recorders/actor-recorder';

function setupRuntime() {
  const store = new EventStore();
  store.enable();
  const actorRecorder = new ActorRecorder(store);
  const api = createConsoleAPI(store, actorRecorder);
  return { api, actorRecorder };
}

function recordMachine(actorRecorder: ActorRecorder, actorId: string): void {
  actorRecorder.record(actorId, {
    type: '@xstate.snapshot',
    snapshot: {
      value: 'idle',
      context: { cell: 'A1' },
    },
    event: { type: 'xstate.init' },
  });
  actorRecorder.record(actorId, {
    type: '@xstate.event',
    event: { type: 'PING' },
  });
}

describe('__dt actor-state clearing', () => {
  test('clear() preserves machine snapshots but resets per-step counters', () => {
    const { api, actorRecorder } = setupRuntime();
    recordMachine(actorRecorder, 'selection-1');

    expect(api.getMachineStates()['selection-1']?.currentState).toBe('idle');
    expect(api.getMachineStates()['selection-1']?.eventCount).toBe(1);

    api.clear();

    expect(api.getMachineStates()['selection-1']?.currentState).toBe('idle');
    expect(api.getMachineStates()['selection-1']?.context).toEqual({
      cell: 'A1',
    });
    expect(api.getMachineStates()['selection-1']?.eventCount).toBe(0);
    expect(api.getStatus().machines).toEqual([
      expect.objectContaining({
        id: 'selection-1',
        state: 'idle',
        eventCount: 0,
      }),
    ]);
    expect(api.toJSON().machines['selection-1']).toEqual(
      expect.objectContaining({
        actorId: 'selection-1',
        currentState: 'idle',
        eventCount: 0,
        transitions: [],
      }),
    );
    expect(api.toJSON().events).toEqual([]);
  });

  test('clearActorState() clears retained machine snapshots at document boundaries', () => {
    const { api, actorRecorder } = setupRuntime();
    recordMachine(actorRecorder, 'selection-old-doc');
    const eventCountBeforeClear = api.toJSON().events.length;

    expect(Object.keys(api.getMachineStates())).toEqual(['selection-old-doc']);
    expect(eventCountBeforeClear).toBeGreaterThan(0);

    api.clearActorState();

    expect(api.getMachineStates()).toEqual({});
    expect(api.getStatus().machines).toEqual([]);
    expect(api.toJSON().machines).toEqual({});
    expect(api.toJSON().events).toHaveLength(eventCountBeforeClear);
  });
});

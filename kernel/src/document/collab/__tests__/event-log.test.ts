import { createEventLog } from '../event-log';

describe('EventLog', () => {
  test('records events and returns them in order', () => {
    const log = createEventLog();
    log.push('ws_connect', { url: 'ws://localhost' });
    log.push('join_req', { participantId: 'a' });
    log.push('join_res', { fullState: '100B' });

    const events = log.events();
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('ws_connect');
    expect(events[1].type).toBe('join_req');
    expect(events[2].type).toBe('join_res');
    expect(events[0].detail).toEqual({ url: 'ws://localhost' });
  });

  test('ring buffer caps at max size, oldest events evicted', () => {
    const log = createEventLog(5);
    for (let i = 0; i < 10; i++) {
      log.push('update_v1', { i });
    }

    const events = log.events();
    expect(events).toHaveLength(5);
    // Oldest events (i=0..4) should be evicted
    expect(events[0].detail?.i).toBe(5);
    expect(events[4].detail?.i).toBe(9);
  });

  test('clear() empties the buffer', () => {
    const log = createEventLog();
    log.push('ws_connect');
    log.push('join_req');
    expect(log.events()).toHaveLength(2);

    log.clear();
    expect(log.events()).toHaveLength(0);
  });

  test('dump() produces relative timestamps', () => {
    const log = createEventLog();
    log.push('ws_connect', { url: 'ws://localhost' });
    log.push('join_req', { participantId: 'a' });

    const output = log.dump();
    // First event should start at +0.000
    expect(output).toMatch(/^\+0\.000/);
    expect(output).toContain('ws_connect');
    expect(output).toContain('join_req');
    expect(output).toContain('url=ws://localhost');
  });

  test('dump() returns placeholder when empty', () => {
    const log = createEventLog();
    expect(log.dump()).toBe('(no events)');
  });

  test('events without detail omit the detail field', () => {
    const log = createEventLog();
    log.push('detach');

    const events = log.events();
    expect(events[0].detail).toBeUndefined();
  });

  test('stats() computes message counts and bytes', () => {
    const log = createEventLog();
    log.push('join_req', { participantId: 'a' });
    log.push('join_res', { fullState: 1284 });
    log.push('flush_push', { diff: 96 });
    log.push('flush_push', { diff: 48 });
    log.push('nudge_recv', { serverSv: 56 });
    log.push('pull_req', { localSv: 52 });
    log.push('pull_res', { diff: 200 });

    const s = log.stats();
    expect(s.sent.JOIN_REQUEST.count).toBe(1);
    expect(s.sent.PUSH.count).toBe(2);
    expect(s.sent.PUSH.bytes).toBe(96 + 48);
    expect(s.sent.PULL_REQUEST.count).toBe(1);
    expect(s.received.JOIN_RESPONSE.count).toBe(1);
    expect(s.received.JOIN_RESPONSE.bytes).toBe(1284);
    expect(s.received.BROADCAST_NUDGE.count).toBe(1);
    expect(s.received.PULL_RESPONSE.count).toBe(1);
    expect(s.received.PULL_RESPONSE.bytes).toBe(200);
    expect(s.totalBytesSent).toBe(96 + 48 + 52);
    expect(s.totalBytesReceived).toBe(1284 + 56 + 200);
  });

  test('stats() handles byte strings like "48B"', () => {
    const log = createEventLog();
    log.push('flush_push', { diff: '48B' });

    const s = log.stats();
    expect(s.sent.PUSH.bytes).toBe(48);
  });

  test('stats() returns empty when no matching events', () => {
    const log = createEventLog();
    log.push('ws_connect');
    log.push('status_change', { from: 'connecting', to: 'online' });

    const s = log.stats();
    expect(Object.keys(s.sent)).toHaveLength(0);
    expect(Object.keys(s.received)).toHaveLength(0);
    expect(s.totalBytesSent).toBe(0);
    expect(s.totalBytesReceived).toBe(0);
  });
});

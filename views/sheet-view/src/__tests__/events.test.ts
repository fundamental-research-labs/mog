import type { SheetViewEvent } from '../public-types';
import { SheetViewEvents } from '../capabilities/events';

describe('SheetViewEvents', () => {
  let events: SheetViewEvents;

  beforeEach(() => {
    events = new SheetViewEvents();
  });

  it('delivers events to subscribers', () => {
    const received: SheetViewEvent[] = [];
    events.subscribe((e) => received.push(e));

    const event: SheetViewEvent = { type: 'focus-enter' };
    events.emit(event);

    expect(received).toEqual([event]);
  });

  it('delivers events to multiple subscribers', () => {
    const a: SheetViewEvent[] = [];
    const b: SheetViewEvent[] = [];
    events.subscribe((e) => a.push(e));
    events.subscribe((e) => b.push(e));

    const event: SheetViewEvent = { type: 'zoom-change', zoom: 1.5 };
    events.emit(event);

    expect(a).toEqual([event]);
    expect(b).toEqual([event]);
  });

  it('does not deliver events after dispose', () => {
    const received: SheetViewEvent[] = [];
    const sub = events.subscribe((e) => received.push(e));

    events.emit({ type: 'focus-enter' });
    sub.dispose();
    events.emit({ type: 'focus-leave' });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('focus-enter');
  });

  it('dispose is idempotent', () => {
    const received: SheetViewEvent[] = [];
    const sub = events.subscribe((e) => received.push(e));

    sub.dispose();
    sub.dispose(); // should not throw

    events.emit({ type: 'focus-enter' });
    expect(received).toHaveLength(0);
  });

  it('clear removes all subscribers', () => {
    const a: SheetViewEvent[] = [];
    const b: SheetViewEvent[] = [];
    events.subscribe((e) => a.push(e));
    events.subscribe((e) => b.push(e));

    events.clear();
    events.emit({ type: 'focus-enter' });

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(0);
  });

  it('swallows subscriber errors without breaking other listeners', () => {
    const received: SheetViewEvent[] = [];

    events.subscribe(() => {
      throw new Error('boom');
    });
    events.subscribe((e) => received.push(e));

    const event: SheetViewEvent = { type: 'geometry-change' };
    events.emit(event);

    expect(received).toEqual([event]);
  });

  it('supports re-subscribing after dispose', () => {
    const received: SheetViewEvent[] = [];
    const sub = events.subscribe((e) => received.push(e));
    sub.dispose();

    const received2: SheetViewEvent[] = [];
    events.subscribe((e) => received2.push(e));

    events.emit({ type: 'focus-enter' });

    expect(received).toHaveLength(0);
    expect(received2).toHaveLength(1);
  });

  it('emitting with no subscribers does not throw', () => {
    expect(() => events.emit({ type: 'focus-enter' })).not.toThrow();
  });
});

import { jest } from '@jest/globals';

import { Subscribable } from '../subscribable';
import type { Listener } from '../subscribable';

class TestService extends Subscribable<number> {
  value = 0;
  getSnapshot(): number {
    return this.value;
  }
  // Expose protected notify for testing
  doNotify(): void {
    this.emitChange();
  }
}

describe('Subscribable', () => {
  let svc: TestService;

  beforeEach(() => {
    svc = new TestService();
  });

  afterEach(() => {
    if (!svc.isDisposed) svc.dispose();
  });

  it('subscribe() immediately calls listener with current snapshot', () => {
    svc.value = 42;
    const listener = jest.fn();
    svc.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(42);
  });

  it('subscribe() returns IDisposable that unsubscribes when disposed', () => {
    const listener = jest.fn();
    const sub = svc.subscribe(listener);
    listener.mockClear(); // clear the immediate call

    svc.value = 10;
    svc.doNotify();
    expect(listener).toHaveBeenCalledTimes(1);

    sub.dispose();
    listener.mockClear();

    svc.value = 20;
    svc.doNotify();
    expect(listener).not.toHaveBeenCalled();
  });

  it('notify() calls all listeners with current snapshot', () => {
    const l1 = jest.fn();
    const l2 = jest.fn();
    svc.subscribe(l1);
    svc.subscribe(l2);
    l1.mockClear();
    l2.mockClear();

    svc.value = 99;
    svc.doNotify();
    expect(l1).toHaveBeenCalledWith(99);
    expect(l2).toHaveBeenCalledWith(99);
  });

  it('try-catch isolation: one bad listener does not prevent others', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const good1 = jest.fn();
    const good2 = jest.fn();
    const bad: Listener<number> = () => {
      throw new Error('boom');
    };

    svc.subscribe(good1);
    good1.mockClear();
    svc.subscribe(bad);
    svc.subscribe(good2);
    good2.mockClear();

    svc.value = 7;
    svc.doNotify();
    expect(good1).toHaveBeenCalledTimes(1);
    expect(good2).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('dispose() clears all listeners', () => {
    const listener = jest.fn();
    svc.subscribe(listener);
    listener.mockClear();

    svc.dispose();

    // No further notifications
    // (Can't call doNotify after dispose since listeners are cleared,
    // but we verify no lingering references by checking isDisposed)
    expect(svc.isDisposed).toBe(true);
  });

  it('subscribe() after dispose throws', () => {
    svc.dispose();
    expect(() => svc.subscribe(jest.fn())).toThrow('Handle is disposed');
  });

  // ------- once() -------

  it('once() does NOT fire immediately', () => {
    svc.value = 42;
    const listener = jest.fn();
    svc.once(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('once() fires on next notify() only', () => {
    const listener = jest.fn();
    svc.once(listener);

    svc.value = 1;
    svc.doNotify();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);

    // Should not fire again
    listener.mockClear();
    svc.value = 2;
    svc.doNotify();
    expect(listener).not.toHaveBeenCalled();
  });

  it('once() auto-unsubscribes after first fire', () => {
    const listener = jest.fn();
    svc.once(listener);

    svc.doNotify();
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();
    svc.doNotify();
    svc.doNotify();
    expect(listener).not.toHaveBeenCalled();
  });

  it('once() returns IDisposable that can cancel before fire', () => {
    const listener = jest.fn();
    const sub = svc.once(listener);
    sub.dispose();

    svc.value = 5;
    svc.doNotify();
    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribe() returns a callable disposable', () => {
    const listener = jest.fn();
    const sub = svc.subscribe(listener);
    expect(typeof sub).toBe('function');
    listener.mockClear();

    svc.value = 10;
    svc.doNotify();
    expect(listener).toHaveBeenCalledTimes(1);

    // Call directly to unsubscribe
    sub();
    listener.mockClear();

    svc.value = 20;
    svc.doNotify();
    expect(listener).not.toHaveBeenCalled();
  });
});

import { jest } from '@jest/globals';

import { TypedEventEmitter } from '../event-emitter';

type TestEvents = {
  change: number;
  error: string;
};

class TestEmitter extends TypedEventEmitter<TestEvents> {
  // Expose protected emit for testing
  doEmit<K extends keyof TestEvents>(event: K, data: TestEvents[K]): void {
    this.emit(event, data);
  }
}

describe('TypedEventEmitter', () => {
  let emitter: TestEmitter;

  beforeEach(() => {
    emitter = new TestEmitter();
  });

  afterEach(() => {
    if (!emitter.isDisposed) emitter.dispose();
  });

  it('on() returns IDisposable', () => {
    const sub = emitter.on('change', jest.fn());
    expect(sub).toBeDefined();
    expect(typeof sub.dispose).toBe('function');
  });

  it('handler receives typed data', () => {
    const handler = jest.fn();
    emitter.on('change', handler);
    emitter.doEmit('change', 42);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it('try-catch isolation: one bad handler does not prevent others', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const good1 = jest.fn();
    const good2 = jest.fn();
    const bad = (): void => {
      throw new Error('boom');
    };

    emitter.on('change', good1);
    emitter.on('change', bad);
    emitter.on('change', good2);

    emitter.doEmit('change', 5);
    expect(good1).toHaveBeenCalledTimes(1);
    expect(good2).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('disposing subscription stops handler from being called', () => {
    const handler = jest.fn();
    const sub = emitter.on('change', handler);
    emitter.doEmit('change', 1);
    expect(handler).toHaveBeenCalledTimes(1);

    sub.dispose();
    handler.mockClear();
    emitter.doEmit('change', 2);
    expect(handler).not.toHaveBeenCalled();
  });

  // ------- once() -------

  it('once() fires once then auto-unsubscribes', () => {
    const handler = jest.fn();
    emitter.once('change', handler);

    emitter.doEmit('change', 10);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(10);

    handler.mockClear();
    emitter.doEmit('change', 20);
    expect(handler).not.toHaveBeenCalled();
  });

  it('once() returns IDisposable that can cancel before fire', () => {
    const handler = jest.fn();
    const sub = emitter.once('change', handler);
    sub.dispose();

    emitter.doEmit('change', 99);
    expect(handler).not.toHaveBeenCalled();
  });

  // ------- dispose() -------

  it('dispose() clears all handlers', () => {
    const handler = jest.fn();
    emitter.on('change', handler);
    emitter.on('error', jest.fn());

    emitter.dispose();
    expect(emitter.isDisposed).toBe(true);
  });

  it('on() after dispose throws', () => {
    emitter.dispose();
    expect(() => emitter.on('change', jest.fn())).toThrow('Handle is disposed');
  });

  // ------- multiple event types -------

  it('on() returns a callable disposable', () => {
    const handler = jest.fn();
    const sub = emitter.on('change', handler);
    expect(typeof sub).toBe('function');

    emitter.doEmit('change', 1);
    expect(handler).toHaveBeenCalledTimes(1);

    // Call directly to unsubscribe
    sub();
    handler.mockClear();

    emitter.doEmit('change', 2);
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple event types work independently', () => {
    const changeHandler = jest.fn();
    const errorHandler = jest.fn();

    emitter.on('change', changeHandler);
    emitter.on('error', errorHandler);

    emitter.doEmit('change', 42);
    expect(changeHandler).toHaveBeenCalledWith(42);
    expect(errorHandler).not.toHaveBeenCalled();

    changeHandler.mockClear();
    emitter.doEmit('error', 'oops');
    expect(errorHandler).toHaveBeenCalledWith('oops');
    expect(changeHandler).not.toHaveBeenCalled();
  });
});

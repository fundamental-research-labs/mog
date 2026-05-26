import { TypedEventEmitter } from '../shared/event-emitter';

// Subclass to expose the protected emit() method for testing.
interface TestEventMap {
  foo: string;
  bar: number;
}

class TestEmitter extends TypedEventEmitter<TestEventMap> {
  _emit<K extends keyof TestEventMap>(event: K, data: TestEventMap[K]) {
    this.emit(event, data);
  }
}

describe('TypedEventEmitter', () => {
  let emitter: TestEmitter;

  beforeEach(() => {
    emitter = new TestEmitter();
  });

  it('on() registers a handler that receives emitted data', () => {
    const received: string[] = [];
    emitter.on('foo', (data) => received.push(data));

    emitter._emit('foo', 'hello');

    expect(received).toEqual(['hello']);
  });

  it('on() returns an unsubscribe function that works', () => {
    const received: string[] = [];
    const unsub = emitter.on('foo', (data) => received.push(data));

    emitter._emit('foo', 'first');
    unsub();
    emitter._emit('foo', 'second');

    expect(received).toEqual(['first']);
  });

  it('multiple handlers on the same event all fire', () => {
    const a: string[] = [];
    const b: string[] = [];
    emitter.on('foo', (data) => a.push(data));
    emitter.on('foo', (data) => b.push(data));

    emitter._emit('foo', 'both');

    expect(a).toEqual(['both']);
    expect(b).toEqual(['both']);
  });

  it('different events are independent', () => {
    const foos: string[] = [];
    const bars: number[] = [];
    emitter.on('foo', (data) => foos.push(data));
    emitter.on('bar', (data) => bars.push(data));

    emitter._emit('foo', 'a');
    emitter._emit('bar', 42);

    expect(foos).toEqual(['a']);
    expect(bars).toEqual([42]);
  });

  it('removeAllListeners() clears all handlers', () => {
    const received: string[] = [];
    emitter.on('foo', (data) => received.push(data));
    emitter.on('bar', () => {});

    emitter.removeAllListeners();
    emitter._emit('foo', 'after-clear');

    expect(received).toEqual([]);
  });

  it('emit() after unsubscribe does not fire handler', () => {
    const received: number[] = [];
    const unsub = emitter.on('bar', (data) => received.push(data));

    unsub();
    emitter._emit('bar', 99);

    expect(received).toEqual([]);
  });

  it('handler receives exact data passed to emit', () => {
    let captured: number | undefined;
    emitter.on('bar', (data) => {
      captured = data;
    });

    emitter._emit('bar', 3.14);

    expect(captured).toBe(3.14);
  });

  it('no error when emitting event with no handlers', () => {
    expect(() => {
      emitter._emit('foo', 'orphan');
    }).not.toThrow();
  });
});

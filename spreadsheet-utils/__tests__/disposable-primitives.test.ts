import {
  DisposableNone,
  toDisposable,
  MutableDisposable,
  DisposableGroup,
} from '@mog/spreadsheet-utils/disposable';
import type { IDisposable } from '@mog-sdk/contracts/core/disposable';

// ---------------------------------------------------------------------------
// DisposableNone
// ---------------------------------------------------------------------------
describe('DisposableNone', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(DisposableNone)).toBe(true);
  });

  it('dispose() does not throw', () => {
    expect(() => DisposableNone.dispose()).not.toThrow();
  });

  it('Symbol.dispose does not throw', () => {
    expect(() => DisposableNone[Symbol.dispose]()).not.toThrow();
  });

  it('calling dispose multiple times is fine', () => {
    DisposableNone.dispose();
    DisposableNone.dispose();
    DisposableNone.dispose();
  });

  it('is callable as a function', () => {
    expect(typeof DisposableNone).toBe('function');
    expect(() => DisposableNone()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// toDisposable
// ---------------------------------------------------------------------------
describe('toDisposable', () => {
  it('calls fn on first dispose()', () => {
    const fn = jest.fn();
    const d = toDisposable(fn);
    expect(fn).not.toHaveBeenCalled();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('second dispose() is a no-op — fn not called twice', () => {
    const fn = jest.fn();
    const d = toDisposable(fn);
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('supports Symbol.dispose', () => {
    const fn = jest.fn();
    const d = toDisposable(fn);
    d[Symbol.dispose]();
    expect(fn).toHaveBeenCalledTimes(1);
    // second call via dispose() should be no-op
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is callable as a function', () => {
    const fn = jest.fn();
    const d = toDisposable(fn);
    expect(typeof d).toBe('function');
    d(); // call directly
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calling directly is idempotent — fn not called twice', () => {
    const fn = jest.fn();
    const d = toDisposable(fn);
    d();
    d();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('direct call and .dispose() are equivalent', () => {
    const fn = jest.fn();
    const d = toDisposable(fn);
    d(); // call directly
    d.dispose(); // should be no-op
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('.dispose() followed by direct call is idempotent', () => {
    const fn = jest.fn();
    const d = toDisposable(fn);
    d.dispose();
    d(); // should be no-op
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// MutableDisposable
// ---------------------------------------------------------------------------
describe('MutableDisposable', () => {
  const makeMock = (): IDisposable => ({
    dispose: jest.fn(),
    [Symbol.dispose]() {
      this.dispose();
    },
  });

  it('swap-on-assign disposes old value', () => {
    const m = new MutableDisposable<IDisposable>();
    const old = makeMock();
    const next = makeMock();
    m.value = old;
    expect(old.dispose).not.toHaveBeenCalled();
    m.value = next;
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(next.dispose).not.toHaveBeenCalled();
  });

  it('detach removes without disposing', () => {
    const m = new MutableDisposable<IDisposable>();
    const d = makeMock();
    m.value = d;
    const detached = m.detach();
    expect(detached).toBe(d);
    expect(d.dispose).not.toHaveBeenCalled();
    expect(m.value).toBeUndefined();
  });

  it('dispose() disposes current value', () => {
    const m = new MutableDisposable<IDisposable>();
    const d = makeMock();
    m.value = d;
    m.dispose();
    expect(d.dispose).toHaveBeenCalledTimes(1);
    expect(m.value).toBeUndefined();
  });

  it('double-dispose is a no-op', () => {
    const m = new MutableDisposable<IDisposable>();
    const d = makeMock();
    m.value = d;
    m.dispose();
    m.dispose();
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });

  it('assigning after dispose throws', () => {
    const m = new MutableDisposable<IDisposable>();
    m.dispose();
    expect(() => {
      m.value = makeMock();
    }).toThrow('MutableDisposable already disposed');
  });

  it('supports Symbol.dispose', () => {
    const m = new MutableDisposable<IDisposable>();
    const d = makeMock();
    m.value = d;
    m[Symbol.dispose]();
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// DisposableGroup
// ---------------------------------------------------------------------------
describe('DisposableGroup', () => {
  const makeMock = (): IDisposable & { dispose: jest.Mock } => ({
    dispose: jest.fn(),
    [Symbol.dispose]() {
      this.dispose();
    },
  });

  it('disposes children in LIFO order', () => {
    const order: number[] = [];
    const g = new DisposableGroup();
    g.add({
      dispose: () => order.push(1),
      [Symbol.dispose]() {
        this.dispose();
      },
    });
    g.add({
      dispose: () => order.push(2),
      [Symbol.dispose]() {
        this.dispose();
      },
    });
    g.add({
      dispose: () => order.push(3),
      [Symbol.dispose]() {
        this.dispose();
      },
    });
    g.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  it('double-dispose is a no-op', () => {
    const d = makeMock();
    const g = new DisposableGroup();
    g.add(d);
    g.dispose();
    g.dispose();
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });

  it('error isolation — one child throws, others still dispose', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const d1 = makeMock();
    const d2 = makeMock();
    const thrower: IDisposable = {
      dispose: () => {
        throw new Error('boom');
      },
      [Symbol.dispose]() {
        this.dispose();
      },
    };
    const g = new DisposableGroup();
    g.add(d1);
    g.add(thrower);
    g.add(d2);
    g.dispose();
    // d2 is disposed first (LIFO), then thrower, then d1
    expect(d1.dispose).toHaveBeenCalledTimes(1);
    expect(d2.dispose).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('lambda convenience overload', () => {
    const fn = jest.fn();
    const g = new DisposableGroup();
    g.add(fn);
    g.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('add after dispose throws', () => {
    const g = new DisposableGroup();
    g.dispose();
    expect(() => g.add(makeMock())).toThrow('DisposableGroup already disposed');
  });

  it('Symbol.dispose works', () => {
    const d = makeMock();
    const g = new DisposableGroup();
    g.add(d);
    g[Symbol.dispose]();
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });
});

/**
 * Disposable — Handle-based lifecycle management (runtime implementations).
 *
 * Classes and utilities extracted from @mog-sdk/contracts/core.
 * The IDisposable interface remains in @mog-sdk/contracts/core.
 */

import type { IDisposable } from '@mog-sdk/contracts/core';

/**
 * Base class for handles. Implements idempotent dispose + Symbol.dispose.
 * Subclass and override _dispose() for cleanup logic.
 */
export abstract class DisposableBase implements IDisposable {
  private _disposed = false;

  get isDisposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  protected abstract _dispose(): void;

  /** Throw if this handle has been disposed. */
  protected throwIfDisposed(): void {
    if (this._disposed) throw new Error('Handle is disposed');
  }
}

/**
 * Tracks child disposables. Disposing the store disposes all children.
 * Used by WorkbookImpl to auto-cleanup all created handles.
 */
export class DisposableStore implements IDisposable {
  private readonly _disposables = new Set<IDisposable>();

  /** Register a child disposable. Returns the same disposable for chaining. */
  track<T extends IDisposable>(disposable: T): T {
    this._disposables.add(disposable);
    return disposable;
  }

  /** Unregister a child without disposing it. */
  untrack(disposable: IDisposable): void {
    this._disposables.delete(disposable);
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

// =============================================================================
// Disposable Utilities
// =============================================================================

/**
 * A disposable that is also directly callable as an unsubscribe function.
 * This makes it compatible with React cleanup (useEffect, useSyncExternalStore)
 * while preserving IDisposable composability (DisposableStore.track()).
 */
export type CallableDisposable = (() => void) & IDisposable;

/**
 * Wraps a cleanup function into a CallableDisposable with single-execution guarantee.
 * The returned value is both:
 * - Callable as a function (for React useEffect/useSyncExternalStore cleanup)
 * - An IDisposable (for DisposableStore.track() and `using` declarations)
 */
export function toDisposable(fn: () => void): CallableDisposable {
  let called = false;
  const disposable = (() => {
    if (!called) {
      called = true;
      fn();
    }
  }) as CallableDisposable;
  disposable.dispose = disposable;
  disposable[Symbol.dispose] = disposable;
  return disposable;
}

/**
 * Frozen no-op disposable. Use as default/placeholder to avoid null checks.
 * Callable — can be returned directly from useEffect or useSyncExternalStore.
 */
export const DisposableNone: CallableDisposable = (() => {
  const noop = (() => {}) as CallableDisposable;
  noop.dispose = noop;
  noop[Symbol.dispose] = noop;
  return Object.freeze(noop);
})();

/**
 * Holds exactly one disposable. Assigning a new .value auto-disposes the old.
 */
export class MutableDisposable<T extends IDisposable> implements IDisposable {
  private _value: T | undefined;
  private _disposed = false;

  get value(): T | undefined {
    return this._value;
  }
  set value(newValue: T | undefined) {
    if (this._disposed) throw new Error('MutableDisposable already disposed');
    this._value?.dispose();
    this._value = newValue;
  }

  detach(): T | undefined {
    const v = this._value;
    this._value = undefined;
    return v;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._value?.dispose();
    this._value = undefined;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/**
 * Composes multiple disposables into one.
 * dispose() calls children in reverse registration order (LIFO).
 * Error-isolated: one child's dispose failure doesn't prevent others from running.
 */
export class DisposableGroup implements IDisposable {
  private disposables: IDisposable[] = [];
  private disposed = false;

  add(d: IDisposable): void;
  add(fn: () => void): void;
  add(d: IDisposable | (() => void)): void {
    if (this.disposed) throw new Error('DisposableGroup already disposed');
    this.disposables.push(typeof d === 'function' ? toDisposable(d) : d);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.disposables.length - 1; i >= 0; i--) {
      try {
        this.disposables[i].dispose();
      } catch (e) {
        console.error('[DisposableGroup] dispose error:', e);
      }
    }
    this.disposables.length = 0;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

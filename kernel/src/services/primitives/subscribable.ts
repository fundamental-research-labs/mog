import { DisposableBase, toDisposable } from '@mog/spreadsheet-utils/disposable';
import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';

export type Listener<T> = (snapshot: T) => void;

/**
 * Generic observable state container for kernel services.
 *
 * Contract:
 * - subscribe() immediately calls listener with current snapshot
 * - Every listener invocation is wrapped in try-catch (one bad listener never crashes others)
 * - subscribe() returns CallableDisposable — both callable (React cleanup) and composable (DisposableStore.track())
 * - dispose() clears all listeners (no dangling references)
 * - Subclass only needs to implement getSnapshot()
 *
 * Extends DisposableBase for:
 * - Idempotent dispose (double-dispose is a no-op)
 * - isDisposed guard
 * - TC39 Symbol.dispose (usable with `using`)
 */
export abstract class Subscribable<T> extends DisposableBase {
  private listeners = new Set<Listener<T>>();

  /**
   * Return current state snapshot.
   * MUST be cheap and side-effect-free — called on every subscribe() and notify().
   */
  abstract getSnapshot(): T;

  /**
   * Subscribe to state changes. Listener is immediately called with current snapshot.
   * Returns CallableDisposable — call directly for React cleanup, .dispose() to unsubscribe, or pass to DisposableStore.track().
   */
  subscribe(listener: Listener<T>): CallableDisposable {
    this.throwIfDisposed();
    this.listeners.add(listener);
    // Immediate notify with current state
    try {
      listener(this.getSnapshot());
    } catch (e) {
      console.error(`[${this.constructor.name}] Listener error on subscribe:`, e);
    }
    return toDisposable(() => {
      this.listeners.delete(listener);
    });
  }

  /**
   * Subscribe to the next state change only. Automatically unsubscribes after first notification.
   * Does NOT fire immediately (unlike subscribe) — waits for the next notify().
   */
  once(listener: Listener<T>): CallableDisposable {
    this.throwIfDisposed();
    const wrapper: Listener<T> = (snapshot) => {
      this.listeners.delete(wrapper);
      listener(snapshot);
    };
    this.listeners.add(wrapper);
    return toDisposable(() => {
      this.listeners.delete(wrapper);
    });
  }

  protected emitChange(): void {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (e) {
        console.error(`[${this.constructor.name}] Listener error:`, e);
      }
    }
  }

  protected _dispose(): void {
    this.listeners.clear();
  }
}

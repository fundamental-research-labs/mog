import { DisposableBase, toDisposable } from '@mog/spreadsheet-utils/disposable';
import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';

/**
 * Typed event emitter for services with multiple named events.
 * Returns IDisposable from on() for composability with DisposableStore.track().
 *
 * Usage:
 *   type Events = {
 *     'granted': CapabilityGrant;
 *     'revoked': { appId: string; capability: string };
 *   };
 *   class MyService extends TypedEventEmitter<Events> { ... }
 *
 *   // Consumer:
 *   const sub = service.on('granted', (grant) => { ... });  // grant is typed
 *   store.track(sub);  // auto-disposed when store disposes
 */
export class TypedEventEmitter<TEventMap extends Record<string, unknown>> extends DisposableBase {
  private handlers = new Map<keyof TEventMap, Set<(data: any) => void>>();

  /**
   * Subscribe to a named event. Returns CallableDisposable for unsubscription.
   * Error-isolated: one handler's failure never prevents other handlers from running.
   */
  on<K extends keyof TEventMap>(
    event: K,
    handler: (data: TEventMap[K]) => void,
  ): CallableDisposable {
    this.throwIfDisposed();
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return toDisposable(() => {
      set!.delete(handler);
    });
  }

  /**
   * Subscribe to the next occurrence of a named event only.
   * Automatically unsubscribes after first fire.
   */
  once<K extends keyof TEventMap>(
    event: K,
    handler: (data: TEventMap[K]) => void,
  ): CallableDisposable {
    this.throwIfDisposed();
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const wrapper = (data: any) => {
      set!.delete(wrapper);
      handler(data);
    };
    set.add(wrapper);
    return toDisposable(() => {
      set!.delete(wrapper);
    });
  }

  protected emit<K extends keyof TEventMap>(event: K, data: TEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Snapshot the handler set before iterating to prevent reentrancy bugs
    // where a handler subscribes/unsubscribes during emission.
    for (const handler of [...set]) {
      try {
        handler(data);
      } catch (e) {
        console.error(`[${this.constructor.name}] Event handler error (${String(event)}):`, e);
      }
    }
  }

  protected _dispose(): void {
    this.handlers.clear();
  }
}

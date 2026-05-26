/**
 * Minimal typed event emitter. Used by MogClient, EmbedRenderer, and MogSheetElement.
 *
 * - `on()` returns an unsubscribe function (matches existing API contract).
 * - `emit()` is synchronous.
 * - No wildcard, no once(), no max-listeners — keep it minimal.
 */

type Handler<T> = (data: T) => void;

export class TypedEventEmitter<TMap extends Record<string, unknown>> {
  private _handlers = new Map<keyof TMap, Set<Handler<any>>>();

  on<K extends keyof TMap>(event: K, handler: Handler<TMap[K]>): () => void {
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  protected emit<K extends keyof TMap>(event: K, data: TMap[K]): void {
    const set = this._handlers.get(event);
    if (set) {
      for (const h of set) h(data);
    }
  }

  removeAllListeners(): void {
    this._handlers.clear();
  }
}

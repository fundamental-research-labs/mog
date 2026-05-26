import type { DevToolsBroadcaster } from './bridge/broadcast-channel';
import type { RuntimeEvent, StoreEntry } from './types';

export type StoreListener = () => void;

export class EventStore {
  private entries: StoreEntry[] = [];
  private nextId = 1;
  private enabled = false;
  private broadcaster: DevToolsBroadcaster | null = null;

  // --- Change notification ---
  private listeners = new Set<StoreListener>();
  private rafPending = false;
  private _version = 0;

  // --- Step-anchor (flow schema v2 / O-1) ---
  // `clear()` resets this so every per-step event gets a `tSinceStepStart`
  // measured against the start of that step. Initial value lets pre-step
  // events report `0` (not negative) until the first `clear()`.
  private _stepStartT: number = typeof performance !== 'undefined' ? performance.now() : 0;

  /** Subscribe to store changes. Returns unsubscribe function. */
  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Monotonically increasing version — bumped on every mutation. */
  get version(): number {
    return this._version;
  }

  /** Notify listeners, coalesced to one call per animation frame. */
  private notify(): void {
    this._version++;
    if (this.rafPending) return;
    this.rafPending = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        this.rafPending = false;
        for (const listener of this.listeners) listener();
      });
    } else {
      // SSR / test fallback
      this.rafPending = false;
      for (const listener of this.listeners) listener();
    }
  }

  setBroadcaster(broadcaster: DevToolsBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  push(event: RuntimeEvent): void {
    if (!this.enabled) return;

    // Duplicate detection: flag events that match the previous entry's type,
    // timestamp, and key fields. Root cause is two active sheet contexts
    // processing the same action — we tag rather than suppress to keep the
    // data honest while making the symptom visible.
    if (this.entries.length > 0) {
      const prev = this.entries[this.entries.length - 1].event;
      if (prev.type === event.type && prev.timestamp === event.timestamp) {
        if (isDuplicateEvent(prev, event)) {
          event.isDuplicate = true;
        }
      }
    }

    const entry: StoreEntry = { id: this.nextId++, event };
    this.entries.push(entry);
    this.broadcaster?.sendEvent(entry);
    this.notify();
  }

  /** Get last N entries, newest first */
  last(n?: number): StoreEntry[] {
    const limit = Math.min(n ?? 10, this.entries.length);
    return this.entries.slice(-limit).reverse();
  }

  /** Get all entries, oldest first */
  all(): StoreEntry[] {
    return this.entries;
  }

  /** Get entries with id >= sinceId, oldest first */
  allSince(sinceId: number): StoreEntry[] {
    // Binary search for the first entry with id >= sinceId
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.entries[mid].id < sinceId) lo = mid + 1;
      else hi = mid;
    }
    return this.entries.slice(lo);
  }

  /** The next ID that will be assigned. Use to bookmark a position for allSince(). */
  get currentId(): number {
    return this.nextId;
  }

  /** Filter entries by predicate */
  filter(predicate: (event: RuntimeEvent) => boolean): StoreEntry[] {
    return this.entries.filter((e) => predicate(e.event));
  }

  /** Get entries within a time window */
  since(ms: number): StoreEntry[] {
    const cutoff = Date.now() - ms;
    return this.entries.filter((e) => e.event.timestamp >= cutoff);
  }

  clear(): void {
    this.entries = [];
    // Re-anchor the per-step clock. The app-eval runner calls `__dt.clear()`
    // before every step (`runner/execute.ts → clearEventBuffer`), so this
    // gives every subsequent event a fresh `tSinceStepStart` measurement.
    this._stepStartT = typeof performance !== 'undefined' ? performance.now() : 0;
    this.broadcaster?.sendClear();
    this.notify();
  }

  /**
   * Anchor for `tSinceStepStart` (flow schema v2). Returns the
   * `performance.now()` reading captured at the most recent `clear()`.
   */
  get stepStartT(): number {
    return this._stepStartT;
  }

  enable(): void {
    this.enabled = true;
    this.notify();
  }
  disable(): void {
    this.enabled = false;
    this.notify();
  }

  get size(): number {
    return this.entries.length;
  }
  get isEnabled(): boolean {
    return this.enabled;
  }
}

/** Check if two events of the same type+timestamp are duplicates by comparing key fields. */
function isDuplicateEvent(a: RuntimeEvent, b: RuntimeEvent): boolean {
  switch (a.type) {
    case 'bridge':
      return (
        a.type === b.type &&
        (a as import('./types').BridgeCallEvent).method ===
          (b as import('./types').BridgeCallEvent).method &&
        (a as import('./types').BridgeCallEvent).bridgeName ===
          (b as import('./types').BridgeCallEvent).bridgeName
      );
    case 'eventbus':
      return (
        a.type === b.type &&
        (a as import('./types').EventBusEvent).eventType ===
          (b as import('./types').EventBusEvent).eventType
      );
    case 'actor':
      return (
        a.type === b.type &&
        (a as import('./types').ActorEvent).actorId ===
          (b as import('./types').ActorEvent).actorId &&
        (a as import('./types').ActorEvent).kind === (b as import('./types').ActorEvent).kind
      );
    case 'action':
      return (
        a.type === b.type &&
        (a as import('./types').ActionDispatchEvent).action ===
          (b as import('./types').ActionDispatchEvent).action
      );
    default:
      return false;
  }
}

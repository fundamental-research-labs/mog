/**
 * EffectiveStateManager — Generic Optimistic State
 *
 * During drag/resize/rotate operations, the effective state provides
 * 60fps visual preview without waiting for Yjs round-trip latency.
 * When an operation completes, the effective state is cleared.
 *
 * Zero domain knowledge — works with any state type T.
 *
 * @module @mog/canvas-engine/state
 */

import type { EffectiveStateManager } from '../core/types';

export class EffectiveStateManagerImpl<T> implements EffectiveStateManager<T> {
  private states = new Map<string, T>();

  setEffective(id: string, state: T): void {
    this.states.set(id, state);
  }

  getEffective(id: string): T | null {
    return this.states.get(id) ?? null;
  }

  clearEffective(id: string): void {
    this.states.delete(id);
  }

  clearAll(): void {
    this.states.clear();
  }

  /** Get the number of active effective states */
  get size(): number {
    return this.states.size;
  }

  /** Check if an object has an effective state */
  has(id: string): boolean {
    return this.states.has(id);
  }
}

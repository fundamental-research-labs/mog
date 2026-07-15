/**
 * Frame-scoped public interactive-element collector.
 *
 * Region adapters add only placed renderer-container elements here. The
 * collector owns cross-region accumulation, ID-based deduplication, and the
 * batched notification bridge to DOM overlay subscribers.
 */

import type { InteractiveElement, InteractiveElementCollector } from '@mog-sdk/contracts/rendering';

export class InteractiveElementCollectorImpl implements InteractiveElementCollector {
  private elements = new Map<string, InteractiveElement>();
  private subscribers = new Set<(elements: InteractiveElement[]) => void>();
  private pendingNotify = false;

  clear(): void {
    this.elements.clear();
    this.scheduleNotify();
  }

  add(element: InteractiveElement): void {
    this.elements.set(element.id, element);
    this.scheduleNotify();
  }

  getAll(): InteractiveElement[] {
    return Array.from(this.elements.values());
  }

  subscribe(callback: (elements: InteractiveElement[]) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Notify once after all synchronous region renders in the current task. */
  private scheduleNotify(): void {
    if (this.pendingNotify) return;
    this.pendingNotify = true;

    Promise.resolve().then(() => {
      this.pendingNotify = false;
      const all = this.getAll();
      for (const callback of this.subscribers) callback(all);
    });
  }
}

export function createInteractiveElementCollector(): InteractiveElementCollector {
  return new InteractiveElementCollectorImpl();
}

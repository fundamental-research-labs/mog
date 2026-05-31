export type ChartRenderCacheUpdateListener = (chartId: string) => void;

/**
 * Owns listener lifecycle for render cache updates.
 *
 * Unsubscribe closures capture the backing array by reference, so clear()
 * intentionally mutates the array in place.
 */
export class ChartRenderCacheListeners {
  private readonly listeners: ChartRenderCacheUpdateListener[] = [];

  subscribe(listener: ChartRenderCacheUpdateListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  clear(): void {
    this.listeners.length = 0;
  }

  fire(chartId: string): void {
    for (const listener of [...this.listeners]) {
      listener(chartId);
    }
  }
}

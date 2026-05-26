/**
 * Generic LRU cache with bounded size.
 * When maxSize is reached, the least recently used entry is evicted.
 *
 * Used by drawing-engine, Diagram, and bridges for caching
 * computed DrawingObjects, SVG filter strings, etc.
 */
export class BoundedCache<K, V> {
  private readonly _maxSize: number;
  private readonly _map: Map<K, V>;

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error('BoundedCache maxSize must be >= 1');
    this._maxSize = maxSize;
    this._map = new Map();
  }

  get(key: K): V | undefined {
    const value = this._map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used) by re-inserting
      this._map.delete(key);
      this._map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, delete first so re-insertion moves it to end
    if (this._map.has(key)) {
      this._map.delete(key);
    }
    this._map.set(key, value);
    // Evict LRU (first entry) if over capacity
    if (this._map.size > this._maxSize) {
      const firstKey = this._map.keys().next().value;
      if (firstKey !== undefined) {
        this._map.delete(firstKey);
      }
    }
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  delete(key: K): boolean {
    return this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  get size(): number {
    return this._map.size;
  }
}

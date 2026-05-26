import { BoundedCache } from '../src/bounded-cache';

describe('BoundedCache', () => {
  // Constructor
  it('throws on maxSize < 1', () => {
    expect(() => new BoundedCache(0)).toThrow();
    expect(() => new BoundedCache(-1)).toThrow();
  });

  it('works with maxSize = 1', () => {
    const cache = new BoundedCache<string, number>(1);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    cache.set('b', 2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.size).toBe(1);
  });

  // Basic operations
  it('get/set/has/delete/clear work correctly', () => {
    const cache = new BoundedCache<string, number>(10);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('a')).toBeUndefined();

    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);

    cache.set('b', 2);
    expect(cache.size).toBe(2);

    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  // LRU eviction
  it('evicts least recently used when capacity exceeded', () => {
    const cache = new BoundedCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // 'a' is LRU — adding 'd' should evict 'a'
    cache.set('d', 4);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('get() refreshes access order', () => {
    const cache = new BoundedCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to refresh it
    cache.get('a');

    // Now 'b' is LRU — adding 'd' should evict 'b'
    cache.set('d', 4);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('set() on existing key refreshes access order', () => {
    const cache = new BoundedCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Update 'a' to refresh it
    cache.set('a', 10);

    // Now 'b' is LRU
    cache.set('d', 4);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
  });

  it('handles non-string keys', () => {
    const cache = new BoundedCache<number, string>(3);
    cache.set(1, 'one');
    cache.set(2, 'two');
    expect(cache.get(1)).toBe('one');
    expect(cache.get(2)).toBe('two');
  });

  it('size tracks correctly through all operations', () => {
    const cache = new BoundedCache<string, number>(3);
    expect(cache.size).toBe(0);

    cache.set('a', 1);
    expect(cache.size).toBe(1);

    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(3);

    // Should not exceed maxSize
    cache.set('d', 4);
    expect(cache.size).toBe(3);

    cache.delete('b');
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('get returns undefined for evicted keys', () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
  });
});

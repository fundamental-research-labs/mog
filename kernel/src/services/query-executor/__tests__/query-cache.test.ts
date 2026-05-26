/**
 * Query Cache Tests
 *
 * Tests for the LRU cache implementation used by the query executor.
 */

import { QueryCache, buildCacheKey } from '../query-cache';

describe('QueryCache', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache(3); // Small capacity for testing LRU behavior
  });

  // ===========================================================================
  // Basic Operations
  // ===========================================================================

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const data = [
        ['Alice', 30],
        ['Bob', 25],
      ];

      cache.set('key1', data);
      const result = cache.get('key1');

      expect(result).toEqual(data);
    });

    it('should return undefined for non-existent keys', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should check key existence', () => {
      cache.set('key1', [['data']]);

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });

    it('should delete entries', () => {
      cache.set('key1', [['data']]);
      const deleted = cache.delete('key1');

      expect(deleted).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', [['data1']]);
      cache.set('key2', [['data2']]);
      cache.set('key3', [['data3']]);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(false);
    });
  });

  // ===========================================================================
  // Metadata Storage
  // ===========================================================================

  describe('metadata storage', () => {
    it('should store and retrieve metadata', () => {
      const data = [
        ['Alice', 30],
        ['Bob', 25],
      ];
      const metadata = {
        columnNames: ['name', 'age'],
        columnTypes: ['string', 'number'],
      };

      cache.set('key1', data, metadata);
      const entry = cache.getEntry('key1');

      expect(entry).toBeDefined();
      expect(entry?.result).toEqual(data);
      expect(entry?.columnNames).toEqual(['name', 'age']);
      expect(entry?.columnTypes).toEqual(['string', 'number']);
    });

    it('should handle entries without metadata', () => {
      cache.set('key1', [['data']]);
      const entry = cache.getEntry('key1');

      expect(entry).toBeDefined();
      expect(entry?.columnNames).toBeUndefined();
      expect(entry?.columnTypes).toBeUndefined();
    });
  });

  // ===========================================================================
  // LRU Eviction
  // ===========================================================================

  describe('LRU eviction', () => {
    it('should evict least recently used entry when at capacity', () => {
      // Fill cache to capacity
      cache.set('key1', [['data1']]);
      cache.set('key2', [['data2']]);
      cache.set('key3', [['data3']]);

      expect(cache.size()).toBe(3);

      // Add one more - should evict key1
      cache.set('key4', [['data4']]);

      expect(cache.size()).toBe(3);
      expect(cache.has('key1')).toBe(false); // Evicted
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update LRU order on get', () => {
      cache.set('key1', [['data1']]);
      cache.set('key2', [['data2']]);
      cache.set('key3', [['data3']]);

      // Access key1 - makes it most recently used
      cache.get('key1');

      // Add key4 - should evict key2 (least recently used)
      cache.set('key4', [['data4']]);

      expect(cache.has('key1')).toBe(true); // Not evicted (was accessed)
      expect(cache.has('key2')).toBe(false); // Evicted
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should not evict when updating existing key', () => {
      cache.set('key1', [['data1']]);
      cache.set('key2', [['data2']]);
      cache.set('key3', [['data3']]);

      // Update existing key
      cache.set('key2', [['updated']]);

      expect(cache.size()).toBe(3);
      expect(cache.get('key2')).toEqual([['updated']]);
    });
  });

  // ===========================================================================
  // Cache Statistics
  // ===========================================================================

  describe('cache statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', [['data']]);

      // Hit
      cache.get('key1');
      // Miss
      cache.get('key2');
      // Hit
      cache.get('key1');
      // Miss
      cache.get('key3');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should report correct cache size and capacity', () => {
      cache.set('key1', [['data1']]);
      cache.set('key2', [['data2']]);

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.capacity).toBe(3);
    });

    it('should reset stats on clear', () => {
      cache.set('key1', [['data']]);
      cache.get('key1');
      cache.get('nonexistent');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });

    it('should handle zero hit rate', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  // ===========================================================================
  // Prefix Invalidation
  // ===========================================================================

  describe('prefix invalidation', () => {
    it('should invalidate entries by prefix', () => {
      cache.set('conn1|SELECT *', [['data1']]);
      cache.set('conn1|SELECT id', [['data2']]);
      cache.set('conn2|SELECT *', [['data3']]);

      const count = cache.invalidateByPrefix('conn1|');

      expect(count).toBe(2);
      expect(cache.has('conn1|SELECT *')).toBe(false);
      expect(cache.has('conn1|SELECT id')).toBe(false);
      expect(cache.has('conn2|SELECT *')).toBe(true);
    });

    it('should return zero when no entries match prefix', () => {
      cache.set('key1', [['data']]);

      const count = cache.invalidateByPrefix('nonexistent|');

      expect(count).toBe(0);
      expect(cache.size()).toBe(1);
    });
  });

  // ===========================================================================
  // Cache Keys
  // ===========================================================================

  describe('cache keys', () => {
    it('should return all cache keys', () => {
      cache.set('key1', [['data1']]);
      cache.set('key2', [['data2']]);
      cache.set('key3', [['data3']]);

      const keys = cache.keys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should return empty array for empty cache', () => {
      const keys = cache.keys();
      expect(keys).toEqual([]);
    });
  });
});

describe('buildCacheKey', () => {
  it('should build consistent cache keys', () => {
    const key1 = buildCacheKey('mydb', 'SELECT * FROM users', [1, 2, 3]);
    const key2 = buildCacheKey('mydb', 'SELECT * FROM users', [1, 2, 3]);

    expect(key1).toBe(key2);
  });

  it('should normalize SQL by trimming whitespace only', () => {
    const key1 = buildCacheKey('mydb', '  SELECT * FROM users  ');
    const key2 = buildCacheKey('mydb', 'SELECT * FROM users');

    expect(key1).toBe(key2);
  });

  it('should preserve case in SQL to avoid corrupting string literals', () => {
    const key1 = buildCacheKey('mydb', "SELECT * FROM users WHERE city = 'New York'");
    const key2 = buildCacheKey('mydb', "SELECT * FROM users WHERE city = 'new york'");

    expect(key1).not.toBe(key2);
  });

  it('should differentiate by connection name', () => {
    const key1 = buildCacheKey('conn1', 'SELECT *');
    const key2 = buildCacheKey('conn2', 'SELECT *');

    expect(key1).not.toBe(key2);
  });

  it('should differentiate by SQL', () => {
    const key1 = buildCacheKey('mydb', 'SELECT * FROM users');
    const key2 = buildCacheKey('mydb', 'SELECT * FROM posts');

    expect(key1).not.toBe(key2);
  });

  it('should differentiate by parameters', () => {
    const key1 = buildCacheKey('mydb', 'SELECT * WHERE id = ?', [1]);
    const key2 = buildCacheKey('mydb', 'SELECT * WHERE id = ?', [2]);

    expect(key1).not.toBe(key2);
  });

  it('should handle empty parameters', () => {
    const key1 = buildCacheKey('mydb', 'SELECT *');
    const key2 = buildCacheKey('mydb', 'SELECT *', []);

    expect(key1).toBe(key2);
  });

  it('should serialize complex parameters', () => {
    const params = [{ name: 'Alice' }, [1, 2, 3], null, true];
    const key = buildCacheKey('mydb', 'SELECT *', params);

    expect(key).toContain(JSON.stringify(params));
  });
});

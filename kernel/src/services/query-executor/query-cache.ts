/**
 * Query Cache Implementation
 *
 * Simple LRU cache for query results.
 * Stores query results keyed by hash(connection + sql + params).
 *
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import type { QueryCacheEntry } from './types';

/**
 * Simple LRU (Least Recently Used) cache implementation.
 *
 * Uses a Map with access-order tracking. When capacity is exceeded,
 * the least recently accessed entry is evicted.
 */
export class QueryCache {
  private cache: Map<string, QueryCacheEntry> = new Map();
  private capacity: number;
  private hits = 0;
  private misses = 0;

  /**
   * Create a new query cache.
   * @param capacity - Maximum number of entries to cache (default: 100)
   */
  constructor(capacity = 100) {
    this.capacity = capacity;
  }

  /**
   * Get a cached result.
   * @param key - Cache key
   * @returns Cached data or undefined if not found
   */
  get(key: string): CellValue[][] | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Move to end (most recently used) by deleting and re-inserting
      this.cache.delete(key);
      this.cache.set(key, entry);
      this.hits++;
      return entry.result;
    }
    this.misses++;
    return undefined;
  }

  /**
   * Get full cache entry with metadata.
   * @param key - Cache key
   * @returns Cache entry or undefined if not found
   */
  getEntry(key: string): QueryCacheEntry | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, entry);
      this.hits++;
      return entry;
    }
    this.misses++;
    return undefined;
  }

  /**
   * Set a cached result.
   * @param key - Cache key
   * @param result - Query result data
   * @param metadata - Optional metadata (column names, types)
   */
  set(
    key: string,
    result: CellValue[][],
    metadata?: { columnNames?: string[]; columnTypes?: string[] },
  ): void {
    // If at capacity, evict least recently used (first entry)
    if (this.cache.size >= this.capacity && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const entry: QueryCacheEntry = {
      key,
      result,
      cachedAt: Date.now(),
      columnNames: metadata?.columnNames,
      columnTypes: metadata?.columnTypes,
    };

    // Delete first to ensure proper LRU ordering
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  /**
   * Check if a key exists in the cache.
   * @param key - Cache key
   * @returns True if key exists
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a cached entry.
   * @param key - Cache key
   * @returns True if entry was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Invalidate cache entries by prefix.
   * Useful for invalidating all queries for a specific connection.
   * @param prefix - Key prefix to match
   * @returns Number of entries invalidated
   */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Get cache statistics.
   * @returns Cache stats
   */
  getStats(): { size: number; capacity: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Get all cache keys.
   * @returns Array of cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size.
   * @returns Number of entries in cache
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Build a cache key from query parameters.
 * Uses a simple hash of connection + sql + JSON.stringify(params).
 *
 * @param connectionId - Connection identifier (use connection.id, not name)
 * @param sql - SQL query (trimmed and normalized)
 * @param params - Query parameters
 * @returns Cache key string
 */
export function buildCacheKey(connectionId: string, sql: string, params?: unknown[]): string {
  // Normalize SQL: trim whitespace for consistent caching
  // Note: we intentionally do NOT lowercase SQL because that would corrupt
  // string literals (e.g., WHERE city = 'New York' vs 'new york') and cause
  // incorrect cache hits against case-sensitive databases.
  const normalizedSql = sql.trim();

  // Serialize params for consistent key generation
  const paramsStr = params && params.length > 0 ? JSON.stringify(params) : '';

  // Simple hash: connection|sql|params
  return `${connectionId}|${normalizedSql}|${paramsStr}`;
}

/**
 * Query Executor Tests
 *
 * Tests for the query executor service that manages query connection metadata,
 * caching, and re-evaluation triggers.
 */

import { jest } from '@jest/globals';

import { createQueryExecutor } from '../query-executor';
import type { ConnectionConfig, IConnectionResolver, IQueryExecutor, QueryResult } from '../types';

type QueryResponse = QueryResult;

describe('QueryExecutor', () => {
  const mockBridge = {
    query: jest.fn(),
  };
  let executor: IQueryExecutor;

  beforeEach(() => {
    executor = createQueryExecutor({ cacheCapacity: 5 });
  });

  afterEach(() => {
    executor.dispose();
  });

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  describe('connection management', () => {
    it('should register a connection', () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const retrieved = executor.getConnection('analytics');
      expect(retrieved).toEqual(config);
    });

    it('should list all connection names', () => {
      const config1: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      const config2: ConnectionConfig = {
        id: 'conn-2',
        name: 'users',
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'users',
      };

      executor.registerConnection('analytics', config1);
      executor.registerConnection('users', config2);

      const names = executor.listConnections();
      expect(names).toHaveLength(2);
      expect(names).toContain('analytics');
      expect(names).toContain('users');
    });

    it('should return undefined for non-existent connection', () => {
      const connection = executor.getConnection('nonexistent');
      expect(connection).toBeUndefined();
    });

    it('should remove a connection', () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);
      executor.removeConnection('analytics');

      const retrieved = executor.getConnection('analytics');
      expect(retrieved).toBeUndefined();
    });

    it('should invalidate cache when removing connection', () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      // Cache a result (uses connection.id for cache key, not name)
      const cacheKey = executor.buildCacheKey('conn-1', 'SELECT 1', []);
      executor.setCachedResult(cacheKey, [[1]]);

      expect(executor.getCachedResult(cacheKey)).toEqual([[1]]);

      // Remove connection - should invalidate cache (resolves name to id internally)
      executor.removeConnection('analytics');

      expect(executor.getCachedResult(cacheKey)).toBeUndefined();
    });
  });

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  describe('cache management', () => {
    it('should cache and retrieve query results', () => {
      const result = [
        ['Alice', 30],
        ['Bob', 25],
      ];

      const cacheKey = executor.buildCacheKey('mydb', 'SELECT * FROM users', []);
      executor.setCachedResult(cacheKey, result);

      const cached = executor.getCachedResult(cacheKey);
      expect(cached).toEqual(result);
    });

    it('should return undefined for cache miss', () => {
      const cacheKey = executor.buildCacheKey('mydb', 'SELECT *', []);
      const cached = executor.getCachedResult(cacheKey);
      expect(cached).toBeUndefined();
    });

    it('should build consistent cache keys', () => {
      const key1 = executor.buildCacheKey('mydb', 'SELECT * FROM users', [1, 2]);
      const key2 = executor.buildCacheKey('mydb', 'SELECT * FROM users', [1, 2]);
      expect(key1).toBe(key2);
    });

    it('should differentiate cache keys by parameters', () => {
      const key1 = executor.buildCacheKey('mydb', 'SELECT *', [1]);
      const key2 = executor.buildCacheKey('mydb', 'SELECT *', [2]);
      expect(key1).not.toBe(key2);
    });

    it('should invalidate all cache entries', () => {
      const key1 = executor.buildCacheKey('conn1', 'SELECT 1', []);
      const key2 = executor.buildCacheKey('conn2', 'SELECT 2', []);

      executor.setCachedResult(key1, [[1]]);
      executor.setCachedResult(key2, [[2]]);

      executor.invalidateCache();

      expect(executor.getCachedResult(key1)).toBeUndefined();
      expect(executor.getCachedResult(key2)).toBeUndefined();
    });

    it('should invalidate cache for specific connection by id', () => {
      const key1 = executor.buildCacheKey('conn-id-1', 'SELECT 1', []);
      const key2 = executor.buildCacheKey('conn-id-1', 'SELECT 2', []);
      const key3 = executor.buildCacheKey('conn-id-2', 'SELECT 3', []);

      executor.setCachedResult(key1, [[1]]);
      executor.setCachedResult(key2, [[2]]);
      executor.setCachedResult(key3, [[3]]);

      executor.invalidateCache('conn-id-1');

      expect(executor.getCachedResult(key1)).toBeUndefined();
      expect(executor.getCachedResult(key2)).toBeUndefined();
      expect(executor.getCachedResult(key3)).toEqual([[3]]);
    });

    it('should return cache statistics', () => {
      const key1 = executor.buildCacheKey('mydb', 'SELECT 1', []);
      const key2 = executor.buildCacheKey('mydb', 'SELECT 2', []);

      executor.setCachedResult(key1, [[1]]);
      executor.setCachedResult(key2, [[2]]);

      // Hit
      executor.getCachedResult(key1);
      // Miss
      executor.getCachedResult('nonexistent');

      const stats = executor.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  describe.skip('query execution', () => {
    it('should execute query successfully via bridge and cache result', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const bridgeResponse: QueryResponse = {
        data: [
          ['Alice', 30],
          ['Bob', 25],
        ],
        columnNames: ['name', 'age'],
        columnTypes: ['string', 'number'],
        rowCount: 2,
        executionTimeMs: 15,
        truncated: false,
      };

      (mockBridge.query as jest.Mock).mockResolvedValueOnce(bridgeResponse);

      const result = await executor.executeQuery('analytics', 'SELECT * FROM users', []);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.data).toEqual(bridgeResponse.data);
        expect(result.value.columnNames).toEqual(['name', 'age']);
        expect(result.value.rowCount).toBe(2);
      }

      // Verify bridge was called correctly
      expect(mockBridge.query).toHaveBeenCalledWith('conn-1', 'SELECT * FROM users', []);

      // Verify result was cached (uses connection.id, not connection name)
      const cacheKey = executor.buildCacheKey('conn-1', 'SELECT * FROM users', []);
      const cached = executor.getCachedResult(cacheKey);
      expect(cached).toEqual(bridgeResponse.data);
    });

    it('should return error result for non-existent connection', async () => {
      const result = await executor.executeQuery('nonexistent', 'SELECT 1', []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Connection "nonexistent" not found');
      }
    });

    it('should handle bridge errors', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      (mockBridge.query as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

      const result = await executor.executeQuery('analytics', 'SELECT 1', []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('execution_error');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('should pass parameters to bridge query', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const bridgeResponse: QueryResponse = {
        data: [['Alice']],
        columnNames: ['name'],
        columnTypes: ['string'],
        rowCount: 1,
        executionTimeMs: 5,
        truncated: false,
      };

      (mockBridge.query as jest.Mock).mockResolvedValueOnce(bridgeResponse);

      const params = [1, 'Alice', true];
      await executor.executeQuery('analytics', 'SELECT * WHERE id = ?', params);

      expect(mockBridge.query).toHaveBeenCalledWith('conn-1', 'SELECT * WHERE id = ?', params);
    });
  });

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  describe.skip('event handling', () => {
    it('should emit query complete event on successful execution', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const bridgeResponse: QueryResponse = {
        data: [[1]],
        columnNames: ['val'],
        columnTypes: ['number'],
        rowCount: 1,
        executionTimeMs: 5,
        truncated: false,
      };

      (mockBridge.query as jest.Mock).mockResolvedValueOnce(bridgeResponse);

      const onComplete = jest.fn();
      executor.onQueryComplete(onComplete);

      await executor.executeQuery('analytics', 'SELECT 1', []);

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: executor.buildCacheKey('conn-1', 'SELECT 1', []),
          result: expect.objectContaining({ success: true }),
          completedAt: expect.any(Number),
        }),
      );
    });

    it('should not emit event on failed execution', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      (mockBridge.query as jest.Mock).mockRejectedValueOnce(new Error('Bridge failure'));

      const onComplete = jest.fn();
      executor.onQueryComplete(onComplete);

      const result = await executor.executeQuery('analytics', 'SELECT 1', []);
      expect(result.ok).toBe(false);

      expect(onComplete).not.toHaveBeenCalled();
    });

    it('should support multiple event listeners', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const bridgeResponse: QueryResponse = {
        data: [[1]],
        columnNames: ['val'],
        columnTypes: ['number'],
        rowCount: 1,
        executionTimeMs: 5,
        truncated: false,
      };

      (mockBridge.query as jest.Mock).mockResolvedValueOnce(bridgeResponse);

      const listener1 = jest.fn();
      const listener2 = jest.fn();

      executor.onQueryComplete(listener1);
      executor.onQueryComplete(listener2);

      await executor.executeQuery('analytics', 'SELECT 1', []);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe event listeners', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const bridgeResponse: QueryResponse = {
        data: [[1]],
        columnNames: ['val'],
        columnTypes: ['number'],
        rowCount: 1,
        executionTimeMs: 5,
        truncated: false,
      };

      const listener = jest.fn();
      const subscription = executor.onQueryComplete(listener);

      // Unsubscribe before executing
      subscription.dispose();

      (mockBridge.query as jest.Mock).mockResolvedValueOnce(bridgeResponse);

      await executor.executeQuery('analytics', 'SELECT 1', []);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle errors in event listeners gracefully', async () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const bridgeResponse: QueryResponse = {
        data: [[1]],
        columnNames: ['val'],
        columnTypes: ['number'],
        rowCount: 1,
        executionTimeMs: 5,
        truncated: false,
      };

      (mockBridge.query as jest.Mock).mockResolvedValueOnce(bridgeResponse);

      const errorListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = jest.fn();

      executor.onQueryComplete(errorListener);
      executor.onQueryComplete(goodListener);

      // Should not throw despite listener error
      await executor.executeQuery('analytics', 'SELECT 1', []);

      expect(errorListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Connection Resolver
  // ===========================================================================

  describe('connection resolver', () => {
    const resolverConfig: ConnectionConfig = {
      id: 'resolver-conn-1',
      name: 'external-db',
      type: 'postgres',
      host: 'remote-host',
      port: 5432,
      database: 'external',
    };

    const localConfig: ConnectionConfig = {
      id: 'local-conn-1',
      name: 'local-db',
      type: 'clickhouse',
      host: 'localhost',
      port: 8123,
      database: 'local',
    };

    function createMockResolver(configs: Map<string, ConnectionConfig>): IConnectionResolver {
      return {
        getConnectionConfig: (name: string) => configs.get(name),
        listConnectionNames: () => Array.from(configs.keys()),
      };
    }

    it('should resolve connection from resolver when provided', () => {
      const configs = new Map([['external-db', resolverConfig]]);
      const resolverExecutor = createQueryExecutor({
        cacheCapacity: 5,
        connectionResolver: createMockResolver(configs),
      });

      const connection = resolverExecutor.getConnection('external-db');
      expect(connection).toEqual(resolverConfig);

      resolverExecutor.dispose();
    });

    it('should fall back to local registry when resolver does not have connection', () => {
      const configs = new Map([['external-db', resolverConfig]]);
      const resolverExecutor = createQueryExecutor({
        cacheCapacity: 5,
        connectionResolver: createMockResolver(configs),
      });

      resolverExecutor.registerConnection('local-db', localConfig);

      // Resolver doesn't have 'local-db', should fall back to local
      const connection = resolverExecutor.getConnection('local-db');
      expect(connection).toEqual(localConfig);

      resolverExecutor.dispose();
    });

    it('should prefer resolver over local registry for same name', () => {
      const resolverVersion: ConnectionConfig = {
        ...resolverConfig,
        name: 'shared-db',
        host: 'resolver-host',
      };
      const localVersion: ConnectionConfig = {
        ...localConfig,
        name: 'shared-db',
        host: 'local-host',
      };

      const configs = new Map([['shared-db', resolverVersion]]);
      const resolverExecutor = createQueryExecutor({
        cacheCapacity: 5,
        connectionResolver: createMockResolver(configs),
      });

      resolverExecutor.registerConnection('shared-db', localVersion);

      // Resolver takes priority
      const connection = resolverExecutor.getConnection('shared-db');
      expect(connection?.host).toBe('resolver-host');

      resolverExecutor.dispose();
    });

    it('should return undefined when neither resolver nor local has the connection', () => {
      const configs = new Map([['external-db', resolverConfig]]);
      const resolverExecutor = createQueryExecutor({
        cacheCapacity: 5,
        connectionResolver: createMockResolver(configs),
      });

      const connection = resolverExecutor.getConnection('nonexistent');
      expect(connection).toBeUndefined();

      resolverExecutor.dispose();
    });

    it('should merge connection names from resolver and local registry', () => {
      const configs = new Map([
        ['resolver-only', resolverConfig],
        ['shared', resolverConfig],
      ]);
      const resolverExecutor = createQueryExecutor({
        cacheCapacity: 5,
        connectionResolver: createMockResolver(configs),
      });

      resolverExecutor.registerConnection('local-only', localConfig);
      resolverExecutor.registerConnection('shared', localConfig);

      const names = resolverExecutor.listConnections();
      expect(names).toHaveLength(3);
      expect(names).toContain('resolver-only');
      expect(names).toContain('local-only');
      expect(names).toContain('shared');

      resolverExecutor.dispose();
    });

    it('should list only local connections when no resolver is provided', () => {
      // Uses the default executor from beforeEach (no resolver)
      executor.registerConnection('local-db', localConfig);

      const names = executor.listConnections();
      expect(names).toEqual(['local-db']);
    });

    it.skip('should execute query using connection from resolver', async () => {
      const configs = new Map([['external-db', resolverConfig]]);
      const resolverExecutor = createQueryExecutor({
        cacheCapacity: 5,
        connectionResolver: createMockResolver(configs),
      });

      const bridgeResponse: QueryResponse = {
        data: [['result']],
        columnNames: ['val'],
        columnTypes: ['string'],
        rowCount: 1,
        executionTimeMs: 5,
        truncated: false,
      };

      (mockBridge.query as jest.Mock).mockResolvedValueOnce(bridgeResponse);

      const result = await resolverExecutor.executeQuery('external-db', 'SELECT 1', []);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.data).toEqual([['result']]);
      }

      // Verify the resolver's connection ID was used in bridge call
      expect(mockBridge.query).toHaveBeenCalledWith('resolver-conn-1', 'SELECT 1', []);

      resolverExecutor.dispose();
    });
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('should clean up resources on dispose', () => {
      const config: ConnectionConfig = {
        id: 'conn-1',
        name: 'analytics',
        type: 'clickhouse',
        host: 'localhost',
        port: 8123,
        database: 'events',
      };

      executor.registerConnection('analytics', config);

      const cacheKey = executor.buildCacheKey('conn-1', 'SELECT 1', []);
      executor.setCachedResult(cacheKey, [[1]]);

      executor.dispose();

      expect(executor.listConnections()).toEqual([]);
      expect(executor.getCachedResult(cacheKey)).toBeUndefined();
    });
  });
});

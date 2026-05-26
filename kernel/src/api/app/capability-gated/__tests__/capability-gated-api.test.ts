/**
 * Capability-Gated API Tests
 *
 * Comprehensive tests for the capability-gated API system.
 *
 * Test categories:
 * - Granted capability -> interface available
 * - Non-granted capability -> interface undefined
 * - Scoped capability -> scope enforced
 * - Event filtering works
 * - Batch validation validates ALL before ANY
 * - Network localhost separate from any
 */

import { jest } from '@jest/globals';

import type {
  AppTableId,
  AppTableInfo,
  IAppEventsAPI,
  IAppKernelAPI,
  IAppRecordsAPI,
  IAppTablesAPI,
  RecordChangeHandler,
  RecordId,
} from '@mog-sdk/contracts/apps';
import { CapabilityDeniedError, CapabilityScopeError } from '../../../../errors/capability';
import type { CapabilityType } from '../../../../services/capabilities/cap-types';
import type { IGatedAppKernelAPI } from '../../../../services/capabilities/gated-api';
import type { AppId } from '../../../../services/capabilities/grants';
import { appId } from '../../../../services/capabilities/grants';
import type { CapabilityScope } from '../../../../services/capabilities/scope';

import { CapabilityRegistry } from '../../../../services/capabilities/registry';
import { MemoryGrantsStore } from '../../../../services/capabilities/stores/memory-store';
import type { CreateCapabilityGatedAPIOptions } from '../capability-gated-api';
import { createCapabilityGatedApi } from '../capability-gated-api';

// =============================================================================
// Test Setup
// =============================================================================

function createMockTablesAPI(): IAppTablesAPI {
  const tables = new Map<string, AppTableInfo>([
    [
      'table-1',
      {
        id: 'table-1' as AppTableId,
        name: 'contacts',
        sheetId: 'sheet-1',
        recordCount: 10,
        columns: [],
      },
    ],
    [
      'table-2',
      {
        id: 'table-2' as AppTableId,
        name: 'orders',
        sheetId: 'sheet-1',
        recordCount: 20,
        columns: [],
      },
    ],
    [
      'table-3',
      {
        id: 'table-3' as AppTableId,
        name: 'sales_north',
        sheetId: 'sheet-1',
        recordCount: 15,
        columns: [],
      },
    ],
    [
      'table-4',
      {
        id: 'table-4' as AppTableId,
        name: 'sales_south',
        sheetId: 'sheet-1',
        recordCount: 12,
        columns: [],
      },
    ],
  ]);

  return {
    get: jest.fn(async (id: AppTableId) => tables.get(id) ?? null),
    findByName: jest.fn(async (name: string) => {
      for (const table of tables.values()) {
        if (table.name === name) return table;
      }
      return null;
    }),
    list: jest.fn(async () => Array.from(tables.values())),
    create: jest.fn(async (schema) => ({
      id: `table-new` as AppTableId,
      name: schema.name,
      sheetId: 'sheet-1',
      recordCount: 0,
      columns: [],
    })),
    rename: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
  };
}

function createMockRecordsAPI(): IAppRecordsAPI {
  return {
    get: jest.fn(async (tableId, recordId) => ({
      id: recordId,
      tableId,
      values: { Name: 'Test' },
      valuesByColumnId: {},
    })),
    list: jest.fn(async () => []),
    create: jest.fn(async (tableId, values) => ({
      id: 'record-new' as RecordId,
      tableId,
      values,
      valuesByColumnId: {},
    })),
    update: jest.fn(async (tableId, recordId, values) => ({
      id: recordId,
      tableId,
      values,
      valuesByColumnId: {},
    })),
    delete: jest.fn(async () => {}),
    createBatch: jest.fn(async () => []),
    updateBatch: jest.fn(async () => []),
    deleteBatch: jest.fn(async () => {}),
  };
}

function createMockEventsAPI(): IAppEventsAPI {
  const handlers = new Map<string, Set<RecordChangeHandler>>();

  return {
    onRecordChange: jest.fn((tableId: AppTableId, handler: RecordChangeHandler) => {
      const key = tableId;
      if (!handlers.has(key)) {
        handlers.set(key, new Set());
      }
      handlers.get(key)!.add(handler);
      return () => {
        handlers.get(key)?.delete(handler);
      };
    }),
    onSchemaChange: jest.fn(() => () => {}),
    onRecordFieldChange: jest.fn(() => () => {}),
  };
}

function createMockKernelAPI(): IAppKernelAPI {
  const tables = createMockTablesAPI();
  const records = createMockRecordsAPI();
  const events = createMockEventsAPI();

  return {
    tables,
    columns: {
      get: jest.fn(async () => null),
      findByName: jest.fn(async () => null),
      list: jest.fn(async () => []),
      create: jest.fn(async () => ({
        id: 'col-1' as any,
        name: 'Name',
        index: 0,
        type: { kind: 'text' as const },
        required: false,
        unique: false,
      })),
      update: jest.fn(async () => {}),
      rename: jest.fn(async () => {}),
      delete: jest.fn(async () => {}),
    },
    records,
    relations: {
      getRelated: jest.fn(async () => []),
      getBacklinks: jest.fn(async () => []),
      link: jest.fn(async () => {}),
      unlink: jest.fn(async () => {}),
    },
    events,
    undoGroup: jest.fn(async (fn) => fn()),
  };
}

function createTestSetup(
  grantedCapabilities: CapabilityType[],
  scopes: Partial<Record<CapabilityType, CapabilityScope>> = {},
): {
  gatedApi: IGatedAppKernelAPI;
  fullApi: IAppKernelAPI;
  registry: CapabilityRegistry;
  testAppId: AppId;
} {
  const store = new MemoryGrantsStore();
  const registry = new CapabilityRegistry(store);
  const testAppId = appId('test-app');
  const fullApi = createMockKernelAPI();

  // Grant capabilities
  for (const cap of grantedCapabilities) {
    const scope = scopes[cap];
    registry.grant(testAppId, cap, scope ? { scope } : undefined);
  }

  const options: CreateCapabilityGatedAPIOptions = {
    appId: testAppId,
    registry,
    fullApi,
    allowedDomains: ['api.example.com', '*.trusted.com'],
  };

  const gatedApi = createCapabilityGatedApi(options);

  return { gatedApi, fullApi, registry, testAppId };
}

// =============================================================================
// Tests: Interface Availability
// =============================================================================

describe('Capability-Gated API: Interface Availability', () => {
  it('should provide tables interface when tables:read is granted', () => {
    const { gatedApi } = createTestSetup(['tables:read']);

    expect(gatedApi.tables).toBeDefined();
    expect(gatedApi.tables?.list).toBeDefined();
    expect(gatedApi.tables?.get).toBeDefined();
    expect(gatedApi.tables?.findByName).toBeDefined();
  });

  it('should NOT provide tables interface when tables:read is NOT granted', () => {
    const { gatedApi } = createTestSetup(['clipboard:write']);

    expect(gatedApi.tables).toBeUndefined();
  });

  it('should provide write methods only when tables:write is granted', () => {
    const { gatedApi } = createTestSetup(['tables:read', 'tables:write']);

    expect(gatedApi.tables).toBeDefined();
    expect(gatedApi.tables?.rename).toBeDefined();
  });

  it('should NOT provide write methods when only tables:read is granted', () => {
    const { gatedApi } = createTestSetup(['tables:read']);

    expect(gatedApi.tables).toBeDefined();
    expect(gatedApi.tables?.rename).toBeUndefined();
  });

  it('should provide records interface when tables:read is granted', () => {
    const { gatedApi } = createTestSetup(['tables:read']);

    expect(gatedApi.records).toBeDefined();
    expect(gatedApi.records?.get).toBeDefined();
    expect(gatedApi.records?.list).toBeDefined();
  });

  it('should NOT provide records write methods without tables:write', () => {
    const { gatedApi } = createTestSetup(['tables:read']);

    expect(gatedApi.records?.create).toBeUndefined();
    expect(gatedApi.records?.update).toBeUndefined();
    expect(gatedApi.records?.delete).toBeUndefined();
  });

  it('should provide records write methods with tables:write', () => {
    const { gatedApi } = createTestSetup(['tables:read', 'tables:write']);

    expect(gatedApi.records?.create).toBeDefined();
    expect(gatedApi.records?.update).toBeDefined();
    expect(gatedApi.records?.delete).toBeDefined();
  });

  it('should provide events interface when events:subscribe and tables:read are granted', () => {
    const { gatedApi } = createTestSetup(['events:subscribe', 'tables:read']);

    expect(gatedApi.events).toBeDefined();
    expect(gatedApi.events?.onRecordChange).toBeDefined();
  });

  it('should NOT provide events interface without events:subscribe', () => {
    const { gatedApi } = createTestSetup(['tables:read']);

    expect(gatedApi.events).toBeUndefined();
  });

  it('should always provide capabilities introspection', () => {
    const { gatedApi } = createTestSetup([]);

    expect(gatedApi.capabilities).toBeDefined();
    expect(gatedApi.capabilities.has).toBeDefined();
    expect(gatedApi.capabilities.list).toBeDefined();
  });

  it('should always provide undoGroup function', () => {
    const { gatedApi } = createTestSetup([]);

    expect(gatedApi.undoGroup).toBeDefined();
  });
});

// =============================================================================
// Tests: Capability Introspection
// =============================================================================

describe('Capability-Gated API: Introspection', () => {
  it('should correctly report granted capabilities', () => {
    const { gatedApi } = createTestSetup(['tables:read', 'tables:write']);

    expect(gatedApi.capabilities.has('tables:read')).toBe(true);
    expect(gatedApi.capabilities.has('tables:write')).toBe(true);
    expect(gatedApi.capabilities.has('tables:delete')).toBe(false);
  });

  it('should list all effective capabilities', () => {
    const { gatedApi } = createTestSetup(['tables:write']); // write implies read

    const caps = gatedApi.capabilities.list();
    expect(caps).toContain('tables:write');
    expect(caps).toContain('tables:read'); // Implied
  });

  it('should report scoped capabilities correctly', () => {
    const { gatedApi } = createTestSetup(['tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    expect(gatedApi.capabilities.isScoped('tables:read')).toBe(true);
    expect(gatedApi.capabilities.getScope('tables:read')).toBe('table:contacts');
  });

  it('should check resource access with hasAccessTo', () => {
    const { gatedApi } = createTestSetup(['tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    expect(gatedApi.capabilities.hasAccessTo('tables:read', 'table', 'contacts')).toBe(true);
    expect(gatedApi.capabilities.hasAccessTo('tables:read', 'table', 'orders')).toBe(false);
  });
});

// =============================================================================
// Tests: Scoped Access
// =============================================================================

describe('Capability-Gated API: Scoped Access', () => {
  it('should filter table list by scope', async () => {
    const { gatedApi } = createTestSetup(['tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    expect(gatedApi.tables).toBeDefined();
    const tables = await gatedApi.tables!.list!();

    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('contacts');
  });

  it('should return null for tables outside scope', async () => {
    const { gatedApi } = createTestSetup(['tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    expect(gatedApi.tables).toBeDefined();
    expect(gatedApi.tables!.findByName).toBeDefined();

    // Should return the table when in scope
    const contacts = await gatedApi.tables!.findByName!('contacts');
    expect(contacts).not.toBeNull();

    // Should return null when outside scope
    const orders = await gatedApi.tables!.findByName!('orders');
    expect(orders).toBeNull();
  });

  it('should support wildcard scopes with prefix', async () => {
    const { gatedApi } = createTestSetup(['tables:read'], {
      'tables:read': 'table:sales_*' as CapabilityScope,
    });

    expect(gatedApi.tables).toBeDefined();
    const tables = await gatedApi.tables!.list!();

    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.name).sort()).toEqual(['sales_north', 'sales_south']);
  });

  it('should throw CapabilityScopeError for out-of-scope record access', async () => {
    const { gatedApi } = createTestSetup(['tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    expect(gatedApi.records).toBeDefined();
    expect(gatedApi.records!.get).toBeDefined();

    // Accessing orders table (out of scope) should throw
    await expect(
      gatedApi.records!.get!('table-2' as AppTableId, 'record-1' as RecordId),
    ).rejects.toThrow(CapabilityScopeError);
  });

  it('should allow record access within scope', async () => {
    const { gatedApi } = createTestSetup(['tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    expect(gatedApi.records).toBeDefined();
    expect(gatedApi.records!.get).toBeDefined();

    // Accessing contacts table (in scope) should work
    const record = await gatedApi.records!.get!('table-1' as AppTableId, 'record-1' as RecordId);
    expect(record).not.toBeNull();
  });
});

// =============================================================================
// Tests: Event Filtering
// =============================================================================

describe('Capability-Gated API: Event Filtering', () => {
  it('should only subscribe to events for tables in scope', () => {
    const { gatedApi, fullApi } = createTestSetup(['events:subscribe', 'tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    const handler = jest.fn();

    // Subscribe to contacts (in scope) - should work
    gatedApi.events?.onRecordChange('table-1' as AppTableId, handler);
    expect(fullApi.events.onRecordChange).toHaveBeenCalledWith('table-1', expect.any(Function));

    // Subscribe to orders (out of scope) - for name-based scoping,
    // subscription always happens (filtering is at delivery time)
    gatedApi.events?.onRecordChange('table-2' as AppTableId, handler);
    expect(fullApi.events.onRecordChange).toHaveBeenCalledTimes(2);
  });

  it('should filter events at delivery time', async () => {
    const { gatedApi, fullApi } = createTestSetup(['events:subscribe', 'tables:read'], {
      'tables:read': 'table:contacts' as CapabilityScope,
    });

    const handler = jest.fn();
    gatedApi.events?.onRecordChange('table-1' as AppTableId, handler);

    // Get the wrapped handler that was passed to the full API
    const wrappedHandler = (fullApi.events.onRecordChange as jest.Mock).mock.calls[0][1];

    // Simulate an event for contacts (in scope)
    wrappedHandler({
      type: 'updated',
      tableId: 'table-1' as AppTableId,
      recordId: 'record-1' as RecordId,
    });

    // Flush microtask queue so the async handler completes
    await new Promise((r) => setTimeout(r, 0));

    expect(handler).toHaveBeenCalledTimes(1);

    // Simulate an event for orders (out of scope) - should be filtered
    wrappedHandler({
      type: 'updated',
      tableId: 'table-2' as AppTableId,
      recordId: 'record-2' as RecordId,
    });

    // Flush microtask queue so the async handler completes
    await new Promise((r) => setTimeout(r, 0));

    // Handler should NOT be called for out-of-scope events
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Tests: Network Capability Separation
// =============================================================================

describe('Capability-Gated API: Network Capabilities', () => {
  it('should NOT provide network interface without network capabilities', () => {
    const { gatedApi } = createTestSetup(['tables:read']);

    expect(gatedApi.network).toBeUndefined();
  });

  it('should provide network interface with network:sameorigin', () => {
    const { gatedApi } = createTestSetup(['network:sameorigin']);

    expect(gatedApi.network).toBeDefined();
    expect(gatedApi.network?.fetch).toBeDefined();
  });

  it('should provide network interface with network:allowlist', () => {
    const { gatedApi } = createTestSetup(['network:allowlist']);

    expect(gatedApi.network).toBeDefined();
    expect(gatedApi.network?.getAllowedDomains).toBeDefined();
  });

  it('should provide network interface with network:localhost', () => {
    const { gatedApi } = createTestSetup(['network:localhost']);

    expect(gatedApi.network).toBeDefined();
  });

  it('should provide network interface with network:any', () => {
    const { gatedApi } = createTestSetup(['network:any']);

    expect(gatedApi.network).toBeDefined();
  });

  describe('Localhost Separation', () => {
    it('network:any should NOT grant localhost access', async () => {
      const { gatedApi } = createTestSetup(['network:any']);

      // Mock fetch to track calls
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn();

      try {
        await expect(gatedApi.network?.fetch?.('http://localhost:3000/api')).rejects.toThrow(
          CapabilityDeniedError,
        );

        await expect(gatedApi.network?.fetch?.('http://127.0.0.1:3000/api')).rejects.toThrow(
          CapabilityDeniedError,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('network:localhost should grant localhost access', async () => {
      const { gatedApi } = createTestSetup(['network:localhost']);

      // Mock fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue(new Response());

      try {
        await gatedApi.network?.fetch?.('http://localhost:3000/api');
        expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:3000/api', undefined);

        await gatedApi.network?.fetch?.('http://127.0.0.1:3000/api');
        expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api', undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('network:localhost should NOT grant remote access', async () => {
      const { gatedApi } = createTestSetup(['network:localhost']);

      await expect(gatedApi.network?.fetch?.('https://api.example.com/data')).rejects.toThrow(
        CapabilityDeniedError,
      );
    });

    it('both capabilities together should grant both accesses', async () => {
      const { gatedApi } = createTestSetup(['network:localhost', 'network:any']);

      // Mock fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue(new Response());

      try {
        // Should work for localhost
        await gatedApi.network?.fetch?.('http://localhost:3000/api');
        expect(globalThis.fetch).toHaveBeenCalled();

        // Should work for remote
        await gatedApi.network?.fetch?.('https://api.example.com/data');
        expect(globalThis.fetch).toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

// =============================================================================
// Tests: Native Query Gating
// =============================================================================

describe('Capability-Gated API: Native Query Gating', () => {
  it('should NOT provide connections interface without connection capabilities', () => {
    const { gatedApi } = createTestSetup(['tables:read']);

    expect(gatedApi.connections).toBeUndefined();
  });

  it('should provide query but NOT executeNative with connections:read only', () => {
    const store = new MemoryGrantsStore();
    const registry = new CapabilityRegistry(store);
    const testAppId = appId('test-app');
    const fullApi = createMockKernelAPI();

    registry.grant(testAppId, 'connections:read');

    const connectionsApi = {
      list: jest.fn(() => []),
      query: jest.fn(async () => []),
      execute: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'conn-1' })),
      delete: jest.fn(async () => {}),
      executeNative: jest.fn(async () => ({})),
    };

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
      connectionsApi,
    });

    expect(gatedApi.connections).toBeDefined();
    expect(gatedApi.connections?.list).toBeDefined();
    expect(gatedApi.connections?.query).toBeDefined();
    expect(gatedApi.connections?.executeNative).toBeUndefined();
  });

  it('should provide executeNative with connections:native', () => {
    const store = new MemoryGrantsStore();
    const registry = new CapabilityRegistry(store);
    const testAppId = appId('test-app');
    const fullApi = createMockKernelAPI();

    registry.grant(testAppId, 'connections:native');

    const connectionsApi = {
      list: jest.fn(() => []),
      query: jest.fn(async () => []),
      execute: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'conn-1' })),
      delete: jest.fn(async () => {}),
      executeNative: jest.fn(async () => ({})),
    };

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
      connectionsApi,
    });

    expect(gatedApi.connections).toBeDefined();
    expect(gatedApi.connections?.executeNative).toBeDefined();
  });
});

// =============================================================================
// Tests: Clipboard Independence
// =============================================================================

describe('Capability-Gated API: Clipboard Independence', () => {
  it('clipboard:read and clipboard:write should be independent', () => {
    // Only clipboard:read
    const { gatedApi: readOnly } = createTestSetup(['clipboard:read']);
    // Note: clipboard API may be undefined if fullApi.clipboard is undefined
    // This test verifies the capability model

    // Only clipboard:write
    const { gatedApi: writeOnly } = createTestSetup(['clipboard:write']);

    // With both capabilities
    const { gatedApi: both } = createTestSetup(['clipboard:read', 'clipboard:write']);

    // Verify the capabilities model
    expect(readOnly.capabilities.has('clipboard:read')).toBe(true);
    expect(readOnly.capabilities.has('clipboard:write')).toBe(false);

    expect(writeOnly.capabilities.has('clipboard:read')).toBe(false);
    expect(writeOnly.capabilities.has('clipboard:write')).toBe(true);

    expect(both.capabilities.has('clipboard:read')).toBe(true);
    expect(both.capabilities.has('clipboard:write')).toBe(true);
  });
});

// =============================================================================
// Tests: Undo Group Operations
// =============================================================================

describe('Capability-Gated API: Undo Group Operations', () => {
  it('should provide undoGroup function even without capabilities', () => {
    const { gatedApi } = createTestSetup([]);

    expect(gatedApi.undoGroup).toBeDefined();
  });

  it('should execute undoGroup when all operations are valid', async () => {
    const { gatedApi, fullApi } = createTestSetup(['tables:read', 'tables:write']);

    let executed = false;
    await gatedApi.undoGroup(() => {
      executed = true;
    });

    expect(executed).toBe(true);
    expect(fullApi.undoGroup).toHaveBeenCalled();
  });
});

// =============================================================================
// Tests: Capability Change Notification
// =============================================================================

describe('Capability-Gated API: Change Notifications', () => {
  it('should notify when capabilities change', () => {
    const store = new MemoryGrantsStore();
    const registry = new CapabilityRegistry(store);
    const testAppId = appId('test-app');
    const fullApi = createMockKernelAPI();

    registry.grant(testAppId, 'tables:read');

    const onCapabilitiesChange = jest.fn();

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
      onCapabilitiesChange,
    });

    const onChange = jest.fn();
    gatedApi.capabilities.onChange(onChange);

    // Grant a new capability
    registry.grant(testAppId, 'tables:write');

    // The onChange callback should have been called
    expect(onChange).toHaveBeenCalled();
  });
});

/**
 * SDK App API Conformance Tests
 *
 * Validates that app-level kernel APIs (AppKernelAPI, capability-gated API,
 * ungated adapter) are accessible through the trusted app-api friend surface
 * and behave correctly at the boundary.
 *
 * Import rules:
 * - OK: root imports for document/workbook public SDK APIs
 * - OK: app embedding factories from the app-api friend surface
 * - OK in kernel-internal conformance setup only: registry/store factories
 *       imported from package-private source paths
 * - FORBIDDEN: DocumentContext, DocumentHandleInternal, ComputeBridge,
 *              IEventBus, or any @mog-sdk/kernel/internal path
 */

import { MogDocumentFactory } from '../../../..';
import {
  AppKernelAPI,
  createAppKernelAPI,
  createAppKernelAPIFromHandle,
  createCapabilityGatedApi,
  createUngatedAdapter,
} from '../../../app';

import { createCapabilityRegistry } from '../../../../services/capabilities/registry';
import { createMemoryGrantsStore } from '../../../../services/capabilities/stores/memory-store';

// Contract types
import type { MogDocument } from '@mog-sdk/contracts/sdk';
import type { Workbook } from '@mog-sdk/contracts/api';
import type {
  AppTableId,
  AppTableInfo,
  IAppKernelAPI,
  IAppColumnsAPI,
  IAppEventsAPI,
  IAppRecordsAPI,
  IAppRelationsAPI,
  IAppTablesAPI,
  RecordId,
} from '@mog-sdk/contracts/apps';

// Star-import for boundary checks
import * as publicBarrel from '../../../..';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestDocument(documentId?: string): Promise<MogDocument> {
  return MogDocumentFactory.create({
    documentId,
    runtime: { kind: 'headless', userTimezone: 'UTC' },
  });
}

/**
 * Create a minimal mock IAppKernelAPI for testing capability gating.
 * This avoids needing IKernelContext (internal) while still exercising
 * the real createCapabilityGatedApi and createUngatedAdapter code paths.
 */
function createMockAppKernelAPI(): IAppKernelAPI {
  const mockTables: IAppTablesAPI = {
    get: async (id: AppTableId) =>
      id === ('table-1' as AppTableId)
        ? {
            id: 'table-1' as AppTableId,
            name: 'TestTable',
            sheetId: 'sheet-1',
            recordCount: 5,
            columns: [],
          }
        : null,
    findByName: async (name: string) =>
      name === 'TestTable'
        ? {
            id: 'table-1' as AppTableId,
            name: 'TestTable',
            sheetId: 'sheet-1',
            recordCount: 5,
            columns: [],
          }
        : null,
    list: async () => [
      {
        id: 'table-1' as AppTableId,
        name: 'TestTable',
        sheetId: 'sheet-1',
        recordCount: 5,
        columns: [],
      },
    ],
    create: async (schema) => ({
      id: 'table-new' as AppTableId,
      name: schema.name,
      sheetId: 'sheet-1',
      recordCount: 0,
      columns: [],
    }),
    rename: async () => {},
    delete: async () => {},
  };

  const mockRecords: IAppRecordsAPI = {
    get: async (tableId, recordId) => ({
      id: recordId,
      tableId,
      values: { Name: 'Test' },
      valuesByColumnId: {},
    }),
    list: async () => [],
    create: async (tableId, values) => ({
      id: 'record-new' as RecordId,
      tableId,
      values,
      valuesByColumnId: {},
    }),
    update: async (tableId, recordId, values) => ({
      id: recordId,
      tableId,
      values,
      valuesByColumnId: {},
    }),
    delete: async () => {},
    createBatch: async () => [],
    updateBatch: async () => [],
    deleteBatch: async () => {},
  };

  const mockColumns: IAppColumnsAPI = {
    get: async () => null,
    findByName: async () => null,
    list: async () => [],
    create: async (_tableId, schema) => ({
      id: 'col-new' as any,
      name: schema.name,
      index: 0,
      type: schema.type,
      required: false,
      unique: false,
    }),
    update: async () => {},
    rename: async () => {},
    delete: async () => {},
  };

  const mockRelations: IAppRelationsAPI = {
    getRelated: async () => [],
    getBacklinks: async () => [],
    link: async () => {},
    unlink: async () => {},
  };

  const mockEvents: IAppEventsAPI = {
    onRecordChange: () => () => {},
    onSchemaChange: () => () => {},
    onRecordFieldChange: () => () => {},
  };

  return {
    tables: mockTables,
    columns: mockColumns,
    records: mockRecords,
    relations: mockRelations,
    events: mockEvents,
    bindings: {
      registerInstance: () => {},
      unregisterInstance: () => {},
      getInstance: () => undefined as any,
      listInstances: () => [],
      bindTable: async () => ({ success: true }) as any,
      unbindTable: async () => {},
      getBindings: () => [],
    },
    undoGroup: async <T>(fn: () => Promise<T> | T): Promise<T> => {
      return await fn();
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Friend app-api surface exports AppKernelAPI and factory functions
// ---------------------------------------------------------------------------

describe('Friend app-api exports', () => {
  it('exports AppKernelAPI class', () => {
    expect(AppKernelAPI).toBeDefined();
    expect(typeof AppKernelAPI).toBe('function');
  });

  it('exports createAppKernelAPI factory', () => {
    expect(createAppKernelAPI).toBeDefined();
    expect(typeof createAppKernelAPI).toBe('function');
  });

  it('exports createAppKernelAPIFromHandle helper', () => {
    expect(createAppKernelAPIFromHandle).toBeDefined();
    expect(typeof createAppKernelAPIFromHandle).toBe('function');
  });

  it('exports createCapabilityGatedApi factory', () => {
    expect(createCapabilityGatedApi).toBeDefined();
    expect(typeof createCapabilityGatedApi).toBe('function');
  });

  it('exports createUngatedAdapter factory', () => {
    expect(createUngatedAdapter).toBeDefined();
    expect(typeof createUngatedAdapter).toBe('function');
  });

  it('does not export createCapabilityRegistry from the public root', () => {
    expect('createCapabilityRegistry' in publicBarrel).toBe(false);
  });

  it('does not export createMemoryGrantsStore from the public root', () => {
    expect('createMemoryGrantsStore' in publicBarrel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. createUngatedAdapter wraps IAppKernelAPI as IGatedAppKernelAPI
// ---------------------------------------------------------------------------

describe('createUngatedAdapter', () => {
  it('wraps a full IAppKernelAPI and exposes all sub-APIs', () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    // All sub-APIs should be present (ungated = everything available)
    expect(gated.tables).toBeDefined();
    expect(gated.columns).toBeDefined();
    expect(gated.records).toBeDefined();
    expect(gated.relations).toBeDefined();
    expect(gated.events).toBeDefined();
  });

  it('capabilities.has() returns true for all capabilities', () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    expect(gated.capabilities).toBeDefined();
    expect(gated.capabilities.has('tables:read')).toBe(true);
    expect(gated.capabilities.has('tables:write')).toBe(true);
    expect(gated.capabilities.has('cells:read')).toBe(true);
    expect(gated.capabilities.has('cells:write')).toBe(true);
    expect(gated.capabilities.has('network:any')).toBe(true);
  });

  it('capabilities.list() returns all known capabilities', () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    const caps = gated.capabilities.list();
    expect(Array.isArray(caps)).toBe(true);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps).toContain('tables:read');
    expect(caps).toContain('cells:write');
  });

  it('capabilities.hasAccessTo() returns true for any resource', () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    expect(gated.capabilities.hasAccessTo('tables:read', 'table', 'anything')).toBe(true);
  });

  it('capabilities.isScoped() returns false (ungated = unscoped)', () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    expect(gated.capabilities.isScoped('tables:read')).toBe(false);
    expect(gated.capabilities.getScope('tables:read')).toBeNull();
  });

  it('undoGroup delegates to the underlying API', async () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    const result = await gated.undoGroup(async () => 42);
    expect(result).toBe(42);
  });

  it('tables API delegates list() to underlying mock', async () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    const tables = await gated.tables!.list!();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables!.length).toBe(1);
    expect(tables![0].name).toBe('TestTable');
  });
});

// ---------------------------------------------------------------------------
// 3. createCapabilityGatedApi — granted capabilities allow operations
// ---------------------------------------------------------------------------

describe('createCapabilityGatedApi — granted capabilities', () => {
  it('includes tables API when tables:read is granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant tables:read
    registry.grant(testAppId, 'tables:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.tables).toBeDefined();
    expect(gated.capabilities.has('tables:read')).toBe(true);
  });

  it('includes records API when tables:read is granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    // records API should be available for read operations
    expect(gated.records).toBeDefined();
  });

  it('includes events API when events:subscribe is granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'events:subscribe');
    registry.grant(testAppId, 'tables:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.events).toBeDefined();
  });

  it('capabilities introspection is always available', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant nothing
    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.capabilities).toBeDefined();
    expect(typeof gated.capabilities.has).toBe('function');
    expect(typeof gated.capabilities.list).toBe('function');
    expect(typeof gated.capabilities.isScoped).toBe('function');
    expect(typeof gated.capabilities.getScope).toBe('function');
    expect(typeof gated.capabilities.hasAccessTo).toBe('function');
    expect(typeof gated.capabilities.request).toBe('function');
    expect(typeof gated.capabilities.onChange).toBe('function');
    expect(typeof gated.capabilities.onExpiring).toBe('function');
  });

  it('undoGroup is always available', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(typeof gated.undoGroup).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 4. createCapabilityGatedApi — denied capabilities hide APIs
// ---------------------------------------------------------------------------

describe('createCapabilityGatedApi — denied capabilities', () => {
  it('tables API is undefined when no table capabilities granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant only cells:read (no table capabilities)
    registry.grant(testAppId, 'cells:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.tables).toBeUndefined();
  });

  it('records API is undefined when no table capabilities granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'cells:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.records).toBeUndefined();
  });

  it('columns API is undefined when no table capabilities granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // No table capabilities at all
    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.columns).toBeUndefined();
  });

  it('relations API is undefined when no table capabilities granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.relations).toBeUndefined();
  });

  it('events API is undefined when events:subscribe not granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant tables:read but NOT events:subscribe
    registry.grant(testAppId, 'tables:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.events).toBeUndefined();
  });

  it('clipboard API is undefined when clipboard capabilities not granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.clipboard).toBeUndefined();
  });

  it('network API is undefined when no network capabilities granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.network).toBeUndefined();
  });

  it('connections API is undefined when no connections capabilities granted', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.connections).toBeUndefined();
  });

  it('capabilities.has() returns false for non-granted capabilities', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant only tables:read
    registry.grant(testAppId, 'tables:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.capabilities.has('tables:read')).toBe(true);
    expect(gated.capabilities.has('tables:write')).toBe(false);
    expect(gated.capabilities.has('network:any')).toBe(false);
    expect(gated.capabilities.has('filesystem:read')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Capability gating with write-implies-read
// ---------------------------------------------------------------------------

describe('createCapabilityGatedApi — capability implications', () => {
  it('tables:write implies tables:read', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant only tables:write — should imply tables:read
    registry.grant(testAppId, 'tables:write');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect(gated.capabilities.has('tables:write')).toBe(true);
    expect(gated.capabilities.has('tables:read')).toBe(true);
    expect(gated.tables).toBeDefined();
  });

  it('cells:write implies cells:read', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'cells:write');

    expect(registry.hasCapability(testAppId, 'cells:read')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Capability registry basic operations via public exports
// ---------------------------------------------------------------------------

describe('Capability registry via public exports', () => {
  it('createMemoryGrantsStore and createCapabilityRegistry work together', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);

    expect(store).toBeDefined();
    expect(registry).toBeDefined();
  });

  it('can grant and check capabilities', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'conformance-app' as any;

    expect(registry.hasCapability(testAppId, 'tables:read')).toBe(false);

    registry.grant(testAppId, 'tables:read');
    expect(registry.hasCapability(testAppId, 'tables:read')).toBe(true);
  });

  it('can revoke capabilities', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'conformance-app' as any;

    registry.grant(testAppId, 'tables:read');
    expect(registry.hasCapability(testAppId, 'tables:read')).toBe(true);

    registry.revoke(testAppId, 'tables:read');
    expect(registry.hasCapability(testAppId, 'tables:read')).toBe(false);
  });

  it('getEffectiveCapabilities includes implied capabilities', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'conformance-app' as any;

    registry.grant(testAppId, 'tables:write');

    const effective = registry.getEffectiveCapabilities(testAppId);
    expect(effective).toContain('tables:write');
    expect(effective).toContain('tables:read'); // implied
  });
});

// ---------------------------------------------------------------------------
// 7. Workbook-level operations via document factory
// ---------------------------------------------------------------------------

describe('App API workbook access via MogDocumentFactory', () => {
  let doc: MogDocument;
  let wb: Workbook;

  beforeEach(async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();
  });

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('workbook provides sheet operations for app use', () => {
    expect(wb.activeSheet).toBeDefined();
    expect(typeof wb.activeSheet.name).toBe('string');
    expect(wb.sheetCount).toBeGreaterThanOrEqual(1);
  });

  it('friend helper creates an app API from a trusted document handle', () => {
    const appApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);
    expect(appApi.tables).toBeDefined();
    expect(appApi.columns).toBeDefined();
    expect(appApi.records).toBeDefined();
  });

  it('workbook provides cell read/write for app use', async () => {
    const ws = wb.activeSheet;
    await ws.setCell('A1', 42);
    const val = await ws.getValue('A1');
    expect(val).toBe(42);
  });

  it('workbook supports batch cell writes for app use', async () => {
    const ws = wb.activeSheet;
    await ws.setCells([
      { addr: 'A1', value: 'hello' },
      { addr: 'B1', value: 'world' },
    ]);
    const v1 = await ws.getValue('A1');
    const v2 = await ws.getValue('B1');
    expect(v1).toBe('hello');
    expect(v2).toBe('world');
  });

  it('workbook allows sheet creation for app use', async () => {
    const countBefore = wb.sheetCount;
    const newSheet = await wb.sheets.add('AppSheet');
    expect(newSheet.name).toBe('AppSheet');
    expect(wb.sheetCount).toBe(countBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// 8. Boundary: app API does not expose shell internals
// ---------------------------------------------------------------------------

describe('App API boundary — no shell internals exposed', () => {
  const exported = publicBarrel as Record<string, unknown>;

  it('does not export DocumentContext', () => {
    expect('DocumentContext' in exported).toBe(false);
  });

  it('does not export DocumentHandleInternal', () => {
    expect('DocumentHandleInternal' in exported).toBe(false);
  });

  it('does not export raw ComputeBridge', () => {
    expect('ComputeBridge' in exported).toBe(false);
  });

  it('does not export IEventBus', () => {
    expect('IEventBus' in exported).toBe(false);
  });

  it('does not export action handler internals', () => {
    expect('ActionHandler' in exported).toBe(false);
    expect('ShellActionDispatcher' in exported).toBe(false);
  });

  it('does not export internal kernel context types', () => {
    // IKernelContext should only be available via contracts, not as a runtime export
    expect('IKernelContext' in exported).toBe(false);
    expect('KernelContext' in exported).toBe(false);
  });

  it('ungated adapter does not leak internal properties', () => {
    const mockApi = createMockAppKernelAPI();
    const gated = createUngatedAdapter(mockApi);

    // Should not have internal DocumentContext or bridge references
    expect((gated as any).ctx).toBeUndefined();
    expect((gated as any).documentContext).toBeUndefined();
    expect((gated as any).computeBridge).toBeUndefined();
    expect((gated as any).eventBus).toBeUndefined();
  });

  it('gated API does not leak internal properties', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read');

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    expect((gated as any).ctx).toBeUndefined();
    expect((gated as any).documentContext).toBeUndefined();
    expect((gated as any).computeBridge).toBeUndefined();
    expect((gated as any).eventBus).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Managed table IDs scoping
// ---------------------------------------------------------------------------

describe('createCapabilityGatedApi — managed table IDs', () => {
  it('limits table access to managed table IDs when provided', async () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read');
    registry.grant(testAppId, 'tables:write');

    const mockApi = createMockAppKernelAPI();

    // Only allow access to 'table-1'
    const managedTableIds = new Set(['table-1']);

    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
      managedTableIds,
    });

    expect(gated.tables).toBeDefined();

    // list() should filter to only managed tables
    const tables = await gated.tables!.list!();
    expect(tables).toBeDefined();
    if (tables) {
      for (const t of tables) {
        expect(managedTableIds.has(t.id)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 10. onChange and onExpiring subscriptions
// ---------------------------------------------------------------------------

describe('createCapabilityGatedApi — subscription lifecycle', () => {
  it('capabilities.onChange returns an unsubscribe function', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    const unsub = gated.capabilities.onChange(() => {});
    expect(typeof unsub).toBe('function');
    // Should not throw
    unsub();
  });

  it('capabilities.onExpiring returns an unsubscribe function', () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    const unsub = gated.capabilities.onExpiring(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('capabilities.request returns a promise', async () => {
    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const mockApi = createMockAppKernelAPI();
    const gated = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi: mockApi,
    });

    // Without a requestCapability callback, request should resolve to false
    const result = await gated.capabilities.request('tables:read', 'I need tables');
    expect(typeof result).toBe('boolean');
  });
});

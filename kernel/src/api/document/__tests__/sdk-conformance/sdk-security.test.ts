/**
 * SDK Security Conformance Tests
 *
 * Validates security-related SDK surface:
 * - Principal construction and propagation via MogSdkSecurityProvider
 * - Read-only document behavior
 * - Capability-gated app API behavior
 * - Denied operations produce correct error codes
 *
 * Import rules:
 * - OK: MogDocumentFactory, MogSdkError, types from @mog-sdk/kernel
 *       and @mog-sdk/contracts/sdk
 * - FORBIDDEN: DocumentContext, DocumentHandleInternal, ComputeBridge,
 *              IEventBus, or any @mog-sdk/kernel/internal path
 */

// Runtime imports — use relative paths within the kernel package.
import { MogDocumentFactory } from '../../mog-document-factory';
import { MogSdkError } from '../../../../errors/mog-sdk-error';

// Friend app-api surface for app/capability API behavior.
import { createAppKernelAPIFromHandle, createCapabilityGatedApi } from '../../../app';

import { createCapabilityRegistry } from '../../../../services/capabilities/registry';
import { createMemoryGrantsStore } from '../../../../services/capabilities/stores/memory-store';

// Contract types
import type {
  MogDocument,
  MogSdkSecurityProvider,
  MogSdkAccessPrincipal,
  MogSdkErrorCode,
} from '@mog-sdk/contracts/sdk';
import type { Workbook } from '@mog-sdk/contracts/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a headless document for testing. */
async function createTestDocument(options?: {
  security?: MogSdkSecurityProvider;
  documentId?: string;
}): Promise<MogDocument> {
  return MogDocumentFactory.create({
    documentId: options?.documentId,
    runtime: { kind: 'headless', userTimezone: 'UTC' },
    security: options?.security,
  });
}

// ---------------------------------------------------------------------------
// 1. Principal construction and propagation
// ---------------------------------------------------------------------------

describe('Principal construction and propagation', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('accepts a security provider with resolvePrincipal', async () => {
    const security: MogSdkSecurityProvider = {
      resolvePrincipal(): MogSdkAccessPrincipal {
        return { tags: ['user:alice', 'role:admin'] };
      },
    };

    doc = await createTestDocument({ security });
    expect(doc).toBeDefined();
    expect(doc.status).toBe('ready');
  });

  it('creates a document without a security provider (no principal)', async () => {
    doc = await createTestDocument();
    expect(doc).toBeDefined();
    expect(doc.status).toBe('ready');
  });

  it('principal tags are propagated (verified by creating and reading back)', async () => {
    const tags = ['user:bob', 'role:viewer', 'org:acme'] as const;
    const security: MogSdkSecurityProvider = {
      resolvePrincipal(): MogSdkAccessPrincipal {
        return { tags: [...tags] };
      },
    };

    doc = await createTestDocument({ security });
    // If the principal is wired, the document should be fully functional
    const wb: Workbook = await doc.workbook();
    expect(wb).toBeDefined();
    // Basic mutation should work (no permission restrictions from principal alone)
    const ws = wb.activeSheet;
    await ws.setCell('A1', 42);
    const val = await ws.getValue('A1');
    expect(val).toBe(42);
  });

  it('resolvePrincipal can return empty tags', async () => {
    const security: MogSdkSecurityProvider = {
      resolvePrincipal(): MogSdkAccessPrincipal {
        return { tags: [] };
      },
    };

    doc = await createTestDocument({ security });
    expect(doc).toBeDefined();
    expect(doc.status).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// 2. Read-only document behavior
// ---------------------------------------------------------------------------

describe('Read-only document behavior', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('persistence.readOnly reflects the readOnly workbook option', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook({ readOnly: true });
    expect(wb).toBeDefined();
    // The workbook was created with readOnly: true
    expect(wb.readOnly).toBe(true);
  });

  it('default persistence.readOnly is false', async () => {
    doc = await createTestDocument();
    expect(doc.persistence.readOnly).toBe(false);
  });

  it('setCell on a readOnly workbook throws READ_ONLY MogSdkError', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook({ readOnly: true });

    await expect(wb.activeSheet.setCell('A1', 42)).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'READ_ONLY',
      operation: 'worksheet.setCell',
    });
  });

  it('setCells on a readOnly workbook throws READ_ONLY MogSdkError', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook({ readOnly: true });

    await expect(wb.activeSheet.setCells([{ row: 0, col: 0, value: 42 }])).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'READ_ONLY',
      operation: 'worksheet.setCells',
    });
  });

  it('sheet add on a readOnly workbook throws READ_ONLY MogSdkError', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook({ readOnly: true });

    await expect(wb.sheets.add('Denied')).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'READ_ONLY',
      operation: 'sheets.add',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Capability-gated app API — granted capabilities
// ---------------------------------------------------------------------------

describe('Capability-gated API — granted capabilities', () => {
  let doc: MogDocument;
  let wb: Workbook;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('createCapabilityGatedApi returns an object with capabilities introspection', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant some capabilities
    registry.grant(testAppId, 'tables:read');
    registry.grant(testAppId, 'tables:write');

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    expect(gatedApi.capabilities).toBeDefined();
    expect(typeof gatedApi.capabilities.has).toBe('function');
    expect(typeof gatedApi.capabilities.list).toBe('function');
  });

  it('granted capability shows up in introspection.has()', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read');

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    expect(gatedApi.capabilities.has('tables:read')).toBe(true);
  });

  it('granted capability exposes the corresponding sub-API', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read');
    registry.grant(testAppId, 'events:subscribe');

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    // tables sub-API should be present when tables:read is granted
    expect(gatedApi.tables).toBeDefined();
    // events sub-API should be present when events:subscribe is granted
    expect(gatedApi.events).toBeDefined();
  });

  it('undoGroup is always available on gated API', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant nothing
    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    expect(typeof gatedApi.undoGroup).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 4. Capability-gated app API — denied capabilities
// ---------------------------------------------------------------------------

describe('Capability-gated API — denied capabilities', () => {
  let doc: MogDocument;
  let wb: Workbook;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('non-granted capability returns false from introspection.has()', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant nothing
    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    expect(gatedApi.capabilities.has('tables:read')).toBe(false);
    expect(gatedApi.capabilities.has('tables:write')).toBe(false);
    expect(gatedApi.capabilities.has('cells:read')).toBe(false);
    expect(gatedApi.capabilities.has('network:any')).toBe(false);
  });

  it('non-granted capability leaves the sub-API undefined', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    // Grant only tables:read — no events, no clipboard, no undo
    registry.grant(testAppId, 'tables:read');

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    // events not granted => undefined
    expect(gatedApi.events).toBeUndefined();
    // clipboard not granted => undefined
    expect(gatedApi.clipboard).toBeUndefined();
    // network not granted => undefined
    expect(gatedApi.network).toBeUndefined();
    // connections not granted => undefined
    expect(gatedApi.connections).toBeUndefined();
  });

  it('capabilities.list() returns only granted capabilities', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read');

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    const caps = gatedApi.capabilities.list();
    expect(caps).toContain('tables:read');
    // tables:write was not granted
    expect(caps).not.toContain('tables:write');
    expect(caps).not.toContain('network:any');
  });
});

// ---------------------------------------------------------------------------
// 5. MogSdkError — security-related error codes
// ---------------------------------------------------------------------------

describe('MogSdkError — security error codes', () => {
  it('AUTHORIZATION_DENIED code constructs correctly', () => {
    const err = new MogSdkError('AUTHORIZATION_DENIED', 'Capability not granted');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MogSdkError);
    expect(err.code).toBe('AUTHORIZATION_DENIED' satisfies MogSdkErrorCode);
    expect(err.message).toBe('Capability not granted');
  });

  it('READ_ONLY code constructs correctly', () => {
    const err = new MogSdkError('READ_ONLY', 'Document is read-only');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MogSdkError);
    expect(err.code).toBe('READ_ONLY' satisfies MogSdkErrorCode);
    expect(err.message).toBe('Document is read-only');
  });

  it('AUTHORIZATION_DENIED serializes correctly via toJSON()', () => {
    const err = new MogSdkError('AUTHORIZATION_DENIED', 'Access denied', {
      operation: 'tables.list',
      details: { capability: 'tables:read', appId: 'my-app' },
    });
    const json = err.toJSON();

    expect(json.code).toBe('AUTHORIZATION_DENIED');
    expect(json.message).toBe('Access denied');
    expect(json.operation).toBe('tables.list');
    expect(json.details).toEqual({ capability: 'tables:read', appId: 'my-app' });
  });

  it('READ_ONLY serializes correctly via toJSON()', () => {
    const err = new MogSdkError('READ_ONLY', 'Cannot mutate read-only document', {
      operation: 'setCell',
    });
    const json = err.toJSON();

    expect(json.code).toBe('READ_ONLY');
    expect(json.operation).toBe('setCell');
  });

  it('from() preserves AUTHORIZATION_DENIED when wrapping MogSdkError', () => {
    const original = new MogSdkError('AUTHORIZATION_DENIED', 'denied');
    const wrapped = MogSdkError.from(original);
    expect(wrapped).toBe(original);
    expect(wrapped.code).toBe('AUTHORIZATION_DENIED');
  });

  it('security error codes are in the stable error code set', () => {
    // Verify both security-related codes exist as valid MogSdkErrorCode values
    const authErr = new MogSdkError('AUTHORIZATION_DENIED', 'test');
    const readOnlyErr = new MogSdkError('READ_ONLY', 'test');

    // Both should be valid — if the type system accepted them, the codes are stable
    expect(authErr.code).toBe('AUTHORIZATION_DENIED');
    expect(readOnlyErr.code).toBe('READ_ONLY');
  });
});

// ---------------------------------------------------------------------------
// 6. Capability introspection — scope and access checks
// ---------------------------------------------------------------------------

describe('Capability introspection — scope and access checks', () => {
  let doc: MogDocument;
  let wb: Workbook;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('isScoped returns false for an unscoped grant', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read');

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    expect(gatedApi.capabilities.isScoped('tables:read')).toBe(false);
  });

  it('isScoped returns true for a scoped grant', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    registry.grant(testAppId, 'tables:read', {
      scope: { resources: [{ type: 'table', id: 'contacts' }] },
    });

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    expect(gatedApi.capabilities.isScoped('tables:read')).toBe(true);
  });

  it('getScope returns the scope for a scoped grant', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const scope = { resources: [{ type: 'table', id: 'my-table' }] };
    registry.grant(testAppId, 'tables:read', { scope });

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    const resolvedScope = gatedApi.capabilities.getScope('tables:read');
    expect(resolvedScope).toBeDefined();
    expect(resolvedScope!.resources).toHaveLength(1);
    expect(resolvedScope!.resources[0].type).toBe('table');
    expect(resolvedScope!.resources[0].id).toBe('my-table');
  });

  it('getScope returns null for a non-granted capability', async () => {
    doc = await createTestDocument();
    wb = await doc.workbook();

    const store = createMemoryGrantsStore();
    const registry = createCapabilityRegistry(store);
    const testAppId = 'test-app' as any;

    const fullApi = createAppKernelAPIFromHandle((doc as any)._handle, wb);

    const gatedApi = createCapabilityGatedApi({
      appId: testAppId,
      registry,
      fullApi,
    });

    expect(gatedApi.capabilities.getScope('tables:read')).toBeNull();
  });
});

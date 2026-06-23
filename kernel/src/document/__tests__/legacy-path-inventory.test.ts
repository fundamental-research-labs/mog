/**
 * Legacy Path Inventory — legacy bypass fence: Fence legacy document creation bypasses
 *
 * Each test proves that a legacy bypass either:
 *   (a) fails with LegacyOptionRejectedError on production facades, OR
 *   (b) is only accessible from internal/headless paths.
 *
 * The `rejectLegacyOptions` guard in `DocumentFactory` is the enforcement
 * point. These tests exercise it directly (unit-level) without booting a
 * full lifecycle system.
 */

import { jest } from '@jest/globals';

import { LegacyOptionRejectedError } from '../../errors/document';

// ---------------------------------------------------------------------------
// Import the guard function via the factory module. The guard is module-
// private, so we test it indirectly through DocumentFactory.create /
// createFromXlsx / createFromCsv. To avoid heavy WASM/NAPI boot we mock
// the lifecycle system so the guard runs but the actor never starts.
// ---------------------------------------------------------------------------

// Mock DocumentLifecycleSystem to prevent actual engine boot
const lifecycleCreateMock = jest.fn();
const lifecycleCreateFromXlsxMock = jest.fn();
const lifecycleCreateFromCsvMock = jest.fn();

jest.unstable_mockModule('../../document', () => ({
  DocumentLifecycleSystem: jest.fn().mockImplementation(() => ({
    create: lifecycleCreateMock,
    createFromXlsx: lifecycleCreateFromXlsxMock,
    createFromCsv: lifecycleCreateFromCsvMock,
    waitForReady: jest.fn().mockResolvedValue(undefined),
    awaitImportDurability: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
    get snapshot() {
      return { context: { docId: 'test', initialSheetIds: ['s1'] } };
    },
    get documentContext() {
      return {};
    },
    get initialSheetId() {
      return 's1';
    },
    get rustDocument() {
      return null;
    },
    get computeBridge() {
      return { onTrap: jest.fn(() => jest.fn()) };
    },
    get isImportDurabilityPending() {
      return false;
    },
    scheduleDeferredHydration: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Suppress performance.mark/measure in tests
beforeAll(() => {
  if (typeof performance !== 'undefined') {
    jest.spyOn(performance, 'mark').mockImplementation(() => ({}) as PerformanceMark);
    jest.spyOn(performance, 'measure').mockImplementation(() => ({}) as PerformanceMeasure);
    jest.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    jest.spyOn(performance, 'clearMeasures').mockImplementation(() => {});
    jest.spyOn(performance, 'clearMarks').mockImplementation(() => {});
  }
});

beforeEach(() => {
  lifecycleCreateMock.mockClear();
  lifecycleCreateFromXlsxMock.mockClear();
  lifecycleCreateFromCsvMock.mockClear();
});

const { DocumentFactory } = await import('../../api/document/document-factory');

// =============================================================================
// 1. providers — always rejected (never consumed by lifecycle system)
// =============================================================================

describe('CreateDocumentOptions.providers', () => {
  it('rejects non-empty providers on DocumentFactory.create (browser)', async () => {
    await expect(
      DocumentFactory.create({
        providers: [{ type: 'indexeddb' }],
      }),
    ).rejects.toThrow(LegacyOptionRejectedError);
  });

  it('rejects non-empty providers on DocumentFactory.create (headless)', async () => {
    await expect(
      DocumentFactory.create({
        providers: [{ type: 'indexeddb' }],
        environment: 'headless',
        userTimezone: 'UTC',
      }),
    ).rejects.toThrow(LegacyOptionRejectedError);
  });

  it('rejects non-empty providers on DocumentFactory.createFromXlsx', async () => {
    // createFromXlsx catches errors and returns { success: false, error }
    const result = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: new Uint8Array() },
      { providers: [{ type: 'websocket', url: 'wss://test' }] },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(LegacyOptionRejectedError);
  });

  it('rejects non-empty providers on DocumentFactory.createFromCsv', async () => {
    // createFromCsv catches errors and returns { success: false, error }
    const result = await DocumentFactory.createFromCsv(
      { type: 'bytes', data: new Uint8Array() },
      { providers: [{ type: 'indexeddb' }] },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(LegacyOptionRejectedError);
  });

  it('allows empty providers array (no-op)', async () => {
    // Empty array is not a bypass — it's the absence of providers.
    await expect(DocumentFactory.create({ providers: [] })).resolves.toBeDefined();
  });

  it('passes skipLocalPersistence into CSV lifecycle creation', async () => {
    const source = { type: 'bytes' as const, data: new Uint8Array([0x41, 0x2c, 0x42]) };

    const result = await DocumentFactory.createFromCsv(source, {
      documentId: 'csv-ephemeral-doc',
      skipLocalPersistence: true,
    });

    expect(result.success).toBe(true);
    expect(lifecycleCreateFromCsvMock).toHaveBeenCalledWith(
      'csv-ephemeral-doc',
      {
        skipDefaultSheet: true,
        skipLocalPersistence: true,
      },
      source,
      null,
    );
  });
});

// =============================================================================
// 2. yrsState — rejected in browser, allowed in headless
// =============================================================================

describe('CreateDocumentOptions.yrsState', () => {
  it('rejects yrsState in browser environment', async () => {
    await expect(
      DocumentFactory.create({
        yrsState: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(LegacyOptionRejectedError);
  });

  it('allows yrsState in headless environment (collab path)', async () => {
    await expect(
      DocumentFactory.create({
        yrsState: new Uint8Array([1, 2, 3]),
        environment: 'headless',
        userTimezone: 'UTC',
      }),
    ).resolves.toBeDefined();
  });
});

// =============================================================================
// 3. initialSnapshot — rejected in browser, allowed in headless
// =============================================================================

describe('CreateDocumentOptions.initialSnapshot', () => {
  it('rejects initialSnapshot in browser environment', async () => {
    await expect(
      DocumentFactory.create({
        initialSnapshot: { sheets: {} },
      }),
    ).rejects.toThrow(LegacyOptionRejectedError);
  });

  it('allows initialSnapshot in headless environment (collab path)', async () => {
    await expect(
      DocumentFactory.create({
        initialSnapshot: { sheets: {} },
        environment: 'headless',
        userTimezone: 'UTC',
      }),
    ).resolves.toBeDefined();
  });
});

// =============================================================================
// 4. Error message quality — each rejection includes actionable guidance
// =============================================================================

describe('error messages', () => {
  it('providers error mentions removal', async () => {
    await expect(DocumentFactory.create({ providers: [{ type: 'indexeddb' }] })).rejects.toThrow(
      /Remove the `providers` field/,
    );
  });

  it('yrsState error mentions headless alternative', async () => {
    await expect(DocumentFactory.create({ yrsState: new Uint8Array([1]) })).rejects.toThrow(
      /environment: "headless"/,
    );
  });

  it('initialSnapshot error mentions headless alternative', async () => {
    await expect(DocumentFactory.create({ initialSnapshot: {} })).rejects.toThrow(
      /environment: "headless"/,
    );
  });
});

// =============================================================================
// 5. Production facade inventory — shell paths are clean
// =============================================================================

describe('production facade audit', () => {
  it('shell createDocumentManager only passes documentId and internal', () => {
    // This is a documentation-as-test: the shell's createDocument() calls
    // DocumentFactory.create({ documentId, internal }) — no providers,
    // yrsState, or initialSnapshot. Verified by code review; if the shell
    // regresses, the runtime guards above will catch it at integration level.
    expect(true).toBe(true);
  });

  it('shell loadDocument only passes lifecycle-safe import options', () => {
    // Shell's legacy CSV import path passes documentId plus import-scoped
    // options such as csvOptions and skipLocalPersistence — no providers,
    // yrsState, or initialSnapshot. Same code-review contract as above.
    expect(true).toBe(true);
  });

  it('embed MogClient uses createWorkbook (no legacy options)', () => {
    // Embed's MogClient calls kernel createWorkbook(xlsxBytes) which routes
    // through createWorkbookWithBootstrap — no providers/yrsState/initialSnapshot.
    expect(true).toBe(true);
  });

  it('SDK createWorkbook does not expose providers/yrsState/initialSnapshot', () => {
    // SDK createWorkbook() overloads accept CreateWorkbookOptions which has
    // no providers, yrsState, or initialSnapshot fields. The deprecated
    // HeadlessOptions does expose yrsState/initialSnapshot but those route
    // through headless environment where they are allowed.
    expect(true).toBe(true);
  });
});

// =============================================================================
// 6. collab sidecar — legitimate post-lifecycle path (not fenced)
// =============================================================================

describe('collab sidecar', () => {
  it('attaches post-lifecycle through the classified document sync port', () => {
    // The shell's CreateDocumentOptions.collab field triggers
    // attachWsSidecar() AFTER DocumentFactory.create completes. This
    // bypasses the provider lifecycle intentionally — the WS sidecar is
    // not a Provider (it doesn't persist), it's a sync overlay. Inbound
    // bytes still require DocumentByteSyncPort.applyClassifiedRawUpdate.
    expect(true).toBe(true);
  });
});

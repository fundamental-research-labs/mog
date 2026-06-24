import { jest } from '@jest/globals';

import { createDeterministicDocumentHost } from '@mog/test-host';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { HostDocumentRef, KernelHostContext } from '@mog-sdk/types-host/kernel';

const lifecycleConstructedMock = jest.fn();
const createFromXlsxMock = jest.fn();
const waitForReadyMock = jest.fn();
const awaitImportDurabilityMock = jest.fn();
const getImportDiagnosticsMock = jest.fn();
const validateAndResolveImportSourceMock = jest.fn();
const createDocumentHandleInternalMock = jest.fn();
const documentImportWarningsFromDiagnosticsMock = jest.fn();
const projectImportDiagnosticMock = jest.fn();
const xlsxImportRootSourceMock = jest.fn();
const xlsxVersionMetadataTrustMock = jest.fn();
const order: string[] = [];
const INTERNAL_INTERACTIVE_DEFERRED_IMPORT = Symbol('internal-interactive-deferred-import');

class MockDocumentLifecycleSystem {
  readonly documentContext = { kind: 'mock-document-context' };
  readonly computeBridge = {
    getImportDiagnostics: getImportDiagnosticsMock,
  };

  constructor(args: unknown) {
    lifecycleConstructedMock(args);
  }

  createFromXlsx(...args: unknown[]): void {
    order.push('create');
    createFromXlsxMock(...args);
  }

  async waitForReady(): Promise<void> {
    order.push('ready');
    await waitForReadyMock();
  }

  async awaitImportDurability(): Promise<void> {
    await awaitImportDurabilityMock();
  }
}

jest.unstable_mockModule('@mog-sdk/kernel/host-lifecycle-internal', () => ({
  DocumentLifecycleSystem: MockDocumentLifecycleSystem,
  INTERNAL_INTERACTIVE_DEFERRED_IMPORT,
  _createDocumentHandleInternal: createDocumentHandleInternalMock,
  attachHostBootstrapCollaborationSidecar: jest.fn(),
  documentImportWarningsFromDiagnostics: documentImportWarningsFromDiagnosticsMock,
  fetchRoomSnapshotForHostBootstrap: jest.fn(),
  projectImportDiagnostic: projectImportDiagnosticMock,
  validateAndResolveImportSource: validateAndResolveImportSourceMock,
  xlsxImportRootSource: xlsxImportRootSourceMock,
  xlsxVersionMetadataTrust: xlsxVersionMetadataTrustMock,
}));

const { importHostBackedDocument } = await import('@mog/kernel-host-internal');

const PRINCIPAL_FP: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:test-principal-fp';

function createImportKernelHost(): {
  host: KernelHostContext;
  bindings: ReturnType<typeof createDeterministicDocumentHost>['bindings'];
} {
  const deterministicHost = createDeterministicDocumentHost({
    operation: 'import',
    documentId: 'doc-import-001',
  });
  const storage = deterministicHost.kernelContext.storage;
  const documentRef: HostDocumentRef = {
    kind: 'source-handle',
    sourceHandleId: 'source-handle-001',
    issuance: {
      source: 'trusted-source-handle-registry',
      issuanceId: 'issuance-001',
      issuerHostId: storage.sourceHostId,
      contentIdentity: {
        kind: 'content-hash',
        algorithm: 'sha256',
        digest: 'test-digest',
      },
      issuedAt: deterministicHost.clock.now,
      expiresAt: storage.expiresAt,
    },
    sourceKind: 'uploaded-bytes',
    issuerHostId: storage.sourceHostId,
    sourceHostId: storage.sourceHostId,
    sourceSessionId: storage.sessionId,
    principalFingerprint: PRINCIPAL_FP,
    resourceContext: storage.resourceContext,
    expiresAt: storage.expiresAt,
    singleUse: true,
  };

  return {
    host: {
      ...deterministicHost.kernelContext,
      storage: {
        ...storage,
        documentRef,
      },
    },
    bindings: deterministicHost.bindings,
  };
}

describe('host-backed XLSX import readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    order.length = 0;
    waitForReadyMock.mockResolvedValue(undefined);
    getImportDiagnosticsMock.mockResolvedValue([]);
    validateAndResolveImportSourceMock.mockResolvedValue({
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    createDocumentHandleInternalMock.mockReturnValue({ kind: 'mock-handle' });
    documentImportWarningsFromDiagnosticsMock.mockReturnValue([]);
    projectImportDiagnosticMock.mockImplementation((diagnostic) => diagnostic);
    xlsxImportRootSourceMock.mockImplementation((source) => ({
      sourceType: 'bytes',
      byteLength: source.data.byteLength,
    }));
    xlsxVersionMetadataTrustMock.mockResolvedValue({
      trust: {
        status: 'absent',
        sidecarPart: 'customXml/mog-version-metadata.xml',
      },
      diagnostics: [],
    });
  });

  it('does not return a handle until import durability has completed', async () => {
    const { host, bindings } = createImportKernelHost();
    let releaseDurability!: () => void;
    let durabilityStarted!: () => void;
    const durabilityStartedPromise = new Promise<void>((resolve) => {
      durabilityStarted = resolve;
    });
    const durabilityBlocker = new Promise<void>((resolve) => {
      releaseDurability = resolve;
    });
    awaitImportDurabilityMock.mockImplementation(async () => {
      order.push('durability-start');
      durabilityStarted();
      await durabilityBlocker;
      order.push('durability-end');
    });

    let resolved = false;
    const importPromise = importHostBackedDocument(host, bindings).then((result) => {
      resolved = true;
      return result;
    });

    await durabilityStartedPromise;
    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(order).toEqual(['create', 'ready', 'durability-start']);

    releaseDurability();
    const result = await importPromise;

    expect(result).toEqual({ handle: { kind: 'mock-handle' }, importWarnings: [] });
    expect(awaitImportDurabilityMock).toHaveBeenCalledTimes(1);
    expect(getImportDiagnosticsMock).toHaveBeenCalledTimes(1);
    expect(createDocumentHandleInternalMock).toHaveBeenCalledWith(
      'doc-import-001',
      expect.any(MockDocumentLifecycleSystem),
      { kind: 'mock-document-context' },
      undefined,
      [],
      {
        kind: 'xlsx',
        source: { sourceType: 'bytes', byteLength: 4 },
        diagnostics: [],
        versionMetadataTrust: {
          status: 'absent',
          sidecarPart: 'customXml/mog-version-metadata.xml',
        },
      },
    );
    expect(order).toEqual(['create', 'ready', 'durability-start', 'durability-end']);
  });

  it('returns after critical ready when called with the internal interactive token', async () => {
    const { host, bindings } = createImportKernelHost();

    const result = await importHostBackedDocument(host, bindings, {
      interactiveDeferredImportToken: INTERNAL_INTERACTIVE_DEFERRED_IMPORT as never,
    });

    expect(result).toEqual({ handle: { kind: 'mock-handle' }, importWarnings: [] });
    expect(awaitImportDurabilityMock).not.toHaveBeenCalled();
    expect(getImportDiagnosticsMock).toHaveBeenCalledTimes(1);
    expect(createDocumentHandleInternalMock).toHaveBeenCalledWith(
      'doc-import-001',
      expect.any(MockDocumentLifecycleSystem),
      { kind: 'mock-document-context' },
      undefined,
      [],
      {
        kind: 'xlsx',
        source: { sourceType: 'bytes', byteLength: 4 },
        diagnostics: [],
        versionMetadataTrust: {
          status: 'absent',
          sidecarPart: 'customXml/mog-version-metadata.xml',
        },
      },
    );
    expect(order).toEqual(['create', 'ready']);
  });

  it('rejects an invalid interactive import token before lifecycle construction', async () => {
    const { host, bindings } = createImportKernelHost();

    await expect(
      importHostBackedDocument(host, bindings, {
        interactiveDeferredImportToken: Symbol('fake') as never,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_interactive_import_option',
      scope: 'allSheets',
    });

    expect(lifecycleConstructedMock).not.toHaveBeenCalled();
  });
});

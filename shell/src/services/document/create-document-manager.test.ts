import { jest } from '@jest/globals';
import { PUBLIC_VERSION_DOMAIN_DEFAULT_MANIFEST_MATRIX_ROW_IDS } from '@mog-sdk/contracts/versioning';
import {
  DocumentFactory,
  type DocumentHandle,
  type DocumentHandleWorkbookConfig,
} from '@mog-sdk/kernel';
import {
  createStandaloneBrowserHostBackedCollaborationDocument,
  createStandaloneBrowserHostBackedDocument,
  createStandaloneBrowserShellHost,
} from '../../host-adapters/standalone-browser-host';
import { createDocumentManager } from './create-document-manager';
import { importInteractiveHostBackedDocument } from './import-interactive-host-backed-document';

jest.mock(
  '@mog-sdk/kernel',
  () => ({
    DocumentFactory: {
      create: jest.fn(),
      createFromCsv: jest.fn(),
      createFromXlsx: jest.fn(),
    },
  }),
  { virtual: true },
);

jest.mock('../../host-adapters/standalone-browser-host', () => ({
  createStandaloneBrowserShellHost: jest.fn(),
  createStandaloneBrowserHostBackedDocument: jest.fn(),
  createStandaloneBrowserHostBackedCollaborationDocument: jest.fn(),
}));

jest.mock('./import-interactive-host-backed-document', () => ({
  importInteractiveHostBackedDocument: jest.fn(),
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function makeHandle(
  documentId: string,
  dispose?: () => Promise<void> | void,
  workbook: jest.Mock = jest.fn(async () => ({})),
  options: {
    readonly isImportDurabilityPending?: boolean | (() => boolean);
    readonly isReadOnly?: boolean | (() => boolean);
  } = {},
): DocumentHandle {
  const readIsReadOnly = () =>
    typeof options.isReadOnly === 'function' ? options.isReadOnly() : options.isReadOnly === true;
  const readIsImportDurabilityPending = () =>
    typeof options.isImportDurabilityPending === 'function'
      ? options.isImportDurabilityPending()
      : options.isImportDurabilityPending === true;
  return {
    documentId,
    dispose: jest.fn(dispose ?? (() => undefined)),
    workbook,
    get isReadOnly() {
      return readIsReadOnly();
    },
    get isImportDurabilityPending() {
      return readIsImportDurabilityPending();
    },
  } as unknown as DocumentHandle;
}

const DEFAULT_INDEXEDDB_PROVIDER_SELECTION = {
  kind: 'indexeddb',
  requireDurablePersistence: true,
} as const;

function capturedWorkbookConfig(workbook: jest.Mock): DocumentHandleWorkbookConfig | undefined {
  return workbook.mock.calls[0]?.[0] as DocumentHandleWorkbookConfig | undefined;
}

function expectDefaultIndexedDbProviderSelection(workbook: jest.Mock): void {
  const config = capturedWorkbookConfig(workbook);
  expect(capturedWorkbookConfig(workbook)).toMatchObject({
    versioning: {
      providerSelection: DEFAULT_INDEXEDDB_PROVIDER_SELECTION,
      domainSupportManifest: {
        schemaVersion: 'domain-support-manifest.v2',
        workbookId: expect.any(String),
        domains: expect.arrayContaining([
          expect.objectContaining({ matrixRowId: 'workbook-metadata' }),
          expect.objectContaining({ matrixRowId: 'cells.values' }),
          expect.objectContaining({ matrixRowId: 'cells.formulas' }),
        ]),
      },
    },
  });
  expect(
    config?.versioning?.domainSupportManifest?.domains.map((domain) => domain.matrixRowId),
  ).toEqual([...PUBLIC_VERSION_DOMAIN_DEFAULT_MANIFEST_MATRIX_ROW_IDS]);
}

function makeSidecar(options: { readonly status?: () => string } = {}) {
  return {
    detach: jest.fn(),
    get status() {
      return options.status?.() ?? 'online';
    },
    participants: new Map(),
    onStatusChange: jest.fn(() => jest.fn()),
    onPresenceChange: jest.fn(() => jest.fn()),
    setPresence: jest.fn(),
  };
}

describe('createDocumentManager import identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('injects IndexedDB providerSelection into blank document workbooks by default', async () => {
    const originalWorkbook = jest.fn(async () => ({}));
    const handle = makeHandle('file-blank', undefined, originalWorkbook);
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const returnedHandle = await manager.createDocument('file-blank');

    await returnedHandle.workbook();

    expectDefaultIndexedDbProviderSelection(originalWorkbook);
  });

  it('does not checkout the default version head when opening a persisted normal document', async () => {
    const checkout = jest.fn(async () => ({
      ok: true,
      value: {
        plan: { commitId: 'commit:sha256:opened' },
      },
    }));
    const originalWorkbook = jest.fn(async () => ({
      version: { checkout },
    }));
    const handle = makeHandle('file-open', undefined, originalWorkbook);
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const returnedHandle = await manager.createDocument('file-open', {
      operation: 'open',
    });

    await returnedHandle.workbook();
    await returnedHandle.workbook();

    expect(checkout).not.toHaveBeenCalled();
  });

  it('does not materialize the default version head for newly created normal documents', async () => {
    const checkout = jest.fn(async () => ({
      ok: true,
      value: {
        plan: { commitId: 'commit:sha256:created' },
      },
    }));
    const originalWorkbook = jest.fn(async () => ({
      version: { checkout },
    }));
    const handle = makeHandle('file-created', undefined, originalWorkbook);
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const returnedHandle = await manager.createDocument('file-created');

    await returnedHandle.workbook();

    expect(checkout).not.toHaveBeenCalled();
  });

  it('opens default IndexedDB versioning read-only when the local document provider is read-only', async () => {
    const originalWorkbook = jest.fn(async () => ({}));
    let readOnly = false;
    const handle = makeHandle('file-readonly', undefined, originalWorkbook, {
      isReadOnly: () => readOnly,
    });
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const returnedHandle = await manager.createDocument('file-readonly');

    readOnly = true;
    await returnedHandle.workbook();

    expect(capturedWorkbookConfig(originalWorkbook)?.versioning?.providerSelection).toMatchObject({
      kind: 'indexeddb',
      requireDurablePersistence: true,
      readOnly: true,
    });
  });

  it('injects IndexedDB providerSelection into XLSX import workbooks by default', async () => {
    const originalWorkbook = jest.fn(async () => ({}));
    const handle = makeHandle('file-xlsx', undefined, originalWorkbook, {
      isImportDurabilityPending: true,
    });
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(importInteractiveHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([1, 2, 3]) } as const;
    const returnedHandle = await manager.loadDocument('file-xlsx', source);

    await returnedHandle.workbook();

    expect(capturedWorkbookConfig(originalWorkbook)?.versioning?.providerSelection).toMatchObject({
      kind: 'indexeddb',
      requireDurablePersistence: true,
      initializeTiming: 'deferred',
    });
  });

  it('injects IndexedDB providerSelection into CSV import workbooks by default', async () => {
    const originalWorkbook = jest.fn(async () => ({}));
    const handle = makeHandle('file-csv', undefined, originalWorkbook);
    jest.mocked(DocumentFactory.createFromCsv).mockResolvedValue({
      success: true,
      sheetIds: [],
      handle,
      warnings: [],
    });

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([97, 44, 98]) } as const;
    const returnedHandle = await manager.loadDocument('file-csv', source, { kind: 'csv' });

    await returnedHandle.workbook();

    expectDefaultIndexedDbProviderSelection(originalWorkbook);
  });

  it('does not inject default versioning when local persistence is skipped', async () => {
    const originalWorkbook = jest.fn(async () => ({}));
    const handle = makeHandle('file-blank', undefined, originalWorkbook);
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const returnedHandle = await manager.createDocument('file-blank', {
      skipLocalPersistence: true,
    });

    await returnedHandle.workbook({
      versioning: {
        requireDomainSupportManifest: true,
      } as never,
    });

    expect(capturedWorkbookConfig(originalWorkbook)).toEqual({
      versioning: {
        requireDomainSupportManifest: true,
      },
    });
  });

  it('preserves caller-supplied versioning fields and providerSelection', async () => {
    const originalWorkbook = jest.fn(async () => ({}));
    const handle = makeHandle('file-blank', undefined, originalWorkbook);
    const hostResult = {
      dispose: jest.fn(),
    };
    const providerSelection = {
      kind: 'caller-provider',
      requireDurablePersistence: false,
    };
    const readLiveCollaborationStatus = jest.fn();
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const returnedHandle = await manager.createDocument('file-blank');

    await returnedHandle.workbook({
      versioning: {
        providerSelection,
        readLiveCollaborationStatus,
        requireDomainSupportManifest: true,
      } as never,
    });

    const calledConfig = capturedWorkbookConfig(originalWorkbook);
    expect(calledConfig?.versioning).toMatchObject({
      requireDomainSupportManifest: true,
    });
    expect(calledConfig?.versioning?.providerSelection).toBe(providerSelection);
    expect(calledConfig?.versioning?.readLiveCollaborationStatus).toBe(readLiveCollaborationStatus);
  });

  it('binds XLSX byte import documentId through the standalone browser host', async () => {
    const handle = makeHandle('file-xlsx');
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(importInteractiveHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([1, 2, 3]) } as const;

    await expect(manager.loadDocument('file-xlsx', source)).resolves.toBe(handle);

    expect(createStandaloneBrowserShellHost).toHaveBeenCalledWith({
      documentId: 'file-xlsx',
      wasmBaseUrl: '/',
      workerUrl: '/worker.js',
      operation: 'import',
      importBytes: source.data,
    });
    expect(importInteractiveHostBackedDocument).toHaveBeenCalledWith(hostResult);
    expect(manager.getDocument('file-xlsx')).toBe(handle);
  });

  it('passes host-provided runtime asset URLs to browser host-backed import', async () => {
    const handle = makeHandle('file-xlsx');
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(importInteractiveHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager({
      runtimeAssets: {
        wasmBaseUrl: '/shortcut/mog/wasm/',
        workerUrl: '/shortcut/mog/worker.js',
        staticAssetBase: '/shortcut/mog/assets/',
      },
    });
    const source = { type: 'bytes', data: new Uint8Array([1, 2, 3]) } as const;

    await manager.loadDocument('file-xlsx', source);

    expect(createStandaloneBrowserShellHost).toHaveBeenCalledWith({
      documentId: 'file-xlsx',
      wasmBaseUrl: '/shortcut/mog/wasm/',
      workerUrl: '/shortcut/mog/worker.js',
      staticAssetBase: '/shortcut/mog/assets/',
      operation: 'import',
      importBytes: source.data,
    });
  });

  it('passes skipLocalPersistence through blank document creation', async () => {
    const handle = makeHandle('file-blank');
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();

    await expect(
      manager.createDocument('file-blank', { skipLocalPersistence: true }),
    ).resolves.toBe(handle);

    expect(createStandaloneBrowserShellHost).toHaveBeenCalledWith({
      documentId: 'file-blank',
      wasmBaseUrl: '/',
      workerUrl: '/worker.js',
      operation: 'create',
      workbookLinkResolver: undefined,
      skipLocalPersistence: true,
    });
    expect(manager.getDocumentMode('file-blank')).toEqual({
      kind: 'normal',
      documentId: 'file-blank',
      skipLocalPersistence: true,
    });
  });

  it('binds CSV import documentId to the shell fileId', async () => {
    const handle = makeHandle('file-csv');
    const csvOptions = { delimiter: ',' };
    jest.mocked(DocumentFactory.createFromCsv).mockResolvedValue({
      success: true,
      sheetIds: [],
      handle,
      warnings: [],
    });

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([97, 44, 98]) } as const;

    await expect(
      manager.loadDocument('file-csv', source, { kind: 'csv', csvOptions }),
    ).resolves.toBe(handle);

    expect(DocumentFactory.createFromCsv).toHaveBeenCalledWith(source, {
      documentId: 'file-csv',
      csvOptions,
    });
    expect(manager.getDocument('file-csv')).toBe(handle);
  });

  it('passes skipLocalPersistence through CSV import', async () => {
    const handle = makeHandle('file-csv');
    jest.mocked(DocumentFactory.createFromCsv).mockResolvedValue({
      success: true,
      sheetIds: [],
      handle,
      warnings: [],
    });

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([97, 44, 98]) } as const;

    await expect(
      manager.loadDocument('file-csv', source, { kind: 'csv', skipLocalPersistence: true }),
    ).resolves.toBe(handle);

    expect(DocumentFactory.createFromCsv).toHaveBeenCalledWith(source, {
      documentId: 'file-csv',
      skipLocalPersistence: true,
    });
    expect(manager.getDocumentMode('file-csv')).toEqual({
      kind: 'normal',
      documentId: 'file-csv',
      skipLocalPersistence: true,
    });
  });

  it('rejects and does not cache a host-backed import whose handle id differs', async () => {
    const handle = makeHandle('generated-doc-id');
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue({ dispose: jest.fn() } as never);
    jest.mocked(importInteractiveHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([1]) } as const;

    await expect(manager.loadDocument('file-id', source)).rejects.toThrow(
      'Document identity mismatch',
    );

    expect(manager.getDocument('file-id')).toBeNull();
    expect(manager.getLoadingState('file-id')).toBe('error');
  });

  it('rejects path sources instead of falling back to direct DocumentFactory import', async () => {
    const manager = createDocumentManager();
    const source = { type: 'path', path: '/project/test.xlsx' } as const;

    await expect(manager.loadDocument('file-id', source)).rejects.toThrow(
      'Path document sources are not accepted',
    );

    expect(DocumentFactory.createFromXlsx).not.toHaveBeenCalled();
    expect(createStandaloneBrowserShellHost).not.toHaveBeenCalled();
  });

  it('serializes double dispose and disposes document resources exactly once', async () => {
    const handleDispose = deferred();
    const hostDispose = deferred();
    const handle = makeHandle('file-id', () => handleDispose.promise);
    const hostResult = {
      dispose: jest.fn(() => hostDispose.promise),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedDocument).mockResolvedValue(handle);

    const manager = createDocumentManager();
    await manager.createDocument('file-id');

    const first = manager.disposeDocument('file-id');
    const second = manager.disposeDocument('file-id');
    await flushMicrotasks();

    expect(manager.getDocument('file-id')).toBeNull();
    expect(hostResult.dispose).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);

    hostDispose.resolve();
    handleDispose.resolve();
    await Promise.all([first, second]);

    expect(hostResult.dispose).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('waits for old same-id disposal before reopening a new document', async () => {
    const oldHandleDispose = deferred();
    const oldHostDispose = deferred();
    const oldHandle = makeHandle('file-id', () => oldHandleDispose.promise);
    const newHandle = makeHandle('file-id');
    const oldHostResult = {
      dispose: jest.fn(() => oldHostDispose.promise),
    };
    const newHostResult = {
      dispose: jest.fn(),
    };
    jest
      .mocked(createStandaloneBrowserShellHost)
      .mockReturnValueOnce(oldHostResult as never)
      .mockReturnValueOnce(newHostResult as never);
    jest
      .mocked(createStandaloneBrowserHostBackedDocument)
      .mockResolvedValueOnce(oldHandle)
      .mockResolvedValueOnce(newHandle);

    const manager = createDocumentManager();
    await manager.createDocument('file-id');

    const disposeOld = manager.disposeDocument('file-id');
    const reopen = manager.createDocument('file-id');
    await flushMicrotasks();

    expect(createStandaloneBrowserShellHost).toHaveBeenCalledTimes(1);
    expect(manager.getDocument('file-id')).toBeNull();

    oldHostDispose.resolve();
    oldHandleDispose.resolve();
    await disposeOld;

    await expect(reopen).resolves.toBe(newHandle);
    expect(createStandaloneBrowserShellHost).toHaveBeenCalledTimes(2);
    expect(manager.getDocument('file-id')).toBe(newHandle);
    expect(oldHandle.dispose).toHaveBeenCalledTimes(1);
    expect(newHandle.dispose).not.toHaveBeenCalled();
  });

  it('replaces an already loaded normal document on create', async () => {
    const oldHandle = makeHandle('file-id');
    const newHandle = makeHandle('file-id');
    const oldHostResult = {
      dispose: jest.fn(),
    };
    const newHostResult = {
      dispose: jest.fn(),
    };
    jest
      .mocked(createStandaloneBrowserShellHost)
      .mockReturnValueOnce(oldHostResult as never)
      .mockReturnValueOnce(newHostResult as never);
    jest
      .mocked(createStandaloneBrowserHostBackedDocument)
      .mockResolvedValueOnce(oldHandle)
      .mockResolvedValueOnce(newHandle);

    const manager = createDocumentManager();
    await expect(manager.createDocument('file-id')).resolves.toBe(oldHandle);
    await expect(manager.createDocument('file-id')).resolves.toBe(newHandle);

    expect(createStandaloneBrowserShellHost).toHaveBeenCalledTimes(2);
    expect(oldHostResult.dispose).toHaveBeenCalledTimes(1);
    expect(oldHandle.dispose).toHaveBeenCalledTimes(1);
    expect(manager.getDocument('file-id')).toBe(newHandle);
  });

  it('does not publish an in-flight load that is disposed before completion', async () => {
    const loadDeferred = deferred<DocumentHandle>();
    const handle = makeHandle('file-id');
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(importInteractiveHostBackedDocument).mockReturnValue(loadDeferred.promise);

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([1]) } as const;
    const load = manager.loadDocument('file-id', source);
    await flushMicrotasks();
    const dispose = manager.disposeDocument('file-id');

    loadDeferred.resolve(handle);

    await expect(load).rejects.toThrow('disposed before it completed');
    await dispose;

    expect(manager.getDocument('file-id')).toBeNull();
    expect(hostResult.dispose).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposeAll waits for in-flight loads and leaves no late document behind', async () => {
    const loadDeferred = deferred<DocumentHandle>();
    const handle = makeHandle('file-id');
    const hostResult = {
      dispose: jest.fn(),
    };
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(importInteractiveHostBackedDocument).mockReturnValue(loadDeferred.promise);

    const manager = createDocumentManager();
    const source = { type: 'bytes', data: new Uint8Array([1]) } as const;
    const load = manager.loadDocument('file-id', source);
    await flushMicrotasks();
    const disposeAll = manager.disposeAll();

    loadDeferred.resolve(handle);

    await expect(load).rejects.toThrow('disposed before it completed');
    await disposeAll;

    expect(manager.getDocument('file-id')).toBeNull();
    expect(manager.getOpenFileIds()).toEqual([]);
    expect(hostResult.dispose).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposeAll waits for every document and clears state even when one dispose rejects', async () => {
    const goodHandle = makeHandle('good-file');
    const badDisposeError = new Error('bad dispose failed');
    const badHandle = makeHandle('bad-file', () => Promise.reject(badDisposeError));
    const goodHostResult = {
      dispose: jest.fn(),
    };
    const badHostResult = {
      dispose: jest.fn(),
    };
    jest
      .mocked(createStandaloneBrowserShellHost)
      .mockReturnValueOnce(goodHostResult as never)
      .mockReturnValueOnce(badHostResult as never);
    jest
      .mocked(createStandaloneBrowserHostBackedDocument)
      .mockResolvedValueOnce(goodHandle)
      .mockResolvedValueOnce(badHandle);

    const manager = createDocumentManager();
    await manager.createDocument('good-file');
    await manager.createDocument('bad-file');

    await expect(manager.disposeAll()).rejects.toThrow('disposeAll failed');

    expect(goodHostResult.dispose).toHaveBeenCalledTimes(1);
    expect(badHostResult.dispose).toHaveBeenCalledTimes(1);
    expect(goodHandle.dispose).toHaveBeenCalledTimes(1);
    expect(badHandle.dispose).toHaveBeenCalledTimes(1);
    expect(manager.getOpenFileIds()).toEqual([]);
    expect(manager.getLoadingState('good-file')).toBe('idle');
    expect(manager.getLoadingState('bad-file')).toBe('idle');
    await expect(manager.createDocument('after-dispose-all')).rejects.toThrow(
      'manager has been disposed',
    );
  });

  it('creates collaboration documents through the host-backed room bootstrap path', async () => {
    const handle = makeHandle('room-1');
    const sidecar = makeSidecar();
    const hostResult = { dispose: jest.fn() };
    const options = {
      documentId: 'room-1',
      baseUrl: 'ws://collab.test/socket/',
      roomId: 'room-1',
      participantId: 'participant-1',
    };
    const manager = createDocumentManager();
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedCollaborationDocument).mockResolvedValue({
      handle,
      sidecar,
      room: {
        roomId: 'room-1',
        roomUrl: 'ws://collab.test/socket/room-1',
        roomEpoch: 3,
        fullStateHash: 'hash-1',
        snapshotToken: 'token-1',
      },
    } as never);

    await expect(manager.createCollaborationDocument('file-1', options)).resolves.toBe(handle);

    expect(createStandaloneBrowserShellHost).toHaveBeenCalledWith({
      documentId: 'room-1',
      wasmBaseUrl: '/',
      workerUrl: '/worker.js',
      operation: 'open',
      skipLocalPersistence: true,
    });
    expect(createStandaloneBrowserHostBackedCollaborationDocument).toHaveBeenCalledWith(
      hostResult,
      options,
    );
    expect(manager.getDocument('file-1')).toBe(handle);
    expect(manager.getSidecar('file-1')).toBe(sidecar);
    expect(manager.getDocumentMode('file-1')).toEqual({
      kind: 'collaboration',
      documentId: 'room-1',
      roomId: 'room-1',
      roomUrl: 'ws://collab.test/socket/room-1',
      participantId: 'participant-1',
      bootstrapRoomEpoch: 3,
      bootstrapFullStateHash: 'hash-1',
      bootstrapSnapshotToken: 'token-1',
    });
  });

  it('passes live sidecar status reader into collaboration workbook config', async () => {
    let currentStatus = 'online';
    const originalWorkbook = jest.fn(async () => ({}));
    const handle = makeHandle('room-1', undefined, originalWorkbook);
    const sidecar = makeSidecar({ status: () => currentStatus });
    const hostResult = { dispose: jest.fn() };
    const options = {
      documentId: 'room-1',
      baseUrl: 'ws://collab.test/socket/',
      roomId: 'room-1',
      participantId: 'participant-1',
    };
    const manager = createDocumentManager();
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedCollaborationDocument).mockResolvedValue({
      handle,
      sidecar,
      room: {
        roomId: 'room-1',
        roomUrl: 'ws://collab.test/socket/room-1',
        roomEpoch: 3,
        fullStateHash: 'hash-1',
        snapshotToken: 'token-1',
      },
    } as never);

    const returnedHandle = await manager.createCollaborationDocument('file-1', options);
    await returnedHandle.workbook({
      versioning: {
        requireDomainSupportManifest: true,
      } as never,
    });

    expect(originalWorkbook).toHaveBeenCalledWith({
      versioning: expect.objectContaining({
        requireDomainSupportManifest: true,
        readLiveCollaborationStatus: expect.any(Function),
      }),
    });
    const calledConfig = originalWorkbook.mock.calls[0]?.[0] as {
      versioning?: {
        readLiveCollaborationStatus?: () => unknown;
      };
    };
    const readLiveCollaborationStatus = calledConfig.versioning?.readLiveCollaborationStatus;
    expect(readLiveCollaborationStatus).toBeDefined();
    expect(await readLiveCollaborationStatus?.()).toMatchObject({
      state: 'active',
      roomId: 'room-1',
      sidecarStatus: 'online',
    });

    currentStatus = 'reconnecting';
    expect(await readLiveCollaborationStatus?.()).toMatchObject({
      state: 'active',
      roomId: 'room-1',
      sidecarStatus: 'reconnecting',
    });
  });

  it('dedupes in-flight collaboration opens only for the same room identity', async () => {
    const resultDeferred = deferred<{
      handle: DocumentHandle;
      sidecar: ReturnType<typeof makeSidecar>;
      room: {
        roomId: string;
        roomUrl: string;
        roomEpoch: number;
        fullStateHash: string;
        snapshotToken: string;
      };
    }>();
    const handle = makeHandle('room-1');
    const sidecar = makeSidecar();
    const hostResult = { dispose: jest.fn() };
    const options = {
      documentId: 'room-1',
      baseUrl: 'ws://collab.test/socket',
      roomId: 'room-1',
      participantId: 'participant-1',
    };
    const manager = createDocumentManager();
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest
      .mocked(createStandaloneBrowserHostBackedCollaborationDocument)
      .mockReturnValue(resultDeferred.promise as never);

    const first = manager.createCollaborationDocument('file-1', options);
    const second = manager.createCollaborationDocument('file-1', options);
    await expect(
      manager.createCollaborationDocument('file-1', {
        ...options,
        participantId: 'participant-2',
      }),
    ).rejects.toThrow('in-flight open is not the requested collaboration room');
    await expect(manager.createDocument('file-1')).rejects.toThrow(
      'in-flight open is collaboration-backed',
    );

    resultDeferred.resolve({
      handle,
      sidecar,
      room: {
        roomId: 'room-1',
        roomUrl: 'ws://collab.test/socket/room-1',
        roomEpoch: 1,
        fullStateHash: 'hash-1',
        snapshotToken: 'token-1',
      },
    });

    await expect(first).resolves.toBe(handle);
    await expect(second).resolves.toBe(handle);
    expect(createStandaloneBrowserHostBackedCollaborationDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps a room-backed document registered when final close fails', async () => {
    const closeError = new Error('final flush failed');
    const handle = makeHandle('room-1', () => Promise.reject(closeError));
    const sidecar = makeSidecar();
    const hostResult = { dispose: jest.fn() };
    const manager = createDocumentManager();
    jest.mocked(createStandaloneBrowserShellHost).mockReturnValue(hostResult as never);
    jest.mocked(createStandaloneBrowserHostBackedCollaborationDocument).mockResolvedValue({
      handle,
      sidecar,
      room: {
        roomId: 'room-1',
        roomUrl: 'ws://collab.test/room-1',
        roomEpoch: 1,
        fullStateHash: 'hash-1',
        snapshotToken: 'token-1',
      },
    } as never);

    await manager.createCollaborationDocument('file-1', {
      documentId: 'room-1',
      baseUrl: 'ws://collab.test',
      roomId: 'room-1',
      participantId: 'participant-1',
    });

    await expect(manager.closeCollaborationDocument('file-1')).rejects.toThrow(
      'final flush failed',
    );

    expect(manager.getDocument('file-1')).toBe(handle);
    expect(manager.getSidecar('file-1')).toBe(sidecar);
    expect(manager.getDocumentMode('file-1')?.kind).toBe('collaboration');
    expect(hostResult.dispose).not.toHaveBeenCalled();
  });
});

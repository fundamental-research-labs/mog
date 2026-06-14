import { jest } from '@jest/globals';
import { DocumentFactory, type DocumentHandle } from '@mog-sdk/kernel';
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

function makeHandle(documentId: string, dispose?: () => Promise<void> | void): DocumentHandle {
  return {
    documentId,
    dispose: jest.fn(dispose ?? (() => undefined)),
  } as unknown as DocumentHandle;
}

function makeSidecar() {
  return {
    detach: jest.fn(),
    status: 'online',
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

/**
 * Shared test helpers for action handler unit tests.
 *
 * 01 introduced `platform: IPlatform` and
 * `shellService: ShellService` as REQUIRED fields on `ActionDependencies`.
 * Each handler test file builds its own `createMockDeps` (because every
 * handler exercises a different actor / accessor surface), but the new
 * platform/shell-service stubs are domain-agnostic — every test needs
 * the same shape — so they live here as small reusable factories.
 *
 * Tests should spread these into their existing deps mocks:
 * ```ts
 * const deps = {
 * ...buildHandlerActors,
 * platform: createMockPlatform,
 * shellService: createMockShellService,
 * } as unknown as ActionDependencies;
 * ```
 *
 * Override individual dialogs / handles per-test via:
 * ```ts
 * const handle = createMockFileHandle({ bytes: new Uint8Array([1, 2, 3]) });
 * (deps.platform.dialogs.showOpenDialog as jest.Mock).mockResolvedValueOnce(handle);
 * ```
 */

import { jest } from '@jest/globals';
import type { IPlatform, PlatformFileHandle } from '@mog-sdk/contracts/platform';
import type { ShellService } from '@mog-sdk/types-document/shell/types';

export function createChartAddReceipt(id = 'new-chart-id') {
  return {
    kind: 'chart.add' as const,
    status: 'applied' as const,
    effects: [],
    diagnostics: [],
    chart: { id },
  };
}

/**
 * Options for {@link createMockFileHandle}. Every field is optional so the
 * default produces a benign read-only handle whose `read()` returns an
 * empty buffer.
 */
export interface CreateMockFileHandleOptions {
  /** Bytes returned by `read()`. Defaults to an empty buffer. */
  bytes?: Uint8Array;
  /** Display name. Defaults to `'mock.xlsx'`. */
  name?: string;
  /** Optional desktop path. Undefined on web. */
  displayPath?: string;
  /** When true, `read()` rejects with an Error. */
  throwsOnRead?: boolean;
  /** When true, `write()` rejects with an Error. */
  throwsOnWrite?: boolean;
}

/**
 * Build a stub `PlatformFileHandle` for tests. Both `read` and `write` are
 * `jest.Mock`s so tests can assert call counts / arguments.
 */
export function createMockFileHandle(
  options: CreateMockFileHandleOptions = {},
): PlatformFileHandle & { read: jest.Mock; write: jest.Mock } {
  const {
    bytes = new Uint8Array(0),
    name = 'mock.xlsx',
    displayPath,
    throwsOnRead = false,
    throwsOnWrite = false,
  } = options;

  const read = jest.fn(async () => {
    if (throwsOnRead) {
      throw new Error(`mock handle ${name} is write-only`);
    }
    return bytes;
  });

  const write = jest.fn(async (_bytes: Uint8Array) => {
    if (throwsOnWrite) {
      throw new Error(`mock handle ${name} is read-only`);
    }
  });

  return { name, displayPath, read, write };
}

/**
 * Build a stub `IPlatform`. All methods are `jest.fn()`s; dialog methods
 * default to resolving `null` (cancelled). Tests override per-call via
 * `mockResolvedValueOnce`.
 */
export function createMockPlatform(): IPlatform {
  return {
    name: 'web',
    filesystem: {
      read: jest.fn(),
      write: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      stat: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      mkdir: jest.fn(),
    } as any,
    dialogs: {
      showOpenDialog: jest.fn().mockResolvedValue(null),
      showSaveDialog: jest.fn().mockResolvedValue(null),
      showOpenFolderDialog: jest.fn().mockResolvedValue(null),
      confirm: jest.fn().mockResolvedValue(false),
      alert: jest.fn().mockResolvedValue(undefined),
    },
    notifications: {
      show: jest.fn().mockResolvedValue(undefined),
      requestPermission: jest.fn().mockResolvedValue(false),
    },
    clipboard: {
      readText: jest.fn().mockResolvedValue(''),
      writeText: jest.fn().mockResolvedValue(undefined),
      readImage: jest.fn().mockResolvedValue(null),
      writeImage: jest.fn().mockResolvedValue(undefined),
    },
    shell: {
      openExternal: jest.fn().mockResolvedValue(undefined),
      revealInFileManager: jest.fn().mockResolvedValue(undefined),
      setWindowTitle: jest.fn(),
    },
  } as IPlatform;
}

/**
 * Build a stub `ShellService` for tests. Every method is a `jest.Mock`.
 * `getDocumentState()` returns a stable empty snapshot.
 */
export function createMockShellService(): ShellService {
  return {
    loadDocument: jest.fn(async (_name: string, _bytes: Uint8Array) => 'mock-file-id'),
    newDocument: jest.fn(async () => 'mock-file-id'),
    closeActiveDocument: jest.fn(() => true),
    setActiveDocument: jest.fn(),
    getDocumentState: jest.fn(() => ({
      activeFileId: null,
      openFileIds: [],
      files: {},
    })),
    setDocumentHandle: jest.fn(),
    hasUnsavedChanges: jest.fn(() => false),
  } satisfies ShellService;
}

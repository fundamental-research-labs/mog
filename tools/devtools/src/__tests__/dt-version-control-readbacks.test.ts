/**
 * `__dt.versionControl` public readback gate.
 *
 * These tests assert that DevTools reads version-control state only through
 * the production `workbook.version` facade. Private document contexts and
 * graph stores are deliberately not part of this contract.
 *
 * Run via: `bun test tools/devtools/src/__tests__/dt-version-control-readbacks.test.ts`.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { createConsoleAPI } from '../console/api';
import { EventStore } from '../event-store';
import { ActorRecorder } from '../recorders/actor-recorder';
import type { DevToolsConsoleAPI } from '../types';

interface RuntimeBundle {
  api: DevToolsConsoleAPI;
  cleanup: () => void;
}

function setupRuntime(version?: unknown): RuntimeBundle {
  const g = globalThis as { window?: Record<string, unknown>; document?: unknown };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      __COORDINATOR__: {
        workbook: version === undefined ? {} : { version },
      },
      __SHELL__: {
        store: { getState: () => ({ activeFileId: 'doc-1' }) },
        documentManager: {
          getDocument: () => null,
        },
      },
    },
  });

  const store = new EventStore();
  store.enable();
  const api = createConsoleAPI(store, new ActorRecorder(store));
  (g.window as any).__dt = api;
  return {
    api,
    cleanup() {
      delete g.window;
      delete g.document;
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: undefined,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: undefined,
      });
    },
  };
}

describe('__dt.versionControl readbacks', () => {
  let runtime: RuntimeBundle | null = null;

  afterEach(() => {
    runtime?.cleanup();
    runtime = null;
  });

  test('routes status, head, commits, and refs through coordinator workbook.version', async () => {
    const calls: Array<{ method: string; options?: unknown }> = [];
    const surfaceStatus = { schemaVersion: 1, documentId: 'doc-1', stage: 'authoring' };
    const head = { ok: true, value: { id: `commit:sha256:${'a'.repeat(64)}` } };
    const commits = { ok: true, value: { items: [], limit: 7 } };
    const refs = { ok: true, value: { items: [], limit: 50 } };
    const version = {
      getSurfaceStatus: async () => {
        calls.push({ method: 'getSurfaceStatus' });
        return surfaceStatus;
      },
      getHead: async (options?: unknown) => {
        calls.push({ method: 'getHead', options });
        return head;
      },
      listCommits: async (options?: unknown) => {
        calls.push({ method: 'listCommits', options });
        return commits;
      },
      listRefs: async (options?: unknown) => {
        calls.push({ method: 'listRefs', options });
        return refs;
      },
    };

    runtime = setupRuntime(version);
    const api = runtime.api;
    const headOptions = { includeDiagnostics: true };
    const commitOptions = { pageSize: 7, includeDiagnostics: true };
    const refOptions = { includeDiagnostics: true };

    expect(await api.versionControl.getSurfaceStatus()).toBe(surfaceStatus);
    expect(await api.versionControl.getHead(headOptions)).toBe(head);
    expect(await api.versionControl.listCommits(commitOptions)).toBe(commits);
    expect(await api.versionControl.listRefs(refOptions)).toBe(refs);
    expect(calls).toEqual([
      { method: 'getSurfaceStatus' },
      { method: 'getHead', options: headOptions },
      { method: 'listCommits', options: commitOptions },
      { method: 'listRefs', options: refOptions },
    ]);
  });

  test('awaits shell handle.workbook and does not inspect private document context', async () => {
    const head = { ok: true, value: { id: `commit:sha256:${'b'.repeat(64)}` } };
    const version = {
      getHead: async () => head,
    };
    runtime = setupRuntime();
    const api = runtime.api;
    const win = (globalThis as any).window;
    delete win.__COORDINATOR__.workbook;

    const handle: Record<string, unknown> = {};
    Object.defineProperty(handle, 'context', {
      get() {
        throw new Error('private document context was inspected');
      },
    });
    Object.defineProperty(handle, 'workbook', {
      value: async () => ({ version }),
    });
    win.__SHELL__.documentManager.getDocument = () => handle;

    expect(await api.versionControl.getHead()).toBe(head);
  });

  test('returns null when no public workbook.version facade is available', async () => {
    runtime = setupRuntime();
    const api = runtime.api;

    expect(await api.versionControl.getSurfaceStatus()).toBeNull();
    expect(await api.versionControl.getHead()).toBeNull();
    expect(await api.versionControl.listCommits()).toBeNull();
    expect(await api.versionControl.listRefs()).toBeNull();
  });
});

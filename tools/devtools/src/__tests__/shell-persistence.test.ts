import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  installPersistenceEnabledGetter,
  installPersistenceProvidersGetter,
  installPersistenceStateGetter,
  installProviderStateGetter,
} from '../shell-persistence';

describe('shell persistence devtools bridge', () => {
  let previousWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __dt: {} },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  });

  test('installs a live persistenceEnabled getter', () => {
    let appended = false;
    let hooks = false;
    let boot = false;

    installPersistenceEnabledGetter({
      hasAnyAppendActive: () => appended,
      lifecycleHooksRegistered: () => hooks,
      bootResolutionTerminal: () => boot,
    });

    expect(window.__dt.persistenceEnabled).toBe(false);
    appended = true;
    hooks = true;
    boot = true;
    expect(window.__dt.persistenceEnabled).toBe(true);
  });

  test('installs live persistence state and provider state readbacks', () => {
    let pendingUpdates = 2;
    let readOnly = false;

    installPersistenceStateGetter({
      readPersistenceState: () => [
        [
          'doc-1',
          {
            pendingUpdates,
            hasFlushFailed: false,
            hasAppendActive: true,
          },
        ],
      ],
    });
    installProviderStateGetter({
      readHasAnyDocReadOnly: () => readOnly,
    });

    expect(window.__dt.persistenceState?.['doc-1']?.pendingUpdates).toBe(2);
    expect(window.__dt.providerState?.readOnly).toBe(false);

    pendingUpdates = 0;
    readOnly = true;
    expect(window.__dt.persistenceState?.['doc-1']?.pendingUpdates).toBe(0);
    expect(window.__dt.providerState?.readOnly).toBe(true);
  });

  test('extracts IndexedDB inspection handles without behavior knobs', () => {
    const idbDatabase = { name: 'mog-docs' } as IDBDatabase;
    const provider = { _devtoolsDb: idbDatabase };

    installPersistenceProvidersGetter({
      readPersistenceProviders: () => [['doc-1', { providers: [provider] }]],
    });

    expect(window.__dt.persistenceProviders?.['doc-1']?.idbDatabase).toBe(idbDatabase);
    expect(window.__dt.persistenceProviders?.['doc-1']?.indexedDbProvider).toBe(provider);
  });
});

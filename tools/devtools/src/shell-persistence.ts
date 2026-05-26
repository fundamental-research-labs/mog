/**
 * Shell persistence readbacks for the `window.__dt` console API.
 *
 * Devtools owns the `__dt` object. Shell owns the live document/lifecycle
 * state. This module is the typed bridge between those two owners.
 */

import type {
  DevToolsConsoleAPI,
  PersistenceProviderInspection,
  PersistenceProvidersSnapshot,
  PersistenceStateSnapshot,
  ProviderStateSnapshot,
} from './types';

type DevToolsPersistenceAPI = Pick<
  DevToolsConsoleAPI,
  'persistenceEnabled' | 'persistenceState' | 'providerState' | 'persistenceProviders'
>;

function getDevToolsConsole(): Partial<DevToolsPersistenceAPI> | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { __dt?: Partial<DevToolsPersistenceAPI> }).__dt ?? null;
}

function logMissingDevTools(installer: string): void {
  console.info(
    `[devtools:shell-persistence] ${installer}: window.__dt not yet present; ` +
      'the shell should re-invoke after devtools setup.',
  );
}

// =============================================================================
// `__dt.persistenceEnabled`
// =============================================================================

/**
 * Three readers contributed by independent shell/kernel lifecycle tracks.
 */
export interface PersistenceEnabledReaders {
  hasAnyAppendActive(): boolean;
  lifecycleHooksRegistered(): boolean;
  bootResolutionTerminal(): boolean;
}

/**
 * Install the live `__dt.persistenceEnabled` getter.
 */
export function installPersistenceEnabledGetter(readers: PersistenceEnabledReaders): void {
  const dt = getDevToolsConsole();
  if (!dt) {
    logMissingDevTools('installPersistenceEnabledGetter');
    return;
  }

  Object.defineProperty(dt, 'persistenceEnabled', {
    configurable: true,
    enumerable: true,
    get(): boolean {
      try {
        return (
          readers.hasAnyAppendActive() &&
          readers.lifecycleHooksRegistered() &&
          readers.bootResolutionTerminal()
        );
      } catch (err) {
        console.error('[__dt.persistenceEnabled] reader threw:', err);
        return false;
      }
    },
  });
}

// =============================================================================
// `__dt.persistenceState[docId]`
// =============================================================================

export interface PersistenceStateReader {
  readPersistenceState(): Iterable<readonly [string, PersistenceStateSnapshot]>;
}

export function installPersistenceStateGetter(reader: PersistenceStateReader): void {
  const dt = getDevToolsConsole();
  if (!dt) {
    logMissingDevTools('installPersistenceStateGetter');
    return;
  }

  Object.defineProperty(dt, 'persistenceState', {
    configurable: true,
    enumerable: true,
    get(): Readonly<Record<string, PersistenceStateSnapshot>> {
      const out: Record<string, PersistenceStateSnapshot> = {};
      try {
        for (const [docId, snap] of reader.readPersistenceState()) {
          out[docId] = snap;
        }
      } catch (err) {
        console.error('[__dt.persistenceState] reader threw:', err);
      }
      return out;
    },
  });
}

// =============================================================================
// `__dt.providerState`
// =============================================================================

export interface ProviderStateReaders {
  readHasAnyDocReadOnly(): boolean;
}

export function installProviderStateGetter(readers: ProviderStateReaders): void {
  const dt = getDevToolsConsole();
  if (!dt) {
    logMissingDevTools('installProviderStateGetter');
    return;
  }

  Object.defineProperty(dt, 'providerState', {
    configurable: true,
    enumerable: true,
    get(): Readonly<ProviderStateSnapshot> {
      try {
        return { readOnly: readers.readHasAnyDocReadOnly() };
      } catch (err) {
        console.error('[__dt.providerState] reader threw:', err);
        return { readOnly: false };
      }
    },
  });
}

// =============================================================================
// `__dt.persistenceProviders[docId]`
// =============================================================================

export interface PersistenceProvidersReader {
  readPersistenceProviders(): Iterable<readonly [string, { providers: readonly object[] }]>;
}

function hasPersistenceProviderInspection(
  provider: object,
): provider is PersistenceProviderInspection {
  return '_devtoolsDb' in provider;
}

export function installPersistenceProvidersGetter(reader: PersistenceProvidersReader): void {
  const dt = getDevToolsConsole();
  if (!dt) {
    logMissingDevTools('installPersistenceProvidersGetter');
    return;
  }

  Object.defineProperty(dt, 'persistenceProviders', {
    configurable: true,
    enumerable: true,
    get(): Readonly<Record<string, PersistenceProvidersSnapshot>> {
      const out: Record<string, PersistenceProvidersSnapshot> = {};
      try {
        for (const [docId, { providers }] of reader.readPersistenceProviders()) {
          let idbDatabase: IDBDatabase | null = null;
          let indexedDbProvider: PersistenceProviderInspection | null = null;
          for (const provider of providers) {
            if (!hasPersistenceProviderInspection(provider)) continue;
            const candidate = provider._devtoolsDb ?? null;
            if (candidate) {
              idbDatabase = candidate;
              indexedDbProvider = provider;
              break;
            }
          }
          out[docId] = { idbDatabase, indexedDbProvider };
        }
      } catch (err) {
        console.error('[__dt.persistenceProviders] reader threw:', err);
      }
      return out;
    },
  });
}

/**
 * Shell Bootstrap
 *
 * Initializes all shell infrastructure BEFORE React mounts.
 * This is the entry point for the shell layer.
 *
 * Bootstrap sequence:
 * 1. Create store (sync, always succeeds)
 * 2. Initialize platform (async, may timeout or fail gracefully)
 * 3. Create services (sync, depends on platform)
 * 4. Create event dispatcher (sync)
 * 5. Start event dispatcher (async, wires up Tauri listeners)
 *
 * After bootstrap completes, React mounts and receives the pre-created shell.
 * React components never do async initialization or create services.
 *
 */

import type { IPlatform } from '@mog-sdk/contracts/platform';
import {
  installPersistenceEnabledGetter,
  installPersistenceProvidersGetter,
  installPersistenceStateGetter,
  installProviderStateGetter,
} from '@mog/devtools/shell-persistence';
import { installEvictionSink } from '@mog-sdk/kernel/storage';
import { createPlatformIdentity } from '@mog/platform/identity';
import { createMenuShortcutSync, type MenuShortcutSync } from '@mog/platform/menu/menu-sync';
import { fileTypeRegistry } from '../lib/file-type-registry';
import {
  readBootResolutionTerminal,
  readHasAnyAppendActive,
  readHasAnyDocReadOnly,
  readLifecycleHooksRegistered,
  readPersistenceProvidersSnapshots,
  readPersistenceStateSnapshots,
} from '../services/lifecycle-state';
import { createDocumentManager } from '../services/document';
import { installActiveDocumentRecency } from '../services/active-document-recency';
import { createShellCapabilityRegistry } from '../services/capabilities';
import { createProjectService, type ProjectService } from '../services/project';
import { createTauriIpc } from '../services/project/tauri-ipc';
import { createRecentDocsStore } from '../services/recent-docs';
import { createShellService } from '../services/shell-service';
import type { ShellService } from '@mog-sdk/types-document/shell/types';
import { createTrapRecoveryCoordinator } from '../services/trap-recovery';
import { createShellStore } from '../ui-store/shell-store';
import type { EventDispatcher } from './dispatcher-types';
import { createEventDispatcher } from './event-dispatcher';
import { setBeforeUnloadPrompt } from '../host/hooks/app-document-lifecycle';
import type { ShellBootstrapConfig, ShellBootstrapResult } from './types';

// =============================================================================
// Platform Initialization
// =============================================================================

/**
 * Initialize the platform with timeout.
 *
 * Returns null if:
 * - Not running in Tauri (web browser)
 * - Platform initialization fails
 * - Platform initialization times out
 */
async function initializePlatform(timeoutMs: number): Promise<IPlatform | null> {
  // Dynamic import to avoid loading Tauri code in web builds
  const { isTauri } = await import('@mog/platform/tauri/detection');

  if (!isTauri()) {
    // shell-service facade: every host (web included) needs an IPlatform now
    // because action handlers go through `deps.platform.dialogs.*`. The web
    // build instantiates `WebPlatform` (via `createPlatform()` factory) with
    // a `MemoryFileSystem` placeholder for the `IFileSystem` capability —
    // app-level file I/O (which actually uses that capability) is gated by
    // the cloud-FS path; dialogs / clipboard / shell are FS-independent.
    try {
      const { createPlatform } = await import('@mog/platform');
      const { MemoryFileSystem } = await import('@mog/platform-memory');
      return await createPlatform(new MemoryFileSystem());
    } catch (err) {
      console.error('[Shell] Web platform initialization failed:', err);
      return null;
    }
  }

  const { createPlatform } = await import('@mog/platform');

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      createPlatform().then((platform) => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        return platform;
      }),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn('[Shell] Platform initialization timed out');
          resolve(null);
        }, timeoutMs);
      }),
    ]);

    return result;
  } catch (err) {
    console.error('[Shell] Platform initialization failed:', err);
    return null;
  }
}

// =============================================================================
// Main Bootstrap Function
// =============================================================================

/**
 * Create and initialize the shell.
 *
 * This function:
 * 1. Creates the shell store (always, sync)
 * 2. Initializes the platform (if Tauri, async)
 * 3. Creates the project service (if platform available)
 * 4. Creates and starts the event dispatcher
 *
 * Call this BEFORE mounting React. Pass the result to ShellProvider.
 *
 * @example
 * ```ts
 * // In your main.tsx, BEFORE ReactDOM.render:
 * const shell = await createShell();
 *
 * // Start the event dispatcher
 * await shell.eventDispatcher.start();
 *
 * // Then render React with pre-created shell
 * ReactDOM.render(
 *   <ShellProvider shell={shell}>
 *     <App />
 *   </ShellProvider>,
 *   document.getElementById('root')
 * );
 * ```
 */
export async function createShell(
  config: ShellBootstrapConfig = {},
): Promise<ShellBootstrapResult> {
  const { platformTimeout = 3000, collabUrl } = config;

  // Wire beforeunload prompt preference before lifecycle hooks register.
  if (config.beforeUnloadPrompt === false) {
    setBeforeUnloadPrompt(false);
  }

  // Resolve CollabConfig: explicit `collab` takes precedence over bare `collabUrl`
  const collabConfig = config.collab ?? null;

  // -------------------------------------------------------------------------
  // 0. Create platform identity (sync, always succeeds, before everything)
  // -------------------------------------------------------------------------
  const platformIdentity = createPlatformIdentity();

  // -------------------------------------------------------------------------
  // 1. Create store (sync, always succeeds)
  // -------------------------------------------------------------------------
  const store = createShellStore();

  // -------------------------------------------------------------------------
  // 1b. Create recent-docs store + kick off hydration in parallel with WASM
  //     (current implementation §6.2). The bootstrap does NOT await `hydrate()` — per the
  //     plan, the meta read must run "off the first-paint path." Consumers
  //     that need to wait gate on `recentDocsStore.getState().loaded`.
  // -------------------------------------------------------------------------
  const recentDocsStore = createRecentDocsStore();
  // Fire-and-forget. Errors are logged inside the slice's `hydrate()`
  // implementation; `loaded` flips even on IDB failure so the boot
  // precedence table falls through to "no recent doc" cleanly rather
  // than blocking forever on a transient hiccup.
  void recentDocsStore.getState().hydrate();

  // -------------------------------------------------------------------------
  // 1c. Install §6.3 `__dt.persistenceEnabled` getter on `window.__dt`.
  //     Reads three live conditions on every access — never caches.
  //     Idempotent (HMR-safe). No-ops if `__dt` isn't ready yet (devtools
  //     setup runs before this in production; tests don't have devtools).
  // -------------------------------------------------------------------------
  installPersistenceEnabledGetter({
    hasAnyAppendActive: readHasAnyAppendActive,
    lifecycleHooksRegistered: readLifecycleHooksRegistered,
    bootResolutionTerminal: readBootResolutionTerminal,
  });

  // -------------------------------------------------------------------------
  // 1d. Install §9 #5 `__dt.persistenceState[docId]` getter on `window.__dt`.
  //     Surfaces per-doc orchestrator state (`pendingUpdates`,
  //     `hasFlushFailed`, `hasAppendActive`) for lifecycle persistence
  //     scenarios that need to read transient persistence-layer state from
  //     a Playwright spec.
  //
  //     Generalisation (UX-FIX-PRINCIPLES §3): one getter, all three
  //     fields the orchestrator already exposes — future scenarios plug
  //     in for free without growing the surface.
  // -------------------------------------------------------------------------
  installPersistenceStateGetter({
    readPersistenceState: () => readPersistenceStateSnapshots(),
  });

  // -------------------------------------------------------------------------
  // 1d-bis. Install `__dt.persistenceProviders[docId]` getter on `window.__dt`.
  //     **`__dt`-only** inspection surface: per-doc handle bag exposing the
  //     live `IDBDatabase` of the IndexedDBProvider so a Playwright spec
  //     can shadow `db.transaction()` directly to drive Current §6.1's
  //     flushFailed safety-net path. Same pattern `FailingIndexedDBProvider`
  //     uses inside the kernel-side conformance suite, lifted across the
  //     page boundary to avoid a behavior knob in production code.
  // -------------------------------------------------------------------------
  installPersistenceProvidersGetter({
    readPersistenceProviders: () => readPersistenceProvidersSnapshots(),
  });

  // -------------------------------------------------------------------------
  // 1e. Install §7 Q1 `__dt.providerState.readOnly` getter on `window.__dt`.
  //     Returns `{ readOnly: boolean }` — live-evaluated on every access.
  //     `true` when at least one active doc is in read-only mode (another
  //     tab holds the Web Lock for that docId). Used by the two-tab-write-
  //     lock scenario to detect the read-only state without a DOM banner.
  // -------------------------------------------------------------------------
  installProviderStateGetter({
    readHasAnyDocReadOnly,
  });

  // -------------------------------------------------------------------------
  // 1f. Install IndexedDBProvider eviction sink — routes provider eviction
  //     events through `__dt.captureError` so the hard-kill persistence scenario
  //     can read them via `__dt.getRecentErrors()`. Replaces the prior
  //     hand-coded `globalThis.__dt.captureError` reach inside the
  //     provider (UX-FIX-PRINCIPLES §1: no kernel reach into devtools
  //     globals from production code).
  // -------------------------------------------------------------------------
  installEvictionSink((event) => {
    if (typeof window === 'undefined') return;
    const dt = (window as { __dt?: { captureError?: (source: string, err: unknown) => void } })
      .__dt;
    dt?.captureError?.('IndexedDB.eviction', event.message);
  });

  // -------------------------------------------------------------------------
  // 2. Initialize platform (async, may be null)
  // -------------------------------------------------------------------------
  let platform = config.platform ?? null;
  if (!platform) {
    platform = await initializePlatform(platformTimeout);
  }
  // -------------------------------------------------------------------------
  // 3. Create DocumentManager (before ProjectService, survives React remounts)
  // -------------------------------------------------------------------------
  const documentManager = createDocumentManager({ runtimeAssets: config.runtimeAssets });
  const disposeActiveDocumentRecency = installActiveDocumentRecency({
    store,
    documentManager,
    recentDocsStore,
  });

  // -------------------------------------------------------------------------
  // 3b. Trap-recovery coordinator.
  //     Self-installs onto every DocumentHandle the manager creates via the
  //     manager's subscribe() callback — when ANY doc's ComputeCore observes
  //     a wasm32 trap, the coordinator marks that doc failed, resets the
  //     WASM module, and replays every healthy sibling onto a fresh
  //     instance. Single trap, single recovery; further traps log and drop.
  //
  //     Held in a closure-local; not exported on ShellBootstrapResult
  //     because nothing outside the shell consumes it. Disposed in
  //     `dispose()` below alongside the rest of the shell services.
  // -------------------------------------------------------------------------
  const trapRecoveryCoordinator = createTrapRecoveryCoordinator(documentManager);

  // -------------------------------------------------------------------------
  // 4. Create services (depends on platform)
  // -------------------------------------------------------------------------
  let projectService: ProjectService | null = null;
  let shellService: ShellService | null = null;

  if (platform) {
    projectService = createProjectService({
      store,
      platform,
      ipc: createTauriIpc(),
      fileTypeRegistry,
      documentManager,
    });
    // shell-service facade: typed facade composing documentManager +
    // projectService for action-handler dispatch. Created here so the
    // bootstrap graph only ever has one shell-service instance.
    shellService = createShellService({
      documentManager,
      projectService,
      store,
    });
    // Restore last project on startup
    // This runs BEFORE React mounts, ensuring sidebar shows immediately
    try {
      await projectService.restoreLastProject();
    } catch (err) {
      console.warn('[Shell] Failed to restore last project:', err);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Create event dispatcher
  // -------------------------------------------------------------------------
  const eventDispatcher: EventDispatcher = createEventDispatcher({
    platform,
    store,
    projectService,
  });

  // -------------------------------------------------------------------------
  // 5b. Create menu shortcut sync (desktop only)
  // -------------------------------------------------------------------------
  // MenuShortcutSync keeps the native Tauri menu accelerators in sync with
  // the JS shortcut registry. On web, createMenuShortcutSync returns null.
  //
  // We lazily import the keyboard settings store to avoid a hard dependency
  // on the spreadsheet app layer. The sync is fire-and-forget — a failed
  // sync does not prevent the app from booting.
  let menuSync: MenuShortcutSync | null = null;

  if (platformIdentity.runtime === 'desktop') {
    try {
      // Dynamic cross-layer import (shell → app) — kept out of the typed graph
      // on purpose; shell must not structurally depend on the spreadsheet app.
      // The module is resolved at runtime; the type is intentionally loose.
      type ShortcutRegistryLoose = import('@mog-sdk/contracts/keyboard').ShortcutRegistry;
      const keyboardSettingsStoreModule = (await import(
        /* @vite-ignore */
        '../../../apps/spreadsheet/src/infra/state/keyboard-settings-store' as string
      )) as {
        useKeyboardSettingsStore: {
          getState: () => { getActiveShortcuts: () => ShortcutRegistryLoose };
          subscribe: (listener: () => void) => void;
        };
      };
      const { useKeyboardSettingsStore } = keyboardSettingsStoreModule;

      menuSync = createMenuShortcutSync(platformIdentity, () =>
        useKeyboardSettingsStore.getState().getActiveShortcuts(),
      );

      if (menuSync) {
        // Initial sync
        void menuSync.sync();

        // Re-sync whenever the keyboard settings store changes
        // (user customizes shortcuts, switches profiles, etc.)
        useKeyboardSettingsStore.subscribe(() => {
          void menuSync!.sync();
        });
      }
    } catch (err) {
      console.warn('[Shell] Failed to create menu shortcut sync:', err);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Create cleanup function
  // -------------------------------------------------------------------------
  const capabilityRegistry = config.capabilityRegistry ?? createShellCapabilityRegistry();
  const ownsCapabilityRegistry = config.capabilityRegistry === undefined;
  let disposePromise: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;

    disposePromise = (async () => {
      const failures: unknown[] = [];
      const runSyncDispose = (name: string, fn: () => void): void => {
        try {
          fn();
        } catch (err) {
          console.error(`[Shell] ${name} failed during shell dispose:`, err);
          failures.push(err);
        }
      };

      runSyncDispose('menuSync.dispose', () => menuSync?.dispose());
      runSyncDispose('trapRecoveryCoordinator.dispose', () => trapRecoveryCoordinator.dispose());
      runSyncDispose('activeDocumentRecency.dispose', () => disposeActiveDocumentRecency());
      runSyncDispose('eventDispatcher.stop', () => eventDispatcher.stop());
      if (ownsCapabilityRegistry) {
        runSyncDispose('capabilityRegistry.dispose', () => capabilityRegistry.dispose?.());
      }

      try {
        await documentManager.disposeAll();
      } catch (err) {
        console.error('[Shell] documentManager.disposeAll failed during shell dispose:', err);
        failures.push(err);
      }

      if (failures.length > 0) {
        throw new AggregateError(failures, '[Shell] dispose failed');
      }
    })();
    return disposePromise;
  };

  return {
    platformIdentity,
    platform,
    store,
    projectService,
    documentManager,
    shellService,
    eventDispatcher,
    recentDocsStore,
    collabUrl: collabConfig?.baseUrl ?? collabUrl ?? null,
    collabConfig,
    capabilityRegistry,
    dispose,
  };
}

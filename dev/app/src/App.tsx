/**
 * Dev App - Development Application for the OS
 *
 * This is a thin wrapper that demonstrates the OS shell architecture.
 * It bootstraps the shell and renders ShellHost which can run ANY app.
 *
 * ## Architecture
 *
 * The OS follows a clean separation of concerns:
 * 1. Shell Bootstrap - Platform detection, services, event dispatcher (runs BEFORE React)
 * 2. ShellHost - Generic app container with chrome (sidebar, header, etc.)
 * 3. Apps - Each app can handle its own document loading
 *
 * Document Loading:
 * - Shell provides a fallback kernel for apps that need one (CRM, etc.)
 * - SpreadsheetApp manages its own document via useShellDocument hook
 * - When files are opened via FileExplorer, SpreadsheetApp loads them
 *
 */

import { ShellProvider } from '@mog/app-spreadsheet';
import { registerSpreadsheetTestingPanel } from '@mog/app-spreadsheet/dev/testing-panel';
import { DocumentFactory, type DocumentHandle } from '@mog-sdk/kernel';
import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import { createAppKernelAPIFromHandle } from '@mog-sdk/kernel/app-api';
import { hasPersistedSnapshot, readMeta } from '@mog-sdk/kernel/storage';
import type { ShellBootstrapResult } from '@mog/shell';
import {
  CapabilityProvider,
  createShell,
  markBootResolutionTerminal,
  PortalContainerProvider,
  SettingsDialog,
  ShellHost,
  useFileExplorerConfig,
} from '@mog/shell';
import { useCollabStore } from '@mog/app-spreadsheet/chrome/collab';
import React, { Component, ReactNode, useCallback, useEffect, useState } from 'react';
import { nextSearchForActiveDoc } from './routing/active-doc-route';

const disposeSpreadsheetTestingPanel = registerSpreadsheetTestingPanel();
type DevColorScheme = 'light' | 'dark' | 'system';
type DevResolvedColorScheme = 'light' | 'dark';

function getSystemColorScheme(): DevResolvedColorScheme {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

function readInitialDevColorScheme(): DevColorScheme {
  if (typeof window === 'undefined') return 'light';
  const value = new URLSearchParams(window.location.search).get('mog-theme');
  if (value === 'dark' || value === 'system' || value === 'light') {
    persistDevColorScheme(value);
    return value;
  }
  try {
    const persisted = window.localStorage.getItem('mog-spreadsheet-display-mode');
    return persisted === 'dark' || persisted === 'system' || persisted === 'light'
      ? persisted
      : 'light';
  } catch {
    return 'light';
  }
}

function persistDevColorScheme(mode: DevColorScheme): void {
  try {
    window.localStorage.setItem('mog-spreadsheet-display-mode', mode);
  } catch {
    // Display preference persistence is best-effort and must not block the app.
  }
}

function resolveDevColorScheme(
  colorScheme: DevColorScheme,
  systemColorScheme: DevResolvedColorScheme,
): DevResolvedColorScheme {
  return colorScheme === 'system' ? systemColorScheme : colorScheme;
}

function readDevFeatureGates(): FeatureGates {
  if (typeof window === 'undefined') return {};
  const raw = new URLSearchParams(window.location.search).get('mog-feature-gates');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as FeatureGates;
    }
  } catch (err) {
    console.warn('[App] Failed to parse mog-feature-gates query parameter', err);
  }
  return {};
}

// =============================================================================
// Shell Bootstrap (runs BEFORE React)
// =============================================================================

/**
 * Shell bootstrap promise - initialized once at module load.
 * This runs BEFORE React mounts, ensuring all system events are wired up.
 */
let shellPromise: Promise<ShellBootstrapResult> | null = null;
let currentShell: ShellBootstrapResult | null = null;

/**
 * Get or create the shell bootstrap promise.
 * The shell is bootstrapped once and shared across the app.
 */
function getShellPromise(): Promise<ShellBootstrapResult> {
  if (!shellPromise) {
    console.log('[App] Starting shell bootstrap...');
    const collabUrl =
      (typeof window !== 'undefined' && (window as any).__MOG_COLLAB_URL_OVERRIDE__) ||
      (import.meta.env.VITE_MOG_COLLAB_URL as string | undefined) ||
      'ws://localhost:4100';
    // Seed collab store eagerly so CollaborateButton has the URL before React renders.
    // Use a stable session-scoped identity so different browser contexts
    // (separate tabs, incognito) get distinct user IDs — critical for collab
    // presence to work (the sidecar filters out self by participantId).
    const DEV_USER_KEY = 'mog:dev-user-id';
    let devUserId = sessionStorage.getItem(DEV_USER_KEY);
    if (!devUserId) {
      devUserId = `dev-${crypto.randomUUID().slice(0, 8)}`;
      sessionStorage.setItem(DEV_USER_KEY, devUserId);
    }
    const DEV_NAME_KEY = 'mog:dev-user-name';
    const DEV_NAMES = ['Alice', 'Bob', 'Charlie', 'Dana', 'Eve', 'Frank', 'Grace', 'Heidi'];
    let devUserName = sessionStorage.getItem(DEV_NAME_KEY);
    if (!devUserName) {
      devUserName = DEV_NAMES[Math.floor(Math.random() * DEV_NAMES.length)];
      sessionStorage.setItem(DEV_NAME_KEY, devUserName);
    }
    useCollabStore.getState().setConfig({
      baseUrl: collabUrl,
      user: { userId: devUserId, displayName: devUserName },
    });
    shellPromise = createShell({ collabUrl }).then(async (shell) => {
      // Start the event dispatcher (wires up Tauri menu listeners)
      await shell.eventDispatcher.start();
      console.log('[App] Shell bootstrap complete');
      currentShell = shell;

      // Expose shell services for devtools/testing (dev mode only)
      window.__SHELL__ = shell;

      return shell;
    });
  }
  return shellPromise;
}

// =============================================================================
// HMR Cleanup - TEST: Validate that disposing shell fixes file descriptor leak
// =============================================================================
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log('[App] HMR: Disposing shell to prevent file descriptor leak...');
    disposeSpreadsheetTestingPanel();
    // C7: Deactivate collab session before shell dispose to prevent stale sidecar refs
    useCollabStore.getState().deactivateCollabSession();
    if (currentShell) {
      currentShell.dispose();
      currentShell = null;
    }
    shellPromise = null;
  });
}

// =============================================================================
// Error Boundary
// =============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('App error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center w-screen h-screen bg-gray-100">
          <div className="flex flex-col items-center gap-4 p-8 bg-white rounded-lg shadow-md max-w-[400px] text-center">
            <div className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center text-2xl font-bold">
              !
            </div>
            <h2 className="m-0 text-lg font-semibold text-gray-900 font-sans">
              Something went wrong
            </h2>
            <p className="m-0 text-sm text-gray-500 font-sans">
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <button
              className="px-6 py-2 bg-blue-600 text-white border-none rounded font-sans text-sm font-medium cursor-pointer hover:bg-blue-700"
              onClick={this.handleRetry}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// =============================================================================
// Loading Component
// =============================================================================

function LoadingSpinner(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center w-screen h-screen bg-gray-100">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm font-sans">Loading OS...</p>
      </div>
    </div>
  );
}

// =============================================================================
// ShellHost with FileExplorer Integration
// =============================================================================

interface ShellHostWithFileExplorerProps {
  kernel: IAppKernelAPI;
  onOpenSettings: () => void;
  appearanceMode: DevColorScheme;
  onAppearanceModeChange: (mode: DevColorScheme) => void;
}

/**
 * Wrapper component that connects FileExplorer to ShellHost.
 *
 * NOTE: Menu events are handled by EventDispatcher (outside React).
 * This component just provides the FileExplorer configuration.
 */
function ShellHostWithFileExplorer({
  kernel,
  onOpenSettings,
  appearanceMode,
  onAppearanceModeChange,
}: ShellHostWithFileExplorerProps): React.JSX.Element {
  // Get file explorer configuration from the hook
  // This connects the project service, shell store, and platform
  const fileExplorerConfig = useFileExplorerConfig();
  const featureGates = React.useMemo(() => readDevFeatureGates(), []);

  // NOTE: useNativeMenu is NO LONGER used here.
  // Menu events are handled by EventDispatcher which was started
  // during shell bootstrap, BEFORE React mounted.

  return (
    <ShellHost
      kernel={kernel}
      onOpenSettings={onOpenSettings}
      showFileExplorer={true}
      fileExplorer={fileExplorerConfig}
      // Dev shell exposes all features so the app-eval corpus tests them.
      // C's surgical pageLayout exception is subsumed by this open-everything
      // approach (which landed on dev between when C branched and merge time).
      featureGates={featureGates}
      appearanceMode={appearanceMode}
      onAppearanceModeChange={onAppearanceModeChange}
    />
  );
}

// =============================================================================
// App Component
// =============================================================================

/**
 * Root App component for the OS.
 *
 * Flow:
 * 1. Wait for shell bootstrap to complete (platform, services, event dispatcher)
 * 2. Create a fallback document and kernel (for non-spreadsheet apps)
 * 3. Wire up React handlers to event dispatcher
 * 4. Render ShellHost which will render the active app
 *
 * NOTE: SpreadsheetApp handles its own document loading via useShellDocument.
 * The kernel created here is a fallback for other apps (CRM, etc.).
 *
 */
export function App(): React.JSX.Element {
  // Shell bootstrap state
  const [shell, setShell] = useState<ShellBootstrapResult | null>(null);
  const [shellLoading, setShellLoading] = useState(true);

  // Fallback document/kernel for non-spreadsheet apps
  const [fallbackHandle, setFallbackHandle] = useState<DocumentHandle | null>(null);
  const [kernelLoading, setKernelLoading] = useState(true);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bootRouteResolved, setBootRouteResolved] = useState(false);
  const [uiColorScheme, setUiColorScheme] = useState<DevColorScheme>(() =>
    readInitialDevColorScheme(),
  );
  const [systemColorScheme, setSystemColorScheme] = useState<DevResolvedColorScheme>(() =>
    getSystemColorScheme(),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemColorScheme(query.matches ? 'dark' : 'light');
    update();
    query.addEventListener?.('change', update);
    return () => {
      query.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    (window as any).__MOG_SET_COLOR_SCHEME__ = (next: DevColorScheme) => {
      if (next === 'light' || next === 'dark' || next === 'system') {
        persistDevColorScheme(next);
        setUiColorScheme(next);
      }
    };
    return () => {
      delete (window as any).__MOG_SET_COLOR_SCHEME__;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Shell Bootstrap (runs once on mount)
  // -------------------------------------------------------------------------
  useEffect(() => {
    getShellPromise().then((s) => {
      setShell(s);
      setShellLoading(false);
    });

    // Cleanup on unmount
    return () => {
      shell?.dispose();
    };
  }, []);

  // -------------------------------------------------------------------------
  // In-memory non-persistent fallback handle.
  //
  // This keeps `ShellHost.kernel` type-correct for apps rendered through the
  // shell without letting the fallback document participate in persistence.
  // A persistent fallback would call `touchDoc('os-fallback-doc')` during
  // attach and pollute `lastActiveDocId`, causing reloads to reopen the
  // fallback instead of the user's last real document.
  //
  // Keep the fallback so `ShellHost.kernel` has something to forward to
  // AppSlot. The spreadsheet app ignores its `kernel` prop entirely;
  // managed-table apps build their own per-app kernel via
  // `useAppDocument.createFreshDocument()` once the user enters the app.
  // Configure the fallback as internal so:
  //   - no IDB attach happens at boot,
  //   - no `touchDoc('os-fallback-doc')` ever fires,
  //   - the fallback never appears in `recentDocs` / `lastActiveDocId`.
  //
  // The user-visible document lifecycle is driven entirely by the URL
  // precedence effect below, not by this fallback handle.
  //
  // (Eliminating the fallback entirely is a clean follow-up — it requires
  // making `ShellHost.kernel` optional and gating AppSlot's gated-API
  // construction on a non-null kernel.)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (shellLoading) return;

    async function createFallbackDocument() {
      try {
        // Pass `internal: true` so the orchestrator skips
        // `touchDoc('os-fallback-doc')`. The boot precedence table relies
        // on `lastActiveDocId` being a user-visible doc;
        // without `internal: true`, `attachProvider` would write the
        // fallback id to meta and every refresh would reopen it instead
        // of the user's last real doc. (`providers: []` was the prior
        // attempt at the same goal, but DocumentFactory.create attaches
        // IndexedDB on browser regardless of the legacy `providers` shape;
        // `internal: true` is the correct opt-out.)
        const handle = await DocumentFactory.create({
          documentId: 'os-fallback-doc',
          internal: true,
        });
        setFallbackHandle(handle);
      } catch (err) {
        // Surface the inner cause chain — the wrapper EngineCreateError
        // hides the actual root cause (e.g. WASM init, NAPI miss, IDB
        // quota), which makes debugging this load-blocking failure
        // impossible from console alone.
        let rootCause: unknown = err;
        while (rootCause instanceof Error && rootCause.cause) {
          rootCause = rootCause.cause;
        }
        console.error(
          '[App] Failed to create fallback document:',
          err,
          '\n  Root cause:',
          rootCause,
        );
      } finally {
        setKernelLoading(false);
      }
    }

    createFallbackDocument();

    return () => {
      void fallbackHandle?.dispose().catch((err) => {
        console.error('[App] fallback dispose failed:', err);
      });
    };
  }, [shellLoading]);

  // -------------------------------------------------------------------------
  // Boot policy: URL precedence table.
  //
  //   ┌────────────────────────────────────┬────────────────────────────────┐
  //   │ URL state                          │ Action                         │
  //   ├────────────────────────────────────┼────────────────────────────────┤
  //   │ ?new                               │ create fresh doc, replaceState │
  //   │                                    │ to /?doc=<newId>               │
  //   │ ?collab=<roomId>                   │ create empty doc with collab   │
  //   │                                    │ sidecar → CRDT hydration       │
  //   │ ?doc=<id> AND id in snapshots      │ dm.createDocument(id) →        │
  //   │                                    │ kernel hydrates from IDB       │
  //   │ ?doc=<id> AND id missing/evicted   │ navigate to /, surface         │
  //   │                                    │ "doc unavailable" toast        │
  //   │ no params, lastActiveDocId exists  │ navigate to /?doc=<lastActive> │
  //   │ no params, no recent doc           │ welcome screen (no-op here)    │
  //   └────────────────────────────────────┴────────────────────────────────┘
  //
  // Precedence: ?new > ?collab=<roomId> > ?doc=<id> > lastActiveDocId > welcome.
  //
  // `lastActiveDocId` is read directly from the Meta API. Boot precedence
  // runs before the recentDocs slice has hydrated, so it cannot depend on
  // that slice.
  //
  // On any terminal state (including the error path that lands on welcome),
  // call `markBootResolutionTerminal()` so the persistence-enabled flag
  // getter can flip `__dt.persistenceEnabled` once all persistence
  // conditions hold.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!shell || shellLoading || kernelLoading) return;

    let cancelled = false;
    const finishBootRoute = (): void => {
      if (!cancelled) setBootRouteResolved(true);
    };

    async function resolveBootRoute(): Promise<void> {
      const dm = shell!.documentManager;
      const store = shell!.store;
      if (!dm || !store) {
        // No document manager / store → welcome (terminal).
        markBootResolutionTerminal();
        finishBootRoute();
        return;
      }

      const params = new URLSearchParams(window.location.search);

      // 1. ?new — highest precedence.
      if (params.has('new')) {
        const newId = `doc-${Date.now()}`;
        // Drop ?new and surface ?doc=<newId> so refresh re-hydrates instead
        // of minting another blank doc.
        params.delete('new');
        params.set('doc', newId);
        window.history.replaceState({}, '', `?${params.toString()}`);

        // The boot decision is made here — we're
        // committed to the `?new` branch. `__dt.persistenceEnabled` should
        // flip as soon as the decision is final, not gated on hydration
        // (which can take arbitrarily long for large docs and would leave
        // the persistence path looking offline mid-load).
        markBootResolutionTerminal();

        try {
          await dm.createDocument(newId, {
            documentId: newId,
            operation: 'create',
          });
          if (cancelled) return;
          store.getState().addOpenFileId(newId);
          store.getState().setActiveFileId(newId);
        } catch (err) {
          console.error('[App] ?new boot path failed:', err);
        } finally {
          finishBootRoute();
        }
        return;
      }

      // 1b. ?collab=<roomId> — join a collab session via invite link.
      // The document manager opens the host-backed room state and sidecar
      // atomically before the workbook is published to shell/app UI.
      const collabParam = params.get('collab');
      if (collabParam) {
        markBootResolutionTerminal();

        const collabUrl = useCollabStore.getState().config?.baseUrl ?? null;
        if (!collabUrl) {
          console.error('[App] ?collab boot path: no collabUrl configured');
          finishBootRoute();
          return;
        }

        const participantId = useCollabStore.getState().config?.user.userId ?? crypto.randomUUID();
        console.log(
          `[App] ?collab boot path: joining room=${collabParam} collabUrl=${collabUrl} participantId=${participantId}`,
        );

        try {
          await dm.createCollaborationDocument(collabParam, {
            documentId: collabParam,
            baseUrl: collabUrl,
            roomId: collabParam,
            participantId,
          });
          if (cancelled) return;

          store.getState().addOpenFileId(collabParam);
          store.getState().setActiveFileId(collabParam);

          // Activate UI subscriptions after shell owns the room-backed sidecar.
          const sidecar = dm.getSidecar(collabParam);
          if (sidecar) {
            useCollabStore.getState().activateCollabSession(sidecar as any, collabParam);
          }
        } catch (err) {
          console.error('[App] ?collab boot path failed:', err);
        } finally {
          finishBootRoute();
        }
        return;
      }

      // 2. ?doc=<id> — hydrate if id has a persisted snapshot.
      const docParam = params.get('doc');
      if (docParam) {
        let exists = false;
        try {
          exists = await hasPersistedSnapshot(docParam);
        } catch (err) {
          console.warn('[App] hasPersistedSnapshot failed; treating as missing:', err);
        }
        if (cancelled) return;

        // Decision is final here — we know whether to hydrate or surface
        // the missing-doc toast. Mark terminal before the hydration await
        // so a long/hung hydration doesn't keep `persistenceEnabled` false.
        markBootResolutionTerminal();

        if (exists) {
          try {
            await dm.createDocument(docParam, {
              documentId: docParam,
              operation: 'open',
            });
            if (cancelled) return;
            store.getState().addOpenFileId(docParam);
            store.getState().setActiveFileId(docParam);
          } catch (err) {
            console.error('[App] ?doc hydration failed:', err);
          } finally {
            finishBootRoute();
          }
        } else {
          // 2b. ?doc=<id> AND id missing/evicted — bounce to root with a
          // toast hint. Use ?missing-doc=<id> as the one-shot signal so a
          // refresh-loop is impossible (the WelcomeScreen reads-and-clears
          // it on first paint).
          params.delete('doc');
          params.set('missing-doc', docParam);
          window.history.replaceState({}, '', `?${params.toString()}`);
          finishBootRoute();
        }
        return;
      }

      // 3. No params — try lastActiveDocId from Meta API.
      let lastActiveDocId: string | null = null;
      try {
        const meta = await readMeta();
        lastActiveDocId = meta.lastActiveDocId;
      } catch (err) {
        console.warn('[App] readMeta failed; falling back to welcome:', err);
      }
      if (cancelled) return;

      if (lastActiveDocId) {
        // Verify the snapshot is still present (covers the foreign-DB and
        // mid-eviction edge cases). If it's gone, fall through to welcome.
        let exists = false;
        try {
          exists = await hasPersistedSnapshot(lastActiveDocId);
        } catch {
          exists = false;
        }
        if (cancelled) return;

        if (exists) {
          params.set('doc', lastActiveDocId);
          window.history.replaceState({}, '', `?${params.toString()}`);
          // Decision is final — we're hydrating `lastActiveDocId`. Mark
          // terminal before the await so a corrupt/incompatible snapshot
          // (e.g. a quota-exceeded scenario seeds a fake `0xa1` byte
          // under a synthetic docId) doesn't hang the persistence-flag
          // flip on a hydration that may never complete.
          markBootResolutionTerminal();
          try {
            await dm.createDocument(lastActiveDocId, {
              documentId: lastActiveDocId,
              operation: 'open',
            });
            if (cancelled) return;
            store.getState().addOpenFileId(lastActiveDocId);
            store.getState().setActiveFileId(lastActiveDocId);
          } catch (err) {
            console.error('[App] lastActiveDocId hydration failed:', err);
          } finally {
            finishBootRoute();
          }
          return;
        }
      }

      // 4. No recent doc → welcome (terminal).
      markBootResolutionTerminal();
      finishBootRoute();
    }

    resolveBootRoute();

    return () => {
      cancelled = true;
    };
  }, [shell, shellLoading, kernelLoading]);

  // -------------------------------------------------------------------------
  // Active-document route sync. Boot may resolve from `?new`, `?doc`, or
  // Meta. After that, the host app mirrors shell active-file state into
  // the URL. Document lifecycle actions never write history directly.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!shell || !bootRouteResolved) return;

    const syncRoute = (activeFileId: string | null): void => {
      const mode = activeFileId ? shell.documentManager.getDocumentMode(activeFileId) : null;
      const nextSearch = nextSearchForActiveDoc(window.location.search, activeFileId, mode);
      if (nextSearch === window.location.search) return;
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${nextSearch}${window.location.hash}`,
      );
    };

    syncRoute(shell.store.getState().activeFileId);
    return shell.store.subscribe((state, prevState) => {
      if (state.activeFileId !== prevState.activeFileId) {
        syncRoute(state.activeFileId);
      }
    });
  }, [shell, bootRouteResolved]);

  // Collaboration UI subscriptions follow the active shell document. The
  // document manager owns the WebSocket transport; the store only mirrors UI
  // status/presence for the active room-backed document.
  useEffect(() => {
    if (!shell || !bootRouteResolved) return;

    const syncCollabUi = (activeFileId: string | null): void => {
      if (!activeFileId) {
        useCollabStore.getState().deactivateCollabSession();
        return;
      }
      const mode = shell.documentManager.getDocumentMode(activeFileId);
      if (mode?.kind !== 'collaboration') {
        useCollabStore.getState().deactivateCollabSession();
        return;
      }
      const sidecar = shell.documentManager.getSidecar(activeFileId);
      if (!sidecar) {
        useCollabStore.getState().deactivateCollabSession();
        return;
      }
      const current = useCollabStore.getState();
      if (current.sidecar === sidecar && current.roomId === mode.roomId) return;
      useCollabStore.getState().activateCollabSession(sidecar as any, mode.roomId);
    };

    syncCollabUi(shell.store.getState().activeFileId);
    return shell.store.subscribe((state, prevState) => {
      if (state.activeFileId !== prevState.activeFileId) {
        syncCollabUi(state.activeFileId);
      }
    });
  }, [shell, bootRouteResolved]);

  // -------------------------------------------------------------------------
  // Wire up React handlers to event dispatcher
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (shell) {
      shell.eventDispatcher.setHandlers({
        onOpenSettings: () => setSettingsOpen(true),
      });
    }
  }, [shell]);

  // -------------------------------------------------------------------------
  // Settings handler (passed to ShellHost)
  // -------------------------------------------------------------------------
  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);
  const handleAppearanceModeChange = useCallback((mode: DevColorScheme) => {
    setUiColorScheme(mode);
    persistDevColorScheme(mode);
  }, []);

  // -------------------------------------------------------------------------
  // Create IAppKernelAPI from fallback document
  // -------------------------------------------------------------------------
  const [appKernelAPI, setAppKernelAPI] = useState<IAppKernelAPI | null>(null);
  useEffect(() => {
    if (!fallbackHandle) return;
    let cancelled = false;
    fallbackHandle.workbook().then((workbook) => {
      if (!cancelled) {
        setAppKernelAPI(createAppKernelAPIFromHandle(fallbackHandle, workbook));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fallbackHandle]);

  // -------------------------------------------------------------------------
  // Debug logging
  // -------------------------------------------------------------------------
  console.log('[App] State:', {
    shellLoading,
    shell: !!shell,
    kernelLoading,
    appKernelAPI: !!appKernelAPI,
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const resolvedUiColorScheme = resolveDevColorScheme(uiColorScheme, systemColorScheme);
  const themeAttributes = {
    'data-mog-color-scheme': resolvedUiColorScheme,
    'data-mog-ui-color-scheme': uiColorScheme,
    'data-mog-ui-resolved-color-scheme': resolvedUiColorScheme,
    'data-mog-canvas-color-scheme': 'light',
    'data-mog-canvas-resolved-color-scheme': 'light',
  } as const;

  // Shell or kernel loading state
  if (shellLoading || !shell || kernelLoading || !appKernelAPI) {
    return (
      <div data-mog-color-scheme={resolvedUiColorScheme}>
        <LoadingSpinner />
      </div>
    );
  }

  // Ready - render OS with shell architecture:
  // CapabilityProvider provides the capability registry to all components
  // ShellProvider receives pre-created shell (store, platform, services)
  // ShellHost renders the active app based on ShellStore.activeAppId
  // SpreadsheetApp handles its own document loading via useShellDocument
  // Other apps use the fallback kernel passed here
  // Menu events are handled by EventDispatcher (outside React).
  // React just observes state changes via store subscriptions.
  return (
    <CapabilityProvider registry={shell.capabilityRegistry}>
      <ShellProvider shell={shell}>
        <ErrorBoundary>
          <div className="h-screen w-screen" data-mog-engine="" {...themeAttributes}>
            <PortalContainerProvider>
              <ShellHostWithFileExplorer
                kernel={appKernelAPI}
                onOpenSettings={handleOpenSettings}
                appearanceMode={uiColorScheme}
                onAppearanceModeChange={handleAppearanceModeChange}
              />
              <SettingsDialog
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                appearanceMode={uiColorScheme}
                onAppearanceModeChange={handleAppearanceModeChange}
              />
            </PortalContainerProvider>
          </div>
        </ErrorBoundary>
      </ShellProvider>
    </CapabilityProvider>
  );
}

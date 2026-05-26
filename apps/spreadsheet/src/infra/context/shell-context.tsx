/**
 * Shell Context
 *
 * Provides access to shell-level (app-wide) state.
 * This context is created ONCE at app startup and wraps the entire application.
 *
 * Shell-level state includes:
 * - View navigation (activeViewId, viewSwitcherOpen)
 * - Record detail sidebar (works across views)
 * - Project folder state (projectPath, fileTree, openFiles)
 *
 * Architecture (OS Pattern - NEW):
 * ```
 * App
 * └─ Shell Bootstrap (runs BEFORE React mounts)
 * ├─ Creates store
 * ├─ Initializes platform
 * ├─ Creates services
 * └─ Starts event dispatcher
 * └─ ShellProvider (receives pre-created shell)
 * ├─ ShellStoreContext (pre-created store)
 * ├─ PlatformProvider (pre-created platform)
 * ├─ ProjectServiceProvider (pre-created service)
 * └─ DocumentProvider (per document)
 * └─ SpreadsheetContent
 * ```
 *
 * Key principle: Shell is bootstrapped BEFORE React mounts, eliminating
 * race conditions between React's render cycle and system events.
 *
 */

import React, { createContext, useContext, useMemo } from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';

import {
  createShellStore,
  DocumentManagerProvider,
  PlatformIdentityProvider,
  PlatformProvider,
  ProjectServiceProvider,
  ShellServiceProvider,
  ShellStoreContext,
  type ShellBootstrapResult,
  type ShellUIState,
} from '@mog/shell';
import type { IPlatform } from '@mog-sdk/contracts/platform';

// =============================================================================
// Context Types
// =============================================================================

interface ShellContextValue {
  /** Shell UI store instance (app-wide state) */
  shellStore: StoreApi<ShellUIState>;
}

// =============================================================================
// Context Definition
// =============================================================================

const ShellContext = createContext<ShellContextValue | null>(null);

// =============================================================================
// Provider Component
// =============================================================================

interface ShellProviderProps {
  children: React.ReactNode;
  /**
   * Pre-created shell from bootstrap (PREFERRED).
   * Use this for the new architecture where shell is bootstrapped before React.
   */
  shell?: ShellBootstrapResult;
  /**
   * Optional platform instance (LEGACY, for backwards compatibility).
   * If provided without shell, creates store internally.
   * @deprecated Use shell prop instead
   */
  platform?: IPlatform;
}

/**
 * Shell provider that provides shell-level state to the application.
 *
 * NEW PATTERN (recommended):
 * - Pass `shell` prop from createShell() bootstrap
 * - Shell is bootstrapped BEFORE React mounts
 * - No async initialization inside React
 *
 * LEGACY PATTERN (backwards compatible):
 * - Pass `platform` prop directly
 * - Store is created inside this component
 * - Has race condition risks with system events
 *
 * @example
 * ```tsx
 * // NEW PATTERN (recommended)
 * const shell = await createShell();
 * await shell.eventDispatcher.start();
 * <ShellProvider shell={shell}>...</ShellProvider>
 *
 * // LEGACY PATTERN (backwards compatible)
 * <ShellProvider platform={platform}>...</ShellProvider>
 * ```
 */
export function ShellProvider({ children, shell, platform }: ShellProviderProps) {
  // Get or create the store
  const value = useMemo(() => {
    if (shell) {
      // NEW: Use pre-created store from bootstrap
      return { shellStore: shell.store };
    }
    // LEGACY: Create store internally
    const shellStore = createShellStore();
    return { shellStore };
  }, [shell]);

  // Get platform (from shell or prop)
  const effectivePlatform = shell?.platform ?? platform ?? null;

  // Build the provider hierarchy
  let content: React.ReactNode = (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );

  // Wrap with DocumentManager if available (from shell bootstrap)
  // DocumentManager survives React remounts and owns document lifecycle
  if (shell?.documentManager) {
    content = (
      <DocumentManagerProvider documentManager={shell.documentManager}>
        {content}
      </DocumentManagerProvider>
    );
  }

  // Wrap with platform and project service if platform is available
  // For bootstrap pattern, ProjectServiceProvider will use the pre-created service
  // For legacy pattern, it creates the service internally.
  //
  // when the bootstrap exposes a `shellService`
  // (typed facade — see shell/src/services/shell-service.ts), wrap content
  // with ShellServiceProvider so action handlers can resolve it via
  // `useShellService()` (used by `useActionDependencies` to populate
  // `deps.shellService`).
  if (effectivePlatform) {
    content = (
      <PlatformProvider platform={effectivePlatform}>
        <ProjectServiceProvider projectService={shell?.projectService}>
          {shell?.shellService ? (
            <ShellServiceProvider shellService={shell.shellService}>{content}</ShellServiceProvider>
          ) : (
            content
          )}
        </ProjectServiceProvider>
      </PlatformProvider>
    );
  }

  // Wrap with PlatformIdentity if available (from shell bootstrap)
  if (shell?.platformIdentity) {
    content = (
      <PlatformIdentityProvider value={shell.platformIdentity}>{content}</PlatformIdentityProvider>
    );
  }

  // Always wrap with ShellStoreContext at the outermost level
  return (
    <ShellStoreContext.Provider value={value.shellStore}>{content}</ShellStoreContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access shell context (low-level, prefer specific hooks).
 * @throws Error if used outside ShellProvider
 */
function useShellContext(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error('useShellContext must be used within ShellProvider');
  }
  return context;
}

/**
 * Access shell UI store with a selector.
 * This is the primary hook for accessing shell-level UI state.
 *
 * @example
 * ```tsx
 * const activeViewId = useShellStore(s => s.activeViewId);
 * const setActiveViewId = useShellStore(s => s.setActiveViewId);
 * ```
 */
export function useShellStore<T>(selector: (state: ShellUIState) => T): T {
  const { shellStore } = useShellContext();
  return useStore(shellStore, selector);
}

/**
 * Get the raw shell store API (for non-React usage).
 * Prefer useShellStore for React components.
 */
export function useShellStoreApi(): StoreApi<ShellUIState> {
  const { shellStore } = useShellContext();
  return shellStore;
}

// =============================================================================
// Convenience Hooks
// =============================================================================

/**
 * Get the active view ID.
 * @example const viewId = useActiveViewId(); // 'grid' | 'kanban' | etc.
 */
export function useActiveViewId(): string {
  return useShellStore((s) => s.activeViewId);
}

/**
 * Get the setActiveViewId action.
 * @example const setView = useSetActiveViewId(); setView('kanban');
 */
export function useSetActiveViewId(): (viewId: string) => void {
  return useShellStore((s) => s.setActiveViewId);
}

/**
 * Check if record detail sidebar is open.
 */
export function useIsRecordDetailOpen(): boolean {
  return useShellStore((s) => s.recordDetail !== null);
}

/**
 * Get record detail actions.
 */
export function useRecordDetailActions() {
  const openRecordDetail = useShellStore((s) => s.openRecordDetail);
  const closeRecordDetail = useShellStore((s) => s.closeRecordDetail);
  return { openRecordDetail, closeRecordDetail };
}

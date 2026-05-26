/**
 * AppSlot - Render slot for active app with error isolation and capability gating
 *
 * Renders the active app wrapped in Suspense and ErrorBoundary for:
 * - Capability consent flow (launchApp)
 * - Lazy loading (Suspense)
 * - Crash isolation (ErrorBoundary)
 *
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';

import { createCapabilityGatedApi, createUngatedAdapter } from '@mog-sdk/kernel/app-api';
import type {
  AppManifest,
  AppTableInfo,
  IAppKernelAPI,
  ResolvedBindings,
} from '@mog-sdk/contracts/apps';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import type {
  AppId,
  AppManifestWithCapabilities,
  IGatedAppKernelAPI,
} from '@mog-sdk/contracts/capabilities';
import { launchApp, type ConsentRequest, type ConsentResult } from '../app-launcher/launch-app';
import type { AppAppearanceMode } from '../apps/types';
import { useCapabilityContextOptional } from '../context/capability-context';
import { APP_MANIFESTS } from './app-registry';
import { AppBindingEditor } from './AppBindingEditor';
import { AppCrashedState } from './AppCrashedState';
import { AppLoader } from './AppLoader';
import { AppLoading } from './AppLoading';
import { AppSetupDialog } from './AppSetupDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { useAppDocument } from './hooks/useAppDocument';
import { useAppInstanceSetup } from './hooks/useAppInstanceSetup';

export interface AppSlotProps {
  /** App Kernel API instance (full, ungated) */
  kernel: IAppKernelAPI;

  /** Active app ID to render (null = no app selected) */
  appId: string | null;

  /**
   * Custom loading fallback rendered while the app is launching.
   * When provided, replaces the default AppLoading spinner in both
   * the launch-state gate and the Suspense boundary so there is a
   * single, continuous loading visual instead of two sequential ones.
   */
  loadingFallback?: React.ReactNode;

  /**
   * Feature gates config passed through to the app component.
   */
  featureGates?: FeatureGates;

  /** Host-owned app chrome appearance mode. */
  appearanceMode?: AppAppearanceMode;

  /** Called when the active app changes the host-owned appearance mode. */
  onAppearanceModeChange?: (mode: AppAppearanceMode) => void;
}

// =============================================================================
// Launch State Types
// =============================================================================

type LaunchState =
  | { status: 'idle' }
  | { status: 'setup' } // Waiting for app instance setup
  | { status: 'launching' }
  | { status: 'success'; gatedApi: IGatedAppKernelAPI; bindings: ResolvedBindings | null }
  | { status: 'denied'; deniedCapabilities: string[]; error: string }
  | { status: 'error'; error: string };

// =============================================================================
// State Components
// =============================================================================

/**
 * NoAppSelected - Placeholder when no app is active
 */
function NoAppSelected(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 font-sans">
      <p className="text-base mb-2 mt-0">No app selected</p>
      <p className="text-[13px] m-0 opacity-70">Select an app from the sidebar to get started</p>
    </div>
  );
}

/**
 * PermissionDenied - Shown when user denies required capabilities
 */
function PermissionDenied({
  appId,
  deniedCapabilities,
  onRetry,
}: {
  appId: string;
  deniedCapabilities: string[];
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 font-sans p-8">
      <div className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center text-2xl font-bold mb-4">
        !
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2 mt-0">Permission Required</h2>
      <p className="text-sm text-gray-500 mb-4 mt-0 text-center max-w-[400px]">
        The app "{appId}" requires permissions that were denied.
        <br />
        <br />
        <strong>Missing permissions:</strong> {deniedCapabilities.join(', ')}
      </p>
      <button
        className="py-2 px-6 bg-blue-600 text-white border-none rounded font-medium text-sm cursor-pointer"
        onClick={onRetry}
      >
        Try Again
      </button>
    </div>
  );
}

// =============================================================================
// AppSlot Component
// =============================================================================

/**
 * AppSlot - Renders the active app with capability gating, error boundaries, and suspense
 *
 * Architecture:
 * 1. If no app selected, shows placeholder
 * 2. Launches app via launchApp() which handles:
 *    - First-party auto-grant
 *    - Consent dialog for missing capabilities
 *    - Gated API construction
 * 3. ErrorBoundary catches app crashes
 * 4. Suspense handles lazy loading
 * 5. AppLoader renders the actual app component
 *
 * Key: Changes to appId force remount, isolating state between apps
 */
export const AppSlot = React.memo(function AppSlot({
  kernel,
  appId,
  loadingFallback,
  featureGates,
  appearanceMode,
  onAppearanceModeChange,
}: AppSlotProps): React.JSX.Element {
  const [launchState, setLaunchState] = useState<LaunchState>({ status: 'idle' });
  const [bindingEditorTables, setBindingEditorTables] = useState<AppTableInfo[]>([]);
  const capabilityContext = useCapabilityContextOptional();

  // Check if app needs setup (has managedTables)
  const manifest = appId ? ((APP_MANIFESTS[appId] as AppManifest | undefined) ?? null) : null;
  const needsSetup = !!manifest?.managedTables?.length;

  // For apps with managedTables, use app-specific document
  const appDocument = useAppDocument({
    appId: appId ?? '',
    enabled: needsSetup && !!appId,
  });

  // Use app instance setup hook for apps with managedTables
  // Pass the app-specific kernel (or the shared kernel for apps without managedTables)
  const setupResult = useAppInstanceSetup({
    appId: appId ?? '',
    manifest: manifest,
    kernel: needsSetup ? appDocument.kernel : kernel, // App-specific kernel for apps with managedTables
    enabled: needsSetup && !!appId,
    createFreshDocument: needsSetup ? appDocument.createFreshDocument : undefined,
  });

  // Create the gated API factory
  const createGatedApi = useCallback(
    (
      targetAppId: AppId,
      _capabilities: readonly string[],
      options?: { managedTableIds?: ReadonlySet<string> },
    ) => {
      if (!capabilityContext) {
        // If no capability context, return the full API as gated
        // This allows the app to work without the capability system.
        // IAppKernelAPI is structurally compatible with the data sub-APIs
        // of IGatedAppKernelAPI, but lacks capabilities introspection.
        // We construct a minimal gated wrapper with a stub capabilities object.
        console.warn('[AppSlot] No capability context, using ungated kernel API');
        return createUngatedAdapter(kernel);
      }

      return createCapabilityGatedApi({
        appId: targetAppId,
        fullApi: kernel,
        registry: capabilityContext.registry,
        managedTableIds: options?.managedTableIds,
      });
    },
    [kernel, capabilityContext],
  );

  // Show consent dialog via context
  const showConsentDialog = useCallback(
    async (request: ConsentRequest): Promise<ConsentResult> => {
      if (!capabilityContext) {
        // No context, auto-allow (legacy mode)
        // Return undefined for grantedCapabilities - launchApp will use the requested caps
        console.warn('[AppSlot] No capability context, auto-allowing capabilities');
        return {
          decision: 'allow',
          // Don't specify grantedCapabilities - let launchApp use the default (needsConsent)
        };
      }

      return capabilityContext.showConsentDialog(request);
    },
    [capabilityContext],
  );

  // Launch the app
  const doLaunch = useCallback(
    async (managedTableIds?: ReadonlySet<string>, bindings?: ResolvedBindings | null) => {
      if (!appId) return;

      setLaunchState({ status: 'launching' });

      // Get the manifest
      const manifest = APP_MANIFESTS[appId] as AppManifestWithCapabilities | undefined;
      if (!manifest) {
        setLaunchState({
          status: 'error',
          error: `App manifest not found: ${appId}`,
        });
        return;
      }

      // Check if manifest has capabilities
      if (!manifest.capabilities) {
        // Legacy app without capabilities - wrap full kernel as ungated
        console.log('[AppSlot] Legacy app without capabilities, using ungated adapter');
        setLaunchState({
          status: 'success',
          gatedApi: createUngatedAdapter(kernel),
          bindings: bindings ?? null,
        });
        return;
      }

      // If no capability registry, use full kernel (legacy mode)
      if (!capabilityContext) {
        console.warn('[AppSlot] No capability registry, using ungated adapter');
        setLaunchState({
          status: 'success',
          gatedApi: createUngatedAdapter(kernel),
          bindings: bindings ?? null,
        });
        return;
      }

      try {
        const result = await launchApp({
          appManifest: manifest,
          registry: capabilityContext.registry,
          showConsentDialog,
          createGatedApi: (targetAppId, capabilities) => {
            return createGatedApi(targetAppId, capabilities, { managedTableIds });
          },
          autoGrantFirstParty: true,
        });

        if (result.success && result.gatedApi) {
          console.log('[AppSlot] App launched successfully:', appId);
          setLaunchState({
            status: 'success',
            gatedApi: result.gatedApi,
            bindings: bindings ?? null,
          });
        } else if (result.deniedCapabilities && result.deniedCapabilities.length > 0) {
          // Permission was explicitly denied by user
          console.log('[AppSlot] App launch denied:', appId, result.deniedCapabilities);
          setLaunchState({
            status: 'denied',
            deniedCapabilities: result.deniedCapabilities,
            error: result.error ?? 'Permission denied',
          });
        } else {
          // Other launch failure (table setup, etc.) - treat as error, not permission denial
          console.error('[AppSlot] App launch failed:', appId, result.error);
          setLaunchState({
            status: 'error',
            error: result.error ?? 'App failed to launch',
          });
        }
      } catch (err) {
        console.error('[AppSlot] App launch error:', err);
        setLaunchState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [appId, kernel, capabilityContext, showConsentDialog, createGatedApi],
  );

  // Load tables when entering binding editor
  useEffect(() => {
    if (needsSetup && setupResult.state.status === 'binding-editor') {
      kernel.tables.list().then(setBindingEditorTables);
    }
  }, [needsSetup, setupResult.state.status, kernel]);

  // Launch when appId changes or when setup is ready
  useEffect(() => {
    if (!appId) {
      setLaunchState({ status: 'idle' });
      return;
    }

    // If app needs setup, wait for setup to complete
    if (needsSetup) {
      if (setupResult.state.status === 'ready') {
        // Setup complete - launch with managed table IDs and bindings
        const managedTableIds = setupResult.state.managedTableIds;
        const bindings = setupResult.state.bindings;
        console.log('[AppSlot] Setup ready, launching with managedTableIds:', managedTableIds);
        doLaunch(managedTableIds, bindings);
      } else if (
        setupResult.state.status === 'setup-dialog' ||
        setupResult.state.status === 'binding-editor' ||
        setupResult.state.status === 'checking'
      ) {
        // Setup in progress - show setup state
        setLaunchState({ status: 'setup' });
      } else if (setupResult.state.status === 'cancelled') {
        // Setup cancelled - show idle/no app
        setLaunchState({ status: 'idle' });
      } else if (setupResult.state.status === 'error') {
        // Setup error
        setLaunchState({
          status: 'error',
          error: setupResult.state.error,
        });
      }
    } else {
      // No setup needed - launch immediately
      doLaunch();
    }
  }, [appId, needsSetup, setupResult.state, doLaunch]);

  // Render based on state
  console.log('[AppSlot] Rendering with appId:', appId, 'state:', launchState.status);

  if (!appId) {
    return <NoAppSelected />;
  }

  // Render setup dialogs if needed
  if (needsSetup) {
    if (setupResult.state.status === 'setup-dialog') {
      return (
        <AppSetupDialog
          open={true}
          onClose={setupResult.cancel}
          manifest={manifest!}
          onStartFresh={setupResult.startFresh}
          onUseExisting={setupResult.useExisting}
        />
      );
    }

    if (setupResult.state.status === 'binding-editor') {
      return (
        <AppBindingEditor
          open={true}
          onClose={setupResult.cancel}
          manifest={manifest!}
          tables={bindingEditorTables}
          onComplete={setupResult.completeBinding}
        />
      );
    }

    if (setupResult.state.status === 'cancelled') {
      return <NoAppSelected />;
    }
  }

  if (
    launchState.status === 'idle' ||
    launchState.status === 'launching' ||
    launchState.status === 'setup' ||
    (needsSetup && appDocument.loading)
  ) {
    return <>{loadingFallback ?? <AppLoading appId={appId} />}</>;
  }

  if (launchState.status === 'denied') {
    return (
      <PermissionDenied
        appId={appId}
        deniedCapabilities={launchState.deniedCapabilities}
        onRetry={() => doLaunch()}
      />
    );
  }

  if (launchState.status === 'error' || (needsSetup && appDocument.error)) {
    const errorMessage = launchState.status === 'error' ? launchState.error : appDocument.error!;
    return (
      <AppCrashedState appId={appId} error={new Error(errorMessage)} onRetry={() => doLaunch()} />
    );
  }

  // Success - render the app with gated API
  // Wrapper provides normalized sizing contract (flex + explicit height)
  // so apps can safely use either `height: 100%` or `flex: 1`
  return (
    <div className="flex flex-col flex-1 min-h-0 w-full h-full">
      <React.Profiler
        id="app-root"
        onRender={(id, phase, actualDuration, baseDuration) => {
          window.__OS_DEVTOOLS__?.reportRender?.(
            appId ?? 'unknown',
            id,
            phase,
            actualDuration,
            baseDuration,
          );
        }}
      >
        <ErrorBoundary
          key={appId} // Force remount on app change to reset error state
          fallback={(error, reset) => (
            <AppCrashedState appId={appId} error={error} onRetry={reset} />
          )}
        >
          <Suspense fallback={loadingFallback ?? <AppLoading appId={appId} />}>
            <AppLoader
              kernel={launchState.gatedApi}
              appId={appId}
              bindings={launchState.bindings}
              featureGates={featureGates}
              appearanceMode={appearanceMode}
              onAppearanceModeChange={onAppearanceModeChange}
            />
          </Suspense>
        </ErrorBoundary>
      </React.Profiler>
    </div>
  );
});

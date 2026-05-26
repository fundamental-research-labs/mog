/**
 * AppLoader - Loads and renders an app component
 *
 * This is a simple component that:
 * 1. Loads the app component via useAppComponent
 * 2. Gets the app manifest
 * 3. Renders the app with kernel, manifest, and bindings
 *
 * All setup (instance creation, table creation) happens in AppSlot
 * BEFORE this component is rendered.
 *
 */

import React from 'react';

import type { ResolvedBindings } from '@mog-sdk/contracts/apps';
import type { IGatedAppKernelAPI } from '@mog-sdk/contracts/capabilities';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import type { AppAppearanceMode } from '../apps/types';
import { useAppComponent } from './hooks/useAppComponent';
import { useAppManifest } from './hooks/useAppManifests';

// =============================================================================
// Types
// =============================================================================

export interface AppLoaderProps {
  /** App Kernel API instance (capability-gated) */
  kernel: IGatedAppKernelAPI;

  /** App ID to load */
  appId: string;

  /**
   * Pre-resolved bindings from AppSlot (null for apps without managedTables).
   * Optional during transition period - will be required once the migration is complete.
   */
  bindings?: ResolvedBindings | null;

  /** Feature gates config passed through to the app component */
  featureGates?: FeatureGates;

  /** Host-owned app chrome appearance mode. */
  appearanceMode?: AppAppearanceMode;

  /** Called when the active app changes the host-owned appearance mode. */
  onAppearanceModeChange?: (mode: AppAppearanceMode) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * AppLoader - Loads and renders an app
 *
 * This component is intentionally simple - all setup logic lives in AppSlot.
 * AppLoader just loads the component and renders it with the provided props.
 *
 * Wrapped in React.memo to prevent unnecessary re-renders when parent re-renders
 * but props (kernel, appId, bindings) haven't changed.
 */
export const AppLoader = React.memo(function AppLoader({
  kernel,
  appId,
  bindings = null,
  featureGates,
  appearanceMode,
  onAppearanceModeChange,
}: AppLoaderProps) {
  console.log('[AppLoader] Loading app:', appId, 'bindings:', bindings ? 'provided' : 'null');

  // Load app component and manifest
  const AppComponent = useAppComponent(appId);
  const manifest = useAppManifest(appId);

  // App not found in registry
  if (!AppComponent || !manifest) {
    return (
      <div className="app-loader-error">
        <h2>App not found</h2>
        <p>
          The app <strong>{appId}</strong> could not be found.
        </p>
        <p className="app-loader-error__hint">
          Make sure the app exists in <code>shell/src/apps/{appId}/</code>
        </p>
      </div>
    );
  }

  // Render the app component
  return (
    <AppComponent
      kernel={kernel}
      manifest={manifest}
      bindings={bindings ?? undefined}
      featureGates={featureGates}
      appearanceMode={appearanceMode}
      onAppearanceModeChange={onAppearanceModeChange}
    />
  );
});

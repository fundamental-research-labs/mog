/**
 * useAppKernel - Hook for accessing capability-gated kernel API
 *
 * Features:
 * - Returns gated API for the app
 * - HOT-RELOADS when capabilities change
 * - Apps don't need to reload when user grants/revokes
 *
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { appId as createAppId } from '@mog-sdk/kernel/security';
import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { AppId, CapabilityType, IGatedAppKernelAPI } from '@mog-sdk/contracts/capabilities';

import { createCapabilityGatedApi } from '@mog-sdk/kernel/app-api';
import type { ICapabilityRegistry, RegistryEvent } from '@mog-sdk/kernel/security';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for useAppKernel hook.
 */
export interface UseAppKernelDeps {
  /** The app ID */
  appId: string;
  /** The full kernel API */
  fullApi: IAppKernelAPI;
  /** The capability registry */
  registry: ICapabilityRegistry;
  /** Optional: domain allowlist for network capabilities */
  domainAllowlist?: readonly string[];
}

/**
 * Result of useAppKernel hook.
 */
export interface UseAppKernelResult {
  /** The gated API (null if not ready) */
  api: IGatedAppKernelAPI | null;
  /** Current effective capabilities */
  capabilities: readonly CapabilityType[];
  /** Whether capabilities are loading/updating */
  isUpdating: boolean;
  /** Force a refresh of the gated API */
  refresh: () => void;
}

// =============================================================================
// Internal State Manager
// =============================================================================

/**
 * Manages subscription to capability changes for a specific app.
 */
class AppKernelState {
  private readonly appId: AppId;
  private readonly registry: ICapabilityRegistry;
  private readonly fullApi: IAppKernelAPI;
  private readonly domainAllowlist: readonly string[];
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private gatedApi: IGatedAppKernelAPI | null = null;
  private capabilities: CapabilityType[] = [];
  private version = 0;

  constructor(
    appId: AppId,
    fullApi: IAppKernelAPI,
    registry: ICapabilityRegistry,
    domainAllowlist: readonly string[] = [],
  ) {
    this.appId = appId;
    this.fullApi = fullApi;
    this.registry = registry;
    this.domainAllowlist = domainAllowlist;

    // Initial build
    this.rebuildGatedApi();

    // Subscribe to changes
    this.unsubscribe = this.subscribeToChanges();
  }

  /**
   * Subscribe to registry events for this app.
   */
  private subscribeToChanges(): () => void {
    const handleGranted = (event: RegistryEvent) => {
      if (event.appId === this.appId) {
        this.rebuildGatedApi();
        this.notifyListeners();
      }
    };

    const handleRevoked = (event: RegistryEvent) => {
      if (event.appId === this.appId) {
        this.rebuildGatedApi();
        this.notifyListeners();
      }
    };

    const subGrant = this.registry.on('capability:granted', handleGranted);
    const subRevoke = this.registry.on('capability:revoked', handleRevoked);

    return () => {
      subGrant.dispose();
      subRevoke.dispose();
    };
  }

  /**
   * Rebuild the gated API with current capabilities.
   */
  private rebuildGatedApi(): void {
    this.capabilities = this.registry.getEffectiveCapabilities(this.appId);

    this.gatedApi = createCapabilityGatedApi({
      appId: this.appId,
      registry: this.registry,
      fullApi: this.fullApi,
      allowedDomains: this.domainAllowlist,
    });

    this.version++;
  }

  /**
   * Notify all listeners of a change.
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Get the current gated API.
   */
  getGatedApi(): IGatedAppKernelAPI | null {
    return this.gatedApi;
  }

  /**
   * Get current capabilities.
   */
  getCapabilities(): readonly CapabilityType[] {
    return this.capabilities;
  }

  /**
   * Get snapshot version for useSyncExternalStore.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Subscribe to changes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Force a refresh.
   */
  refresh(): void {
    this.rebuildGatedApi();
    this.notifyListeners();
  }

  /**
   * Cleanup.
   */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners.clear();
    this.gatedApi = null;
  }
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for accessing capability-gated kernel API.
 *
 * Features:
 * - Returns gated API scoped to the app's capabilities
 * - HOT-RELOADS when capabilities are granted or revoked
 * - Apps automatically see new APIs when permissions change
 *
 * @example
 * ```tsx
 * function MyApp({ appId, fullApi, registry }: AppProps) {
 *   const { api, capabilities, isUpdating } = useAppKernel({
 *     appId,
 *     fullApi,
 *     registry,
 *   });
 *
 *   if (!api) {
 *     return <Loading />;
 *   }
 *
 *   // api.tables is only defined if app has tables:read
 *   if (api.tables) {
 *     const tables = api.tables.list();
 *   }
 *
 *   // Check capabilities programmatically
 *   if (api.capabilities.has('filesystem:write')) {
 *     await api.filesystem!.writeText('/export.csv', data);
 *   }
 * }
 * ```
 */
export function useAppKernel(deps: UseAppKernelDeps): UseAppKernelResult {
  const { appId, fullApi, registry, domainAllowlist } = deps;
  const targetAppId = createAppId(appId);

  // Create the state manager (memoized)
  const stateRef = useRef<AppKernelState | null>(null);

  // Initialize state manager on first render
  if (stateRef.current === null) {
    stateRef.current = new AppKernelState(targetAppId, fullApi, registry, domainAllowlist);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stateRef.current?.dispose();
      stateRef.current = null;
    };
  }, []);

  // Reinitialize if deps change
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    // Note: We could check if deps actually changed and recreate,
    // but for simplicity, we rely on the parent component to not
    // change these deps unnecessarily.
  }, [appId, fullApi, registry, domainAllowlist]);

  // Subscribe to state changes
  const subscribe = useCallback((onStoreChange: () => void) => {
    return stateRef.current?.subscribe(onStoreChange) ?? (() => {});
  }, []);

  const getSnapshot = useCallback(() => {
    return stateRef.current?.getVersion() ?? 0;
  }, []);

  // Use useSyncExternalStore for optimal React 18 compatibility
  // Note: version is used indirectly to trigger re-renders when capabilities change
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Get current values
  const api = stateRef.current?.getGatedApi() ?? null;
  const capabilities = stateRef.current?.getCapabilities() ?? [];

  // Refresh function
  const refresh = useCallback(() => {
    stateRef.current?.refresh();
  }, []);

  // Track if updating (for UI feedback)
  const [isUpdating] = useState(false);

  return {
    api,
    capabilities,
    isUpdating,
    refresh,
  };
}

// =============================================================================
// Simplified Hook for App ID Only
// =============================================================================

/**
 * Simplified hook when you already have access to the registry/API via context.
 *
 * Use this in apps that receive deps via context rather than props.
 */
export function useAppKernelFromContext(_appId: string): IGatedAppKernelAPI | null {
  // This would be implemented using the CapabilityContext
  // For now, throw an error indicating it needs context setup
  throw new Error(
    'useAppKernelFromContext requires CapabilityContext. Use useAppKernel with explicit deps instead.',
  );
}

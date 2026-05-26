/**
 * CapabilityContext - React context for capability management
 *
 * Provides:
 * - Access to capability registry
 * - Function to request capabilities at runtime
 * - Function to revoke capabilities
 * - Consent dialog integration
 *
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ICapabilityRegistry } from '@mog-sdk/kernel/security';
import { appId as createAppId, getCapabilityInfo } from '@mog-sdk/kernel/security';
import type {
  AppId,
  AppManifestWithCapabilities,
  CapabilityPromptFn,
  CapabilityPromptRequest,
  CapabilityPromptResult,
  CapabilityType,
} from '@mog-sdk/contracts/capabilities';

import type { ConsentRequest, ConsentResult } from '../app-launcher/launch-app';
import {
  CapabilityConsentDialog,
  RuntimeConsentDialog,
} from '../components/capabilities/CapabilityConsentDialog';

// =============================================================================
// Types
// =============================================================================

/**
 * Pending consent request state.
 */
interface PendingConsentState {
  /** The consent request */
  request: ConsentRequest;
  /** Resolve function */
  resolve: (result: ConsentResult) => void;
}

/**
 * Pending runtime request state.
 */
interface PendingRuntimeState {
  /** App ID */
  appId: AppId;
  /** App name */
  appName: string;
  /** App icon */
  appIcon?: string;
  /** The capability being requested */
  capability: CapabilityType;
  /** User-facing reason */
  reason: string;
  /** Resolve function */
  resolve: (granted: boolean) => void;
}

/**
 * Capability context value.
 */
export interface CapabilityContextValue {
  /** The capability registry */
  registry: ICapabilityRegistry;

  /**
   * Request a capability at runtime.
   * Shows consent dialog and grants if user allows.
   *
   * @param appId - The app requesting
   * @param capability - The capability to request
   * @param reason - User-facing reason
   * @returns True if granted, false if denied
   */
  requestCapability: (appId: AppId, capability: CapabilityType, reason: string) => Promise<boolean>;

  /**
   * Revoke a capability from an app.
   *
   * @param appId - The app to revoke from
   * @param capability - The capability to revoke
   */
  revokeCapability: (appId: AppId, capability: CapabilityType) => void;

  /**
   * Revoke all capabilities from an app.
   *
   * @param appId - The app to revoke from
   */
  revokeAllCapabilities: (appId: AppId) => void;

  /**
   * Show consent dialog for app launch.
   * Used by app launcher.
   */
  showConsentDialog: (request: ConsentRequest) => Promise<ConsentResult>;

  /**
   * Get the prompt function for capability requester hook.
   * Returns a function compatible with CapabilityPromptFn.
   */
  getPromptFn: (appName: string, appIcon?: string) => CapabilityPromptFn;
}

// =============================================================================
// Context
// =============================================================================

const CapabilityContext = createContext<CapabilityContextValue | null>(null);

// =============================================================================
// Provider Props
// =============================================================================

export interface CapabilityProviderProps {
  /** The capability registry */
  registry: ICapabilityRegistry;
  /** App manifests for showing app info in dialogs */
  appManifests?: Map<string, AppManifestWithCapabilities>;
  /** Children */
  children: ReactNode;
}

// =============================================================================
// Provider
// =============================================================================

/**
 * CapabilityProvider - Provides capability management context.
 *
 * @example
 * ```tsx
 * <CapabilityProvider registry={capabilityRegistry}>
 *   <App />
 * </CapabilityProvider>
 * ```
 */
export function CapabilityProvider({
  registry,
  appManifests,
  children,
}: CapabilityProviderProps): React.JSX.Element {
  // State for consent dialogs
  const [pendingConsent, setPendingConsent] = useState<PendingConsentState | null>(null);
  const [pendingRuntime, setPendingRuntime] = useState<PendingRuntimeState | null>(null);

  // Show consent dialog for app launch
  const showConsentDialog = useCallback((request: ConsentRequest): Promise<ConsentResult> => {
    return new Promise((resolve) => {
      setPendingConsent({ request, resolve });
    });
  }, []);

  // Handle consent dialog result
  const handleConsentAllow = useCallback(
    (grantedCapabilities: CapabilityType[]) => {
      if (pendingConsent) {
        pendingConsent.resolve({
          decision: 'allow',
          grantedCapabilities,
          remember: true,
        });
        setPendingConsent(null);
      }
    },
    [pendingConsent],
  );

  const handleConsentDeny = useCallback(() => {
    if (pendingConsent) {
      pendingConsent.resolve({ decision: 'deny' });
      setPendingConsent(null);
    }
  }, [pendingConsent]);

  const handleConsentClose = useCallback(() => {
    if (pendingConsent) {
      pendingConsent.resolve({ decision: 'cancel' });
      setPendingConsent(null);
    }
  }, [pendingConsent]);

  // Request capability at runtime
  const requestCapability = useCallback(
    async (appId: AppId, capability: CapabilityType, reason: string): Promise<boolean> => {
      // Check if already have it
      if (registry.hasCapability(appId, capability)) {
        return true;
      }

      // Get app info
      const appIdStr = appId as string;
      const manifest = appManifests?.get(appIdStr);
      const appName = manifest?.name ?? appIdStr;
      const appIcon = manifest?.icon;

      // Show runtime consent dialog
      return new Promise((resolve) => {
        setPendingRuntime({
          appId,
          appName,
          appIcon,
          capability,
          reason,
          resolve,
        });
      });
    },
    [registry, appManifests],
  );

  // Handle runtime consent result
  const handleRuntimeAllow = useCallback(() => {
    if (pendingRuntime) {
      // Grant the capability
      registry.grant(pendingRuntime.appId, pendingRuntime.capability, {
        source: 'user',
      });
      pendingRuntime.resolve(true);
      setPendingRuntime(null);
    }
  }, [pendingRuntime, registry]);

  const handleRuntimeDeny = useCallback(() => {
    if (pendingRuntime) {
      pendingRuntime.resolve(false);
      setPendingRuntime(null);
    }
  }, [pendingRuntime]);

  const handleRuntimeClose = useCallback(() => {
    if (pendingRuntime) {
      pendingRuntime.resolve(false);
      setPendingRuntime(null);
    }
  }, [pendingRuntime]);

  // Revoke capability
  const revokeCapability = useCallback(
    (appId: AppId, capability: CapabilityType) => {
      registry.revoke(appId, capability);
    },
    [registry],
  );

  // Revoke all capabilities
  const revokeAllCapabilities = useCallback(
    (appId: AppId) => {
      registry.revokeAll(appId);
    },
    [registry],
  );

  // Get prompt function for capability requester
  const getPromptFn = useCallback(
    (_appName: string, appIcon?: string): CapabilityPromptFn => {
      return async (request: CapabilityPromptRequest): Promise<CapabilityPromptResult> => {
        // For single capability requests, use runtime dialog
        if (request.requests.length === 1) {
          const req = request.requests[0];
          return new Promise((resolve) => {
            setPendingRuntime({
              appId: request.appId,
              appName: request.appName,
              appIcon,
              capability: req.capability,
              reason: req.reason,
              resolve: (granted) => {
                resolve({
                  decision: granted ? 'grant' : 'deny',
                  grantedCapabilities: granted ? [req.capability] : [],
                });
              },
            });
          });
        }

        // For multiple capabilities, build a consent request
        const manifest: AppManifestWithCapabilities = {
          id: request.appId as string,
          name: request.appName,
          version: '1.0.0',
          icon: appIcon,
          capabilities: {
            required: request.requests.map((r) => r.capability),
          },
        };

        const consentRequest: ConsentRequest = {
          appManifest: manifest,
          requiredCapabilities: request.requests.map((r) => getCapabilityInfo(r.capability)),
          optionalCapabilities: [],
          hasSensitive: request.hasSensitive,
        };

        const result = await showConsentDialog(consentRequest);
        return {
          decision:
            result.decision === 'allow' ? 'grant' : result.decision === 'deny' ? 'deny' : 'cancel',
          grantedCapabilities: result.grantedCapabilities,
          remember: result.remember,
        };
      };
    },
    [showConsentDialog],
  );

  // Build context value
  const contextValue = useMemo<CapabilityContextValue>(
    () => ({
      registry,
      requestCapability,
      revokeCapability,
      revokeAllCapabilities,
      showConsentDialog,
      getPromptFn,
    }),
    [
      registry,
      requestCapability,
      revokeCapability,
      revokeAllCapabilities,
      showConsentDialog,
      getPromptFn,
    ],
  );

  return (
    <CapabilityContext.Provider value={contextValue}>
      {children}

      {/* Consent Dialog for App Launch */}
      {pendingConsent && (
        <CapabilityConsentDialog
          open={true}
          onClose={handleConsentClose}
          appManifest={pendingConsent.request.appManifest}
          requiredCapabilities={pendingConsent.request.requiredCapabilities}
          optionalCapabilities={pendingConsent.request.optionalCapabilities}
          onAllow={handleConsentAllow}
          onDeny={handleConsentDeny}
        />
      )}

      {/* Runtime Consent Dialog */}
      {pendingRuntime && (
        <RuntimeConsentDialog
          open={true}
          onClose={handleRuntimeClose}
          appName={pendingRuntime.appName}
          appIcon={pendingRuntime.appIcon}
          capability={pendingRuntime.capability}
          reason={pendingRuntime.reason}
          onAllow={handleRuntimeAllow}
          onDeny={handleRuntimeDeny}
        />
      )}
    </CapabilityContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Use capability context.
 * Throws if used outside provider.
 */
export function useCapabilityContext(): CapabilityContextValue {
  const context = useContext(CapabilityContext);
  if (!context) {
    throw new Error('useCapabilityContext must be used within CapabilityProvider');
  }
  return context;
}

/**
 * Use capability context (returns null if not in provider).
 */
export function useCapabilityContextOptional(): CapabilityContextValue | null {
  return useContext(CapabilityContext);
}

/**
 * Hook to check if an app has a capability.
 */
export function useHasCapability(appId: string, capability: CapabilityType): boolean {
  const context = useCapabilityContextOptional();
  if (!context) return false;
  return context.registry.hasCapability(createAppId(appId), capability);
}

/**
 * Hook to get all capabilities for an app.
 */
export function useAppCapabilities(appId: string): readonly CapabilityType[] {
  const context = useCapabilityContextOptional();
  if (!context) return [];
  return context.registry.getEffectiveCapabilities(createAppId(appId));
}

// =============================================================================
// Exports
// =============================================================================

export { CapabilityContext };

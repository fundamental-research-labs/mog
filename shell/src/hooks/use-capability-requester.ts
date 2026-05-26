/**
 * useCapabilityRequester - React hook for runtime capability requests
 *
 * This hook provides apps with the ability to:
 * - Check if they have capabilities
 * - Request new capabilities at runtime
 * - React to capability changes (API hot-reload)
 *
 */

import type {
  AppId,
  CapabilityDenialReason,
  CapabilityPromptFn,
  CapabilityRequest,
  CapabilityRequestResult,
  CapabilityScope,
  CapabilityType,
  ICapabilityRequester,
} from '@mog-sdk/contracts/capabilities';
import { useCallback, useMemo, useRef, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of the useCapabilityRequester hook.
 */
export interface UseCapabilityRequesterResult extends ICapabilityRequester {
  /** Current list of effective capabilities */
  readonly capabilities: readonly CapabilityType[];

  /** Whether a capability request is in progress */
  readonly isRequesting: boolean;

  /** Last error from a request */
  readonly lastError: string | null;

  /** Clear the last error */
  clearError(): void;
}

/**
 * Options for the useCapabilityRequester hook.
 */
export interface UseCapabilityRequesterOptions {
  /** The app ID */
  readonly appId: AppId;

  /** App display name for consent dialogs */
  readonly appName: string;

  /** Function to show the consent dialog */
  readonly showConsentDialog: CapabilityPromptFn;

  /** Initial capabilities (if known) */
  readonly initialCapabilities?: readonly CapabilityType[];

  /** Callback when capabilities change */
  readonly onCapabilitiesChange?: (capabilities: readonly CapabilityType[]) => void;
}

// =============================================================================
// Internal State
// =============================================================================

/**
 * Internal state for rate limiting.
 */
interface RateLimitState {
  lastRequestAt: number;
  requestCount: number;
}

/** Rate limit cooldown: 30 seconds */
const RATE_LIMIT_COOLDOWN_MS = 30 * 1000;

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for runtime capability requests.
 *
 * Usage:
 * ```typescript
 * function MyComponent() {
 *   const capRequester = useCapabilityRequester({
 *     appId: 'my-app' as AppId,
 *     appName: 'My App',
 *     showConsentDialog: useConsentDialog(),
 *   });
 *
 *   async function handleExport() {
 *     if (!capRequester.has('filesystem:write')) {
 *       const granted = await capRequester.request(
 *         'filesystem:write',
 *         'Save the exported file'
 *       );
 *       if (!granted) return;
 *     }
 *     // API is now available
 *     await doExport();
 *   }
 *
 *   return (
 *     <button onClick={handleExport} disabled={capRequester.isRequesting}>
 *       Export
 *     </button>
 *   );
 * }
 * ```
 */
export function useCapabilityRequester(
  options: UseCapabilityRequesterOptions,
): UseCapabilityRequesterResult {
  const {
    appId,
    appName,
    showConsentDialog,
    initialCapabilities = [],
    onCapabilitiesChange,
  } = options;

  // State
  const [capabilities, setCapabilities] = useState<readonly CapabilityType[]>(initialCapabilities);
  const [isRequesting, setIsRequesting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Refs for mutable state
  const denialsRef = useRef(
    new Map<CapabilityType, { reason: CapabilityDenialReason; deniedAt: number }>(),
  );
  const rateLimitsRef = useRef(new Map<CapabilityType, RateLimitState>());

  // Callback for clearing errors
  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  // Update capabilities and notify
  const updateCapabilities = useCallback(
    (newCapabilities: readonly CapabilityType[]) => {
      setCapabilities(newCapabilities);
      onCapabilitiesChange?.(newCapabilities);
    },
    [onCapabilitiesChange],
  );

  // Check if we have a capability
  const has = useCallback(
    (capability: CapabilityType): boolean => {
      return capabilities.includes(capability);
    },
    [capabilities],
  );

  // Check rate limiting
  const canRequest = useCallback(
    (capability: CapabilityType): { canRequest: boolean; retryAfter?: number } => {
      const record = rateLimitsRef.current.get(capability);
      if (!record) {
        return { canRequest: true };
      }

      const now = Date.now();
      const cooldownEnd = record.lastRequestAt + RATE_LIMIT_COOLDOWN_MS;

      if (now >= cooldownEnd) {
        return { canRequest: true };
      }

      return {
        canRequest: false,
        retryAfter: cooldownEnd,
      };
    },
    [],
  );

  // Record a request for rate limiting
  const recordRequest = useCallback((capability: CapabilityType) => {
    const existing = rateLimitsRef.current.get(capability);
    rateLimitsRef.current.set(capability, {
      lastRequestAt: Date.now(),
      requestCount: (existing?.requestCount ?? 0) + 1,
    });
  }, []);

  // Check if denied
  const isDenied = useCallback((capability: CapabilityType): boolean => {
    return denialsRef.current.has(capability);
  }, []);

  // Get denial status
  const getDenialStatus = useCallback(
    (
      capability: CapabilityType,
    ): { reason: CapabilityDenialReason; deniedAt: number } | undefined => {
      return denialsRef.current.get(capability);
    },
    [],
  );

  // Clear denial
  const clearDenial = useCallback((capability: CapabilityType): void => {
    denialsRef.current.delete(capability);
    rateLimitsRef.current.delete(capability);
  }, []);

  // Request a single capability
  const request = useCallback(
    async (capability: CapabilityType, reason: string): Promise<boolean> => {
      // Check if already have it
      if (has(capability)) {
        return true;
      }

      // Check rate limiting
      const rateStatus = canRequest(capability);
      if (!rateStatus.canRequest) {
        setLastError(`Please wait before requesting this permission again.`);
        return false;
      }

      // Check if previously denied
      if (isDenied(capability)) {
        setLastError(`This permission was previously denied.`);
        return false;
      }

      setIsRequesting(true);
      setLastError(null);

      try {
        const result = await showConsentDialog({
          appId,
          appName,
          requests: [{ capability, reason }],
          hasSensitive: false,
          requiresAuth: false,
        });

        recordRequest(capability);

        if (result.decision === 'grant') {
          // Update capabilities
          const newCapabilities = [...capabilities, capability];
          updateCapabilities(newCapabilities);
          return true;
        } else {
          // Record denial
          denialsRef.current.set(capability, {
            reason: 'user-denied',
            deniedAt: Date.now(),
          });
          return false;
        }
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'Request failed');
        return false;
      } finally {
        setIsRequesting(false);
      }
    },
    [
      appId,
      appName,
      capabilities,
      canRequest,
      has,
      isDenied,
      recordRequest,
      showConsentDialog,
      updateCapabilities,
    ],
  );

  // Request multiple capabilities
  const requestMultiple = useCallback(
    async (requests: readonly CapabilityRequest[]): Promise<CapabilityRequestResult> => {
      const results: Array<{
        capability: CapabilityType;
        granted: boolean;
        denialReason?: CapabilityDenialReason;
        retryAfter?: number;
      }> = [];
      const granted: CapabilityType[] = [];
      const denied: CapabilityType[] = [];

      // Filter already granted
      const pendingRequests: CapabilityRequest[] = [];
      for (const req of requests) {
        if (has(req.capability)) {
          results.push({ capability: req.capability, granted: true });
          granted.push(req.capability);
        } else {
          pendingRequests.push(req);
        }
      }

      if (pendingRequests.length === 0) {
        return { allGranted: true, results, granted, denied };
      }

      // Check rate limits and denials
      const toPrompt: CapabilityRequest[] = [];
      for (const req of pendingRequests) {
        const rateStatus = canRequest(req.capability);
        if (!rateStatus.canRequest) {
          results.push({
            capability: req.capability,
            granted: false,
            denialReason: 'rate-limited',
            retryAfter: rateStatus.retryAfter,
          });
          denied.push(req.capability);
        } else if (isDenied(req.capability)) {
          results.push({
            capability: req.capability,
            granted: false,
            denialReason: 'previously-denied',
          });
          denied.push(req.capability);
        } else {
          toPrompt.push(req);
        }
      }

      if (toPrompt.length === 0) {
        return { allGranted: false, results, granted, denied };
      }

      setIsRequesting(true);
      setLastError(null);

      try {
        const promptResult = await showConsentDialog({
          appId,
          appName,
          requests: toPrompt,
          hasSensitive: false,
          requiresAuth: false,
        });

        // Record all requests for rate limiting
        for (const req of toPrompt) {
          recordRequest(req.capability);
        }

        if (promptResult.decision === 'grant') {
          const grantedCaps = promptResult.grantedCapabilities || toPrompt.map((r) => r.capability);

          for (const req of toPrompt) {
            const wasGranted = grantedCaps.includes(req.capability);
            if (wasGranted) {
              results.push({ capability: req.capability, granted: true });
              granted.push(req.capability);
            } else {
              results.push({
                capability: req.capability,
                granted: false,
                denialReason: 'user-denied',
              });
              denied.push(req.capability);
            }
          }

          // Update capabilities
          if (granted.length > 0) {
            const newCapabilities = [
              ...capabilities,
              ...granted.filter((c) => !capabilities.includes(c)),
            ];
            updateCapabilities(newCapabilities);
          }
        } else {
          // Denied all
          for (const req of toPrompt) {
            results.push({
              capability: req.capability,
              granted: false,
              denialReason: 'user-denied',
            });
            denied.push(req.capability);
            denialsRef.current.set(req.capability, {
              reason: 'user-denied',
              deniedAt: Date.now(),
            });
          }
        }

        return { allGranted: denied.length === 0, results, granted, denied };
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'Request failed');

        // Mark all as failed
        for (const req of toPrompt) {
          results.push({
            capability: req.capability,
            granted: false,
            denialReason: 'user-denied',
          });
          denied.push(req.capability);
        }

        return { allGranted: false, results, granted, denied };
      } finally {
        setIsRequesting(false);
      }
    },
    [
      appId,
      appName,
      capabilities,
      canRequest,
      has,
      isDenied,
      recordRequest,
      showConsentDialog,
      updateCapabilities,
    ],
  );

  // Request scoped capability
  const requestScoped = useCallback(
    async (
      capability: CapabilityType,
      scope: CapabilityScope,
      reason: string,
    ): Promise<boolean> => {
      const result = await requestMultiple([{ capability, reason, scope }]);
      return result.allGranted;
    },
    [requestMultiple],
  );

  // Build the result object
  const result = useMemo<UseCapabilityRequesterResult>(
    () => ({
      capabilities,
      isRequesting,
      lastError,
      clearError,
      has,
      request,
      requestMultiple,
      requestScoped,
      canRequest,
      clearDenial,
      getDenialStatus,
      isDenied,
    }),
    [
      capabilities,
      isRequesting,
      lastError,
      clearError,
      has,
      request,
      requestMultiple,
      requestScoped,
      canRequest,
      clearDenial,
      getDenialStatus,
      isDenied,
    ],
  );

  return result;
}

// =============================================================================
// Context (Optional - For Prop Drilling Avoidance)
// =============================================================================

import { createContext, useContext } from 'react';

/**
 * Context for capability requester.
 *
 * This allows child components to access the requester without prop drilling.
 * The context is created here, and a Provider component should be created
 * in a .tsx file if JSX is needed.
 */
export const CapabilityRequesterContext = createContext<UseCapabilityRequesterResult | null>(null);

/**
 * Hook to use the capability requester from context.
 *
 * @throws Error if used outside of CapabilityRequesterProvider
 */
export function useCapabilityRequesterContext(): UseCapabilityRequesterResult {
  const context = useContext(CapabilityRequesterContext);
  if (!context) {
    throw new Error(
      'useCapabilityRequesterContext must be used within CapabilityRequesterContext.Provider',
    );
  }
  return context;
}

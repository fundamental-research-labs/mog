/**
 * Capability Requester - Runtime capability request implementation
 *
 * This is the kernel-side implementation of ICapabilityRequester.
 * It handles:
 * - Checking existing capabilities
 * - Validating requests against app manifests
 * - Rate limiting
 * - Coordinating with the registry for grants
 * - Invoking the shell's prompt function for consent UI
 *
 */

import type {
  CapabilityDenialReason,
  CapabilityPromptFn,
  CapabilityPromptRequest,
  CapabilityRequest,
  CapabilityRequestResult,
  ICapabilityRequester,
  SingleRequestResult,
} from './cap-requester';
import type { CapabilityType } from './cap-types';
import {
  CAPABILITY_REGISTRY,
  getSessionDuration,
  isSessionOnly,
  requiresAuthentication,
} from './cap-types';
import type { AppId } from './grants';
import type { CapabilityScope } from './scope';

import type { ICapabilityRegistry } from './types';
import type { SensitiveCapabilityHandler } from './sensitive-handler';

// =============================================================================
// Capability Requester Implementation
// =============================================================================

/**
 * Options for creating a capability requester.
 */
export interface CapabilityRequesterOptions {
  /** The app ID this requester belongs to */
  readonly appId: AppId;

  /** App display name for consent dialogs */
  readonly appName: string;

  /** The capability registry */
  readonly registry: ICapabilityRegistry;

  /** Handler for sensitive capabilities (optional) */
  readonly sensitiveHandler?: SensitiveCapabilityHandler;

  /** Function to prompt the user (provided by shell) */
  readonly promptUser: CapabilityPromptFn;

  /** Optional: Callback when capabilities change (for API hot-reload) */
  readonly onCapabilityChange?: (capabilities: CapabilityType[]) => void;
}

/**
 * Internal denial tracking.
 */
interface InternalDenial {
  readonly reason: CapabilityDenialReason;
  readonly deniedAt: number;
}

/**
 * Capability Requester - handles runtime capability requests.
 */
export class CapabilityRequester implements ICapabilityRequester {
  private readonly appId: AppId;
  private readonly appName: string;
  private readonly registry: ICapabilityRegistry;
  private readonly sensitiveHandler?: SensitiveCapabilityHandler;
  private readonly promptUser: CapabilityPromptFn;
  private readonly onCapabilityChange?: (capabilities: CapabilityType[]) => void;

  /** Local denial tracking (in addition to store) */
  private readonly denials = new Map<CapabilityType, InternalDenial>();

  /** Unsubscribe function for registry events */
  private unsubscribe?: () => void;

  constructor(options: CapabilityRequesterOptions) {
    this.appId = options.appId;
    this.appName = options.appName;
    this.registry = options.registry;
    this.sensitiveHandler = options.sensitiveHandler;
    this.promptUser = options.promptUser;
    this.onCapabilityChange = options.onCapabilityChange;

    // Subscribe to registry changes for this app
    if (this.onCapabilityChange) {
      this.unsubscribe = this.registry.subscribeToApp(this.appId, () => {
        const capabilities = this.registry.getEffectiveCapabilities(this.appId);
        this.onCapabilityChange!(capabilities);
      });
    }
  }

  // ===========================================================================
  // ICapabilityRequester Implementation
  // ===========================================================================

  /**
   * Check if the app currently has a capability.
   */
  has(capability: CapabilityType): boolean {
    return this.registry.hasCapability(this.appId, capability);
  }

  /**
   * Request a single capability.
   */
  async request(capability: CapabilityType, reason: string): Promise<boolean> {
    const result = await this.requestMultiple([{ capability, reason }]);
    return result.allGranted;
  }

  /**
   * Request multiple capabilities at once.
   */
  async requestMultiple(requests: readonly CapabilityRequest[]): Promise<CapabilityRequestResult> {
    const results: SingleRequestResult[] = [];
    const granted: CapabilityType[] = [];
    const denied: CapabilityType[] = [];

    // Filter out already granted capabilities
    const pendingRequests: CapabilityRequest[] = [];
    for (const req of requests) {
      if (this.has(req.capability)) {
        results.push({
          capability: req.capability,
          granted: true,
        });
        granted.push(req.capability);
      } else {
        pendingRequests.push(req);
      }
    }

    // If all are already granted, return early
    if (pendingRequests.length === 0) {
      return {
        allGranted: true,
        results,
        granted,
        denied,
      };
    }

    // Check rate limiting for each pending request
    for (const req of pendingRequests) {
      const rateLimitStatus = this.canRequest(req.capability);
      if (!rateLimitStatus.canRequest) {
        results.push({
          capability: req.capability,
          granted: false,
          denialReason: 'rate-limited',
          retryAfter: rateLimitStatus.retryAfter,
        });
        denied.push(req.capability);
      }
    }

    // Filter out rate-limited requests
    const nonRateLimitedRequests = pendingRequests.filter(
      (req) => !denied.includes(req.capability),
    );

    // If all are rate limited, return early
    if (nonRateLimitedRequests.length === 0) {
      return {
        allGranted: false,
        results,
        granted,
        denied,
      };
    }

    // Check for previously denied capabilities
    for (const req of nonRateLimitedRequests) {
      if (this.isDenied(req.capability)) {
        results.push({
          capability: req.capability,
          granted: false,
          denialReason: 'previously-denied',
        });
        denied.push(req.capability);
      }
    }

    // Filter out previously denied
    const promptRequests = nonRateLimitedRequests.filter((req) => !denied.includes(req.capability));

    // If all are denied, return early
    if (promptRequests.length === 0) {
      return {
        allGranted: false,
        results,
        granted,
        denied,
      };
    }

    // Determine if any sensitive capabilities are requested
    const hasSensitive = promptRequests.some((req) => {
      const info = CAPABILITY_REGISTRY[req.capability];
      return info.riskLevel === 'critical';
    });

    const requiresAuth = promptRequests.some((req) => requiresAuthentication(req.capability));

    // Build prompt request
    const promptRequest: CapabilityPromptRequest = {
      appId: this.appId,
      appName: this.appName,
      requests: promptRequests,
      hasSensitive,
      requiresAuth,
    };

    // Show consent dialog
    const promptResult = await this.promptUser(promptRequest);

    // Process result
    if (promptResult.decision === 'cancel') {
      // User cancelled - not a denial, just return without granting
      for (const req of promptRequests) {
        results.push({
          capability: req.capability,
          granted: false,
          denialReason: 'user-denied',
        });
        denied.push(req.capability);
      }
    } else if (promptResult.decision === 'deny') {
      // User denied - record denial
      for (const req of promptRequests) {
        this.recordDenial(req.capability, 'user-denied');
        results.push({
          capability: req.capability,
          granted: false,
          denialReason: 'user-denied',
        });
        denied.push(req.capability);
      }
    } else {
      // Grant decision
      const grantedCaps =
        promptResult.grantedCapabilities || promptRequests.map((r) => r.capability);

      for (const req of promptRequests) {
        const wasGranted = grantedCaps.includes(req.capability);

        if (wasGranted) {
          // Grant the capability
          const capRequest = promptRequests.find((r) => r.capability === req.capability);

          // Build grant options
          const sessionOnlyGrant = isSessionOnly(req.capability);
          const grantOptions = {
            scope: capRequest?.scope,
            sessionOnly: sessionOnlyGrant ? true : undefined,
            duration: sessionOnlyGrant ? getSessionDuration(req.capability) : undefined,
          };

          this.registry.grant(this.appId, req.capability, grantOptions);

          results.push({
            capability: req.capability,
            granted: true,
          });
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
    }

    // Record rate limit for all requested capabilities
    for (const req of promptRequests) {
      this.sensitiveHandler?.recordRequest(this.appId, req.capability);
    }

    return {
      allGranted: denied.length === 0,
      results,
      granted,
      denied,
    };
  }

  /**
   * Request a scoped capability.
   */
  async requestScoped(
    capability: CapabilityType,
    scope: CapabilityScope,
    reason: string,
  ): Promise<boolean> {
    const result = await this.requestMultiple([{ capability, reason, scope }]);
    return result.allGranted;
  }

  /**
   * Check if a request can be made (not rate limited).
   */
  canRequest(capability: CapabilityType): { canRequest: boolean; retryAfter?: number } {
    if (this.sensitiveHandler) {
      const status = this.sensitiveHandler.canRequestAgain(this.appId, capability);
      return {
        canRequest: status.canRequest,
        retryAfter: status.retryAfter,
      };
    }
    return { canRequest: true };
  }

  /**
   * Clear a previous denial.
   */
  clearDenial(capability: CapabilityType): void {
    this.denials.delete(capability);
    this.sensitiveHandler?.clearRateLimit(this.appId, capability);
  }

  /**
   * Get the denial status for a capability.
   */
  getDenialStatus(
    capability: CapabilityType,
  ): { reason: CapabilityDenialReason; deniedAt: number } | undefined {
    return this.denials.get(capability);
  }

  /**
   * Check if a capability was explicitly denied.
   */
  isDenied(capability: CapabilityType): boolean {
    return this.denials.has(capability);
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Record a denial locally.
   */
  private recordDenial(capability: CapabilityType, reason: CapabilityDenialReason): void {
    this.denials.set(capability, {
      reason,
      deniedAt: Date.now(),
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Dispose of the requester.
   */
  dispose(): void {
    this.unsubscribe?.();
    this.denials.clear();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new capability requester.
 */
export function createCapabilityRequester(
  options: CapabilityRequesterOptions,
): CapabilityRequester {
  return new CapabilityRequester(options);
}

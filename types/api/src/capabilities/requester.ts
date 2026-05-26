/**
 * Capability Requester - Runtime capability request interfaces
 *
 * This file defines:
 * - ICapabilityRequester interface for runtime capability requests
 * - CapabilityRequest and CapabilityRequestResult types
 *
 * Apps use the requester to request additional capabilities during execution.
 *
 */

import type { AppId } from './grants';
import type { CapabilityScope } from './scope';
import type { CapabilityType } from './types';

// =============================================================================
// Capability Request Types
// =============================================================================

/**
 * A single capability request.
 */
export interface CapabilityRequest {
  /** The capability being requested */
  readonly capability: CapabilityType;

  /** User-facing reason why this capability is needed */
  readonly reason: string;

  /** Optional scope for scoped access */
  readonly scope?: CapabilityScope;
}

/**
 * Result of a single capability request.
 */
export interface SingleRequestResult {
  /** The capability that was requested */
  readonly capability: CapabilityType;

  /** Whether the capability was granted */
  readonly granted: boolean;

  /** If not granted, why (user denied, rate limited, requires auth, etc.) */
  readonly denialReason?: CapabilityDenialReason;

  /** If rate limited, when the request can be retried (Unix ms) */
  readonly retryAfter?: number;
}

/**
 * Reason why a capability request was denied.
 */
export type CapabilityDenialReason =
  /** User explicitly denied in the consent dialog */
  | 'user-denied'
  /** Request was rate-limited (too many requests) */
  | 'rate-limited'
  /** Capability requires re-authentication */
  | 'requires-auth'
  /** User failed re-authentication */
  | 'auth-failed'
  /** Capability was previously denied and denial is still active */
  | 'previously-denied'
  /** The capability is not declared in the app's manifest */
  | 'not-declared'
  /** The capability has been revoked by admin */
  | 'admin-revoked'
  /** Session expired before request completed */
  | 'session-expired';

/**
 * Result of a multiple capability request.
 */
export interface CapabilityRequestResult {
  /** Whether all requested capabilities were granted */
  readonly allGranted: boolean;

  /** Results for each requested capability */
  readonly results: readonly SingleRequestResult[];

  /** List of capabilities that were granted */
  readonly granted: readonly CapabilityType[];

  /** List of capabilities that were denied */
  readonly denied: readonly CapabilityType[];
}

// =============================================================================
// Capability Requester Interface
// =============================================================================

/**
 * Interface for requesting capabilities at runtime.
 *
 * Apps use this to request additional capabilities during execution.
 * The request triggers the consent flow, which may show a dialog to the user.
 *
 * Usage:
 * ```typescript
 * async function handleExport() {
 *   if (!requester.has('filesystem:write')) {
 *     const granted = await requester.request(
 *       'filesystem:write',
 *       'Save the exported file to your computer'
 *     );
 *     if (!granted) {
 *       showError('Cannot export without file access');
 *       return;
 *     }
 *     // API hot-reloads - api.filesystem is now defined
 *   }
 *   await api.filesystem!.write('export.csv', data);
 * }
 * ```
 */
export interface ICapabilityRequester {
  /**
   * Check if the app currently has a capability.
   *
   * This includes both directly granted capabilities and implied capabilities
   * (e.g., cells:write implies cells:read).
   *
   * @param capability - The capability to check
   * @returns True if the app has this capability
   */
  has(capability: CapabilityType): boolean;

  /**
   * Request a single capability.
   *
   * This triggers the consent flow, which may:
   * - Grant immediately (if already granted)
   * - Show a consent dialog (for normal capabilities)
   * - Require re-authentication (for sensitive capabilities)
   *
   * @param capability - The capability to request
   * @param reason - User-facing reason for the request
   * @returns True if granted, false if denied
   */
  request(capability: CapabilityType, reason: string): Promise<boolean>;

  /**
   * Request multiple capabilities at once.
   *
   * All capabilities are shown in a single consent dialog.
   * If any are denied, the entire batch fails.
   *
   * @param requests - Array of capability requests
   * @returns Result object with granted/denied status for each
   */
  requestMultiple(requests: readonly CapabilityRequest[]): Promise<CapabilityRequestResult>;

  /**
   * Request a scoped capability.
   *
   * @param capability - The capability to request
   * @param scope - The scope limiting access (e.g., "table:contacts")
   * @param reason - User-facing reason for the request
   * @returns True if granted, false if denied
   */
  requestScoped(
    capability: CapabilityType,
    scope: CapabilityScope,
    reason: string,
  ): Promise<boolean>;

  /**
   * Check if a request can be made (not rate limited).
   *
   * @param capability - The capability to check
   * @returns Object with canRequest flag and optional retryAfter timestamp
   */
  canRequest(capability: CapabilityType): {
    readonly canRequest: boolean;
    readonly retryAfter?: number;
  };

  /**
   * Clear a previous denial, allowing re-prompting.
   *
   * This is typically called after user clicks "Grant Permission" in settings.
   *
   * @param capability - The capability to clear denial for
   */
  clearDenial(capability: CapabilityType): void;

  /**
   * Get the denial status for a capability.
   *
   * @param capability - The capability to check
   * @returns Denial info if denied, undefined if not denied
   */
  getDenialStatus(capability: CapabilityType):
    | {
        readonly reason: CapabilityDenialReason;
        readonly deniedAt: number;
      }
    | undefined;

  /**
   * Check if a capability was explicitly denied.
   *
   * @param capability - The capability to check
   * @returns True if the capability was explicitly denied
   */
  isDenied(capability: CapabilityType): boolean;
}

// =============================================================================
// Capability Prompt Types
// =============================================================================

/**
 * Request for showing a capability consent dialog.
 *
 * This is passed to the shell's prompt function.
 */
export interface CapabilityPromptRequest {
  /** The app requesting the capability */
  readonly appId: AppId;

  /** App display name */
  readonly appName: string;

  /** The capabilities being requested */
  readonly requests: readonly CapabilityRequest[];

  /** Whether any capabilities are sensitive (require extra warning) */
  readonly hasSensitive: boolean;

  /** Whether re-authentication is required */
  readonly requiresAuth: boolean;
}

/**
 * Result of a capability prompt dialog.
 */
export interface CapabilityPromptResult {
  /** User's decision */
  readonly decision: 'grant' | 'deny' | 'cancel';

  /** If partial grant, which capabilities were granted */
  readonly grantedCapabilities?: readonly CapabilityType[];

  /** Whether to remember this decision */
  readonly remember?: boolean;
}

/**
 * Callback function for prompting the user.
 *
 * The shell provides this to the requester to show UI.
 */
export type CapabilityPromptFn = (
  request: CapabilityPromptRequest,
) => Promise<CapabilityPromptResult>;

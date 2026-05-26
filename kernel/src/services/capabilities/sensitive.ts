/**
 * Sensitive Capability Handling - Session management and re-authentication
 *
 * This file defines:
 * - SessionGrant: A time-limited capability grant
 * - ISensitiveCapabilityHandler: Interface for managing sensitive capabilities
 * - IReAuthProvider: Interface for re-authentication
 *
 * Sensitive capabilities (Tier 5) require special handling:
 * - Session-only grants with time limits
 * - Re-authentication before granting
 * - Rate limiting to prevent dialog spam
 * - Expiry warnings
 *
 */

import type { CapabilityType } from './cap-types';
import type { AppId, CapabilityGrant } from './grants';

// =============================================================================
// Session Grant Types
// =============================================================================

/**
 * A session-only capability grant with expiration.
 *
 * Session grants:
 * - Expire after a set duration (default: 30 minutes)
 * - Are not persisted to storage
 * - Require re-authentication to renew
 * - Emit warnings before expiration
 */
export interface SessionGrant {
  /** The underlying capability grant */
  readonly grant: CapabilityGrant;

  /** When the session started (Unix ms) */
  readonly sessionStart: number;

  /** When the session will expire (Unix ms) */
  readonly expiresAt: number;

  /** Session duration in milliseconds */
  readonly duration: number;

  /** Whether extension is allowed (some caps may not allow) */
  readonly extensionAllowed: boolean;

  /** Number of times this session has been extended */
  readonly extensionCount: number;

  /** Maximum number of extensions allowed (default: 3) */
  readonly maxExtensions: number;
}

/**
 * Expiry warning callback parameters.
 */
export interface ExpiryWarning {
  /** The app with the expiring capability */
  readonly appId: AppId;

  /** The capability that is expiring */
  readonly capability: CapabilityType;

  /** The grant that is expiring */
  readonly grant: CapabilityGrant;

  /** Seconds remaining until expiration */
  readonly secondsRemaining: number;

  /** Warning level based on time remaining */
  readonly level: 'info' | 'warning' | 'critical';
}

/**
 * Rate limit status for capability requests.
 */
export interface RateLimitStatus {
  /** Whether a request can be made now */
  readonly canRequest: boolean;

  /** If rate limited, when the request can be retried (Unix ms) */
  readonly retryAfter?: number;

  /** Seconds until retry is allowed */
  readonly retryInSeconds?: number;

  /** Number of requests made in the cooldown period */
  readonly requestCount: number;
}

// =============================================================================
// Sensitive Capability Handler Interface
// =============================================================================

/**
 * Interface for managing sensitive capabilities.
 *
 * The handler provides:
 * - Session management (create, validate, extend)
 * - Expiry warnings (callbacks before expiration)
 * - Rate limiting (prevent spam of permission dialogs)
 */
export interface ISensitiveCapabilityHandler {
  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Create a session grant for a sensitive capability.
   *
   * @param appId - The app to create a session for
   * @param capability - The sensitive capability
   * @param options - Optional session configuration
   * @returns The created session grant
   */
  createSession(appId: AppId, capability: CapabilityType, options?: SessionOptions): SessionGrant;

  /**
   * Check if a session grant is still valid.
   *
   * @param session - The session to check
   * @returns True if the session is valid and not expired
   */
  isSessionValid(session: SessionGrant): boolean;

  /**
   * Get the current session for an app and capability.
   *
   * @param appId - The app to get session for
   * @param capability - The capability to get session for
   * @returns The session if active, undefined otherwise
   */
  getSession(appId: AppId, capability: CapabilityType): SessionGrant | undefined;

  /**
   * Get all active sessions for an app.
   *
   * @param appId - The app to get sessions for
   * @returns Array of active sessions
   */
  getActiveSessions(appId: AppId): readonly SessionGrant[];

  /**
   * Extend a session grant's expiration.
   *
   * Requires re-authentication.
   *
   * @param session - The session to extend
   * @param duration - Optional custom duration (uses default if not provided)
   * @returns The extended session, or null if extension not allowed
   */
  extendSession(session: SessionGrant, duration?: number): SessionGrant | null;

  /**
   * End a session early.
   *
   * @param appId - The app ID
   * @param capability - The capability
   */
  endSession(appId: AppId, capability: CapabilityType): void;

  /**
   * End all sessions for an app.
   *
   * @param appId - The app ID
   */
  endAllSessions(appId: AppId): void;

  // ===========================================================================
  // Expiry Warnings
  // ===========================================================================

  /**
   * Subscribe to capability expiration warnings.
   *
   * Warnings are issued at:
   * - 5 minutes before expiration (info)
   * - 1 minute before expiration (warning)
   * - 60 seconds before expiration (critical)
   *
   * @param callback - Called when a capability is expiring
   * @returns Unsubscribe function
   */
  onCapabilityExpiring(callback: (warning: ExpiryWarning) => void): () => void;

  /**
   * Subscribe to capability expiration (when it actually expires).
   *
   * @param callback - Called when a capability expires
   * @returns Unsubscribe function
   */
  onCapabilityExpired(callback: (appId: AppId, capability: CapabilityType) => void): () => void;

  /**
   * Get the remaining time for a session in milliseconds.
   *
   * @param appId - The app ID
   * @param capability - The capability
   * @returns Remaining time in ms, or undefined if no active session
   */
  getRemainingTime(appId: AppId, capability: CapabilityType): number | undefined;

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  /**
   * Check if a capability can be requested (not rate limited).
   *
   * Rate limiting:
   * - 30-second cooldown per capability per app
   * - Prevents apps from spamming permission dialogs
   *
   * @param appId - The app making the request
   * @param capability - The capability being requested
   * @returns Rate limit status
   */
  canRequestAgain(appId: AppId, capability: CapabilityType): RateLimitStatus;

  /**
   * Record a capability request for rate limiting.
   *
   * Call this after each request attempt (granted or denied).
   *
   * @param appId - The app that made the request
   * @param capability - The capability that was requested
   */
  recordRequest(appId: AppId, capability: CapabilityType): void;

  /**
   * Clear rate limiting for a specific capability.
   *
   * Used when user explicitly clears denial from settings.
   *
   * @param appId - The app ID
   * @param capability - The capability to clear rate limit for
   */
  clearRateLimit(appId: AppId, capability: CapabilityType): void;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the handler (begins monitoring sessions).
   */
  start(): void;

  /**
   * Stop the handler (stops monitoring).
   */
  stop(): void;

  /**
   * Dispose the handler (cleanup all resources).
   */
  dispose(): void;
}

/**
 * Options for creating a session.
 */
export interface SessionOptions {
  /** Session duration in milliseconds (default: 30 minutes) */
  readonly duration?: number;

  /** Whether extensions are allowed (default: true) */
  readonly extensionAllowed?: boolean;

  /** Maximum number of extensions (default: 3) */
  readonly maxExtensions?: number;
}

// =============================================================================
// Re-Authentication Provider Interface
// =============================================================================

/**
 * Type of authentication method.
 */
export type AuthMethod = 'biometric' | 'password';

/**
 * Re-authentication result.
 */
export interface ReAuthResult {
  /** Whether authentication succeeded */
  readonly success: boolean;

  /** The method that was used */
  readonly method: AuthMethod;

  /** Error message if failed */
  readonly error?: string;

  /** Timestamp of the authentication */
  readonly timestamp: number;
}

/**
 * Options for re-authentication.
 */
export interface ReAuthOptions {
  /** The capability that requires authentication */
  readonly capability: CapabilityType;

  /** The app requesting authentication */
  readonly appId: AppId;

  /** User-facing reason for authentication */
  readonly reason: string;

  /** Preferred authentication method */
  readonly preferredMethod?: AuthMethod;

  /** Fallback method if preferred is unavailable */
  readonly fallbackMethod?: AuthMethod;

  /** Timeout for the authentication (default: 60 seconds) */
  readonly timeout?: number;
}

/**
 * Interface for re-authentication providers.
 *
 * Platform-specific implementations:
 * - Desktop: Touch ID, Windows Hello, or password
 * - Web: Password re-entry
 */
export interface IReAuthProvider {
  /**
   * Check if re-authentication is available.
   */
  isAvailable(): boolean;

  /**
   * Get available authentication methods.
   */
  getAvailableMethods(): readonly AuthMethod[];

  /**
   * Check if a specific method is available.
   *
   * @param method - The method to check
   */
  isMethodAvailable(method: AuthMethod): boolean;

  /**
   * Perform re-authentication.
   *
   * @param options - Authentication options
   * @returns Result of the authentication
   */
  authenticate(options: ReAuthOptions): Promise<ReAuthResult>;

  /**
   * Cancel an in-progress authentication.
   */
  cancel(): void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a capability requires re-authentication.
 *
 * Based on the capability taxonomy:
 * - credentials:use: Yes
 * - connections:native: Yes
 * - tables:writeAll: Yes
 * - cells:writeAll: Yes
 */
export function requiresReAuth(capability: CapabilityType): boolean {
  const REQUIRES_REAUTH: ReadonlySet<CapabilityType> = new Set([
    'credentials:use',
    'connections:native',
    'tables:writeAll',
    'cells:writeAll',
  ]);
  return REQUIRES_REAUTH.has(capability);
}

/**
 * Check if a capability should be session-only.
 *
 * Session-only capabilities:
 * - credentials:use
 */
export function isSessionOnlyCapability(capability: CapabilityType): boolean {
  const SESSION_ONLY: ReadonlySet<CapabilityType> = new Set(['credentials:use']);
  return SESSION_ONLY.has(capability);
}

/**
 * Get the default session duration for a capability.
 *
 * @param capability - The capability
 * @returns Duration in milliseconds (default: 30 minutes)
 */
export function getDefaultSessionDuration(_capability: CapabilityType): number {
  // All session-only capabilities default to 30 minutes
  return 30 * 60 * 1000;
}

/**
 * Get the warning thresholds for a capability (in seconds).
 *
 * @returns Array of warning thresholds
 */
export function getExpiryWarningThresholds(): readonly number[] {
  return [
    5 * 60, // 5 minutes - info
    60, // 1 minute - warning
    60, // 60 seconds - critical (same as 1 minute for simplicity)
  ];
}

/**
 * Get the rate limit cooldown period.
 *
 * @returns Cooldown in milliseconds (30 seconds)
 */
export function getRateLimitCooldown(): number {
  return 30 * 1000;
}

/**
 * Sensitive Capability Handler - Session management and rate limiting
 *
 * This handles sensitive capabilities (Tier 5) that require:
 * - Session-only grants with time limits
 * - Expiry warnings before timeout
 * - Rate limiting to prevent dialog spam
 *
 */

import type { CapabilityType } from './cap-types';
import type { AppId } from './grants';
import { createGrant } from './grants';
import type {
  ExpiryWarning,
  ISensitiveCapabilityHandler,
  RateLimitStatus,
  SessionGrant,
  SessionOptions,
} from './sensitive';
import { getDefaultSessionDuration, getRateLimitCooldown } from './sensitive';

// =============================================================================
// Constants
// =============================================================================

/** Default session duration: 30 minutes */
const DEFAULT_SESSION_DURATION = 30 * 60 * 1000;

/** Default max extensions */
const DEFAULT_MAX_EXTENSIONS = 3;

/** Rate limit cooldown: 30 seconds (kept for documentation, actual value from contracts) */
// const RATE_LIMIT_COOLDOWN = 30 * 1000;

/** Warning thresholds in milliseconds */
const WARNING_THRESHOLDS = [
  { ms: 5 * 60 * 1000, level: 'info' as const }, // 5 minutes
  { ms: 60 * 1000, level: 'warning' as const }, // 1 minute
  { ms: 60 * 1000, level: 'critical' as const }, // 60 seconds (same timing, different level for second warning)
];

/** Check interval for expiry: every 10 seconds */
const CHECK_INTERVAL = 10 * 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * Internal session record.
 */
interface SessionRecord {
  session: SessionGrant;
  warningsSent: Set<string>; // Track which warnings have been sent
}

/**
 * Rate limit record.
 */
interface RateLimitRecord {
  lastRequestAt: number;
  requestCount: number;
}

/**
 * Expiry callback type.
 */
type ExpiryCallback = (warning: ExpiryWarning) => void;
type ExpiredCallback = (appId: AppId, capability: CapabilityType) => void;

// =============================================================================
// Sensitive Capability Handler Implementation
// =============================================================================

/**
 * Handler for sensitive capabilities.
 *
 * Manages:
 * - Session-only grants with expiration
 * - Expiry warnings
 * - Rate limiting
 */
export class SensitiveCapabilityHandler implements ISensitiveCapabilityHandler {
  /** Active sessions: appId -> capability -> SessionRecord */
  private readonly sessions = new Map<string, Map<CapabilityType, SessionRecord>>();

  /** Rate limit records: "appId:capability" -> RateLimitRecord */
  private readonly rateLimits = new Map<string, RateLimitRecord>();

  /** Expiry warning callbacks */
  private readonly expiryCallbacks = new Set<ExpiryCallback>();

  /** Expired callbacks */
  private readonly expiredCallbacks = new Set<ExpiredCallback>();

  /** Check interval timer */
  private checkTimer?: ReturnType<typeof setInterval>;

  /** Whether the handler is running */
  private running = false;

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Create a session grant for a sensitive capability.
   */
  createSession(appId: AppId, capability: CapabilityType, options?: SessionOptions): SessionGrant {
    const now = Date.now();
    const duration =
      options?.duration ?? getDefaultSessionDuration(capability) ?? DEFAULT_SESSION_DURATION;
    const expiresAt = now + duration;

    // Create the underlying grant
    const grant = createGrant(appId, capability, {
      sessionOnly: true,
      expiresAt,
      source: 'user',
    });

    // Create session grant
    const session: SessionGrant = {
      grant,
      sessionStart: now,
      expiresAt,
      duration,
      extensionAllowed: options?.extensionAllowed ?? true,
      extensionCount: 0,
      maxExtensions: options?.maxExtensions ?? DEFAULT_MAX_EXTENSIONS,
    };

    // Store session
    if (!this.sessions.has(appId)) {
      this.sessions.set(appId, new Map());
    }
    this.sessions.get(appId)!.set(capability, {
      session,
      warningsSent: new Set(),
    });

    return session;
  }

  /**
   * Check if a session grant is still valid.
   */
  isSessionValid(session: SessionGrant): boolean {
    return Date.now() < session.expiresAt;
  }

  /**
   * Get the current session for an app and capability.
   */
  getSession(appId: AppId, capability: CapabilityType): SessionGrant | undefined {
    const appSessions = this.sessions.get(appId);
    if (!appSessions) return undefined;

    const record = appSessions.get(capability);
    if (!record) return undefined;

    // Check if expired
    if (!this.isSessionValid(record.session)) {
      this.endSession(appId, capability);
      return undefined;
    }

    return record.session;
  }

  /**
   * Get all active sessions for an app.
   */
  getActiveSessions(appId: AppId): readonly SessionGrant[] {
    const appSessions = this.sessions.get(appId);
    if (!appSessions) return [];

    const active: SessionGrant[] = [];
    for (const [capability, record] of appSessions) {
      if (this.isSessionValid(record.session)) {
        active.push(record.session);
      } else {
        // Clean up expired
        this.endSession(appId, capability);
      }
    }

    return active;
  }

  /**
   * Extend a session grant's expiration.
   */
  extendSession(session: SessionGrant, duration?: number): SessionGrant | null {
    // Check if extension is allowed
    if (!session.extensionAllowed) {
      return null;
    }

    // Check if max extensions reached
    if (session.extensionCount >= session.maxExtensions) {
      return null;
    }

    const now = Date.now();
    const extensionDuration = duration ?? session.duration;
    const newExpiresAt = now + extensionDuration;

    // Create extended session
    const extended: SessionGrant = {
      ...session,
      expiresAt: newExpiresAt,
      extensionCount: session.extensionCount + 1,
      grant: {
        ...session.grant,
        expiresAt: newExpiresAt,
      },
    };

    // Update stored session
    const appSessions = this.sessions.get(session.grant.appId);
    if (appSessions) {
      appSessions.set(session.grant.capability, {
        session: extended,
        warningsSent: new Set(), // Reset warnings for extended session
      });
    }

    return extended;
  }

  /**
   * End a session early.
   */
  endSession(appId: AppId, capability: CapabilityType): void {
    const appSessions = this.sessions.get(appId);
    if (appSessions) {
      appSessions.delete(capability);
      if (appSessions.size === 0) {
        this.sessions.delete(appId);
      }
    }
  }

  /**
   * End all sessions for an app.
   */
  endAllSessions(appId: AppId): void {
    this.sessions.delete(appId);
  }

  // ===========================================================================
  // Expiry Warnings
  // ===========================================================================

  /**
   * Subscribe to capability expiration warnings.
   */
  onCapabilityExpiring(callback: ExpiryCallback): () => void {
    this.expiryCallbacks.add(callback);
    return () => this.expiryCallbacks.delete(callback);
  }

  /**
   * Subscribe to capability expiration.
   */
  onCapabilityExpired(callback: ExpiredCallback): () => void {
    this.expiredCallbacks.add(callback);
    return () => this.expiredCallbacks.delete(callback);
  }

  /**
   * Get the remaining time for a session in milliseconds.
   */
  getRemainingTime(appId: AppId, capability: CapabilityType): number | undefined {
    const session = this.getSession(appId, capability);
    if (!session) return undefined;

    return Math.max(0, session.expiresAt - Date.now());
  }

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  /**
   * Check if a capability can be requested (not rate limited).
   */
  canRequestAgain(appId: AppId, capability: CapabilityType): RateLimitStatus {
    const key = `${appId}:${capability}`;
    const record = this.rateLimits.get(key);

    if (!record) {
      return {
        canRequest: true,
        requestCount: 0,
      };
    }

    const now = Date.now();
    const cooldownEnd = record.lastRequestAt + getRateLimitCooldown();

    if (now >= cooldownEnd) {
      // Cooldown expired
      return {
        canRequest: true,
        requestCount: record.requestCount,
      };
    }

    // Still in cooldown
    return {
      canRequest: false,
      retryAfter: cooldownEnd,
      retryInSeconds: Math.ceil((cooldownEnd - now) / 1000),
      requestCount: record.requestCount,
    };
  }

  /**
   * Record a capability request for rate limiting.
   */
  recordRequest(appId: AppId, capability: CapabilityType): void {
    const key = `${appId}:${capability}`;
    const now = Date.now();

    const existing = this.rateLimits.get(key);
    this.rateLimits.set(key, {
      lastRequestAt: now,
      requestCount: (existing?.requestCount ?? 0) + 1,
    });
  }

  /**
   * Clear rate limiting for a specific capability.
   */
  clearRateLimit(appId: AppId, capability: CapabilityType): void {
    const key = `${appId}:${capability}`;
    this.rateLimits.delete(key);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the handler (begins monitoring sessions).
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Start periodic check
    this.checkTimer = setInterval(() => {
      this.checkSessions();
    }, CHECK_INTERVAL);
  }

  /**
   * Stop the handler (stops monitoring).
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * Dispose the handler (cleanup all resources).
   */
  dispose(): void {
    this.stop();
    this.sessions.clear();
    this.rateLimits.clear();
    this.expiryCallbacks.clear();
    this.expiredCallbacks.clear();
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Check all sessions for expiry and warnings.
   */
  private checkSessions(): void {
    const now = Date.now();

    for (const [appId, appSessions] of this.sessions) {
      for (const [capability, record] of appSessions) {
        const { session, warningsSent } = record;
        const remaining = session.expiresAt - now;

        // Check if expired
        if (remaining <= 0) {
          this.endSession(appId as AppId, capability);
          this.notifyExpired(appId as AppId, capability);
          continue;
        }

        // Check warning thresholds
        for (const threshold of WARNING_THRESHOLDS) {
          const warningKey = `${threshold.level}:${threshold.ms}`;
          if (remaining <= threshold.ms && !warningsSent.has(warningKey)) {
            warningsSent.add(warningKey);
            this.notifyExpiring({
              appId: appId as AppId,
              capability,
              grant: session.grant,
              secondsRemaining: Math.ceil(remaining / 1000),
              level: threshold.level,
            });
          }
        }
      }
    }
  }

  /**
   * Notify subscribers of expiring capability.
   */
  private notifyExpiring(warning: ExpiryWarning): void {
    for (const callback of this.expiryCallbacks) {
      try {
        callback(warning);
      } catch (error) {
        console.error('[SensitiveCapabilityHandler] Expiry callback error:', error);
      }
    }
  }

  /**
   * Notify subscribers of expired capability.
   */
  private notifyExpired(appId: AppId, capability: CapabilityType): void {
    for (const callback of this.expiredCallbacks) {
      try {
        callback(appId, capability);
      } catch (error) {
        console.error('[SensitiveCapabilityHandler] Expired callback error:', error);
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new sensitive capability handler.
 */
export function createSensitiveCapabilityHandler(): SensitiveCapabilityHandler {
  return new SensitiveCapabilityHandler();
}

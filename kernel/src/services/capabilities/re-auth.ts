/**
 * Re-Authentication Integration - Platform-specific re-auth
 *
 * This file provides:
 * - IReAuthProvider interface implementation helper
 * - Platform detection for auth methods
 * - Web and Desktop re-auth adapters
 *
 * Re-authentication is required for sensitive capabilities (Tier 5):
 * - credentials:use
 * - connections:native
 * - tables:writeAll
 * - cells:writeAll
 *
 */

import type { CapabilityType } from './cap-types';
import type { AppId } from './grants';
import type { AuthMethod, IReAuthProvider, ReAuthOptions, ReAuthResult } from './sensitive';
import { requiresReAuth } from './sensitive';

// =============================================================================
// Constants
// =============================================================================

/** Default authentication timeout: 60 seconds */
const DEFAULT_AUTH_TIMEOUT = 60 * 1000;

async function raceWithAuthTimeout<T>(operation: Promise<T>, timeout: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Authentication timeout')), timeout);
    });

    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

// =============================================================================
// Re-Auth Provider Factory
// =============================================================================

/**
 * Create a re-authentication provider based on platform.
 *
 * @param platform - The current platform ('web' | 'desktop' | 'tauri')
 * @param options - Platform-specific options
 */
export function createReAuthProvider(
  platform: 'web' | 'desktop' | 'tauri',
  options?: ReAuthProviderFactoryOptions,
): IReAuthProvider {
  switch (platform) {
    case 'web':
      return new WebReAuthProvider(options?.webPasswordPrompt);
    case 'desktop':
    case 'tauri':
      return new DesktopReAuthProvider(options?.biometricPrompt, options?.desktopPasswordPrompt);
    default:
      // Fallback to web
      return new WebReAuthProvider(options?.webPasswordPrompt);
  }
}

/**
 * Factory options for creating re-auth providers.
 */
export interface ReAuthProviderFactoryOptions {
  /** Callback for web password prompt */
  webPasswordPrompt?: (reason: string) => Promise<string | null>;

  /** Callback for desktop biometric prompt */
  biometricPrompt?: (reason: string) => Promise<boolean>;

  /** Callback for desktop password prompt (fallback) */
  desktopPasswordPrompt?: (reason: string) => Promise<string | null>;
}

// =============================================================================
// Web Re-Auth Provider
// =============================================================================

/**
 * Web re-authentication provider.
 *
 * Uses password re-entry for authentication.
 */
export class WebReAuthProvider implements IReAuthProvider {
  private readonly passwordPrompt?: (reason: string) => Promise<string | null>;
  private cancelRequested = false;

  constructor(passwordPrompt?: (reason: string) => Promise<string | null>) {
    this.passwordPrompt = passwordPrompt;
  }

  isAvailable(): boolean {
    return !!this.passwordPrompt;
  }

  getAvailableMethods(): readonly AuthMethod[] {
    return ['password'];
  }

  isMethodAvailable(method: AuthMethod): boolean {
    return method === 'password' && !!this.passwordPrompt;
  }

  async authenticate(options: ReAuthOptions): Promise<ReAuthResult> {
    this.cancelRequested = false;

    if (!this.passwordPrompt) {
      return {
        success: false,
        method: 'password',
        error: 'Password prompt not configured',
        timestamp: Date.now(),
      };
    }

    const timeout = options.timeout ?? DEFAULT_AUTH_TIMEOUT;

    try {
      // Race prompt against timeout
      const password = await raceWithAuthTimeout(this.passwordPrompt(options.reason), timeout);

      if (this.cancelRequested) {
        return {
          success: false,
          method: 'password',
          error: 'Authentication cancelled',
          timestamp: Date.now(),
        };
      }

      if (password === null) {
        return {
          success: false,
          method: 'password',
          error: 'User cancelled',
          timestamp: Date.now(),
        };
      }

      // In a real implementation, we would verify the password
      // For now, we assume any non-null password is valid
      // The actual verification happens on the server side
      return {
        success: true,
        method: 'password',
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        method: 'password',
        error: error instanceof Error ? error.message : 'Authentication failed',
        timestamp: Date.now(),
      };
    }
  }

  cancel(): void {
    this.cancelRequested = true;
  }
}

// =============================================================================
// Desktop Re-Auth Provider
// =============================================================================

/**
 * Desktop re-authentication provider.
 *
 * Uses biometric authentication (Touch ID, Windows Hello) with password fallback.
 */
export class DesktopReAuthProvider implements IReAuthProvider {
  private readonly biometricPrompt?: (reason: string) => Promise<boolean>;
  private readonly passwordPrompt?: (reason: string) => Promise<string | null>;
  private cancelRequested = false;

  constructor(
    biometricPrompt?: (reason: string) => Promise<boolean>,
    passwordPrompt?: (reason: string) => Promise<string | null>,
  ) {
    this.biometricPrompt = biometricPrompt;
    this.passwordPrompt = passwordPrompt;
  }

  isAvailable(): boolean {
    return !!this.biometricPrompt || !!this.passwordPrompt;
  }

  getAvailableMethods(): readonly AuthMethod[] {
    const methods: AuthMethod[] = [];
    if (this.biometricPrompt) methods.push('biometric');
    if (this.passwordPrompt) methods.push('password');
    return methods;
  }

  isMethodAvailable(method: AuthMethod): boolean {
    if (method === 'biometric') return !!this.biometricPrompt;
    if (method === 'password') return !!this.passwordPrompt;
    return false;
  }

  async authenticate(options: ReAuthOptions): Promise<ReAuthResult> {
    this.cancelRequested = false;

    const timeout = options.timeout ?? DEFAULT_AUTH_TIMEOUT;

    // Determine which method to use
    const preferredMethod = options.preferredMethod ?? 'biometric';
    const fallbackMethod = options.fallbackMethod ?? 'password';

    // Try preferred method first
    if (this.isMethodAvailable(preferredMethod)) {
      const result = await this.tryMethod(preferredMethod, options.reason, timeout);
      if (result.success || this.cancelRequested) {
        return result;
      }
    }

    // Try fallback method
    if (this.isMethodAvailable(fallbackMethod) && fallbackMethod !== preferredMethod) {
      return this.tryMethod(fallbackMethod, options.reason, timeout);
    }

    return {
      success: false,
      method: preferredMethod,
      error: 'No authentication method available',
      timestamp: Date.now(),
    };
  }

  cancel(): void {
    this.cancelRequested = true;
  }

  private async tryMethod(
    method: AuthMethod,
    reason: string,
    timeout: number,
  ): Promise<ReAuthResult> {
    try {
      if (method === 'biometric' && this.biometricPrompt) {
        const success = await raceWithAuthTimeout(this.biometricPrompt(reason), timeout);

        if (this.cancelRequested) {
          return {
            success: false,
            method: 'biometric',
            error: 'Authentication cancelled',
            timestamp: Date.now(),
          };
        }

        return {
          success: !!success,
          method: 'biometric',
          error: success ? undefined : 'Biometric authentication failed',
          timestamp: Date.now(),
        };
      }

      if (method === 'password' && this.passwordPrompt) {
        const password = await raceWithAuthTimeout(this.passwordPrompt(reason), timeout);

        if (this.cancelRequested) {
          return {
            success: false,
            method: 'password',
            error: 'Authentication cancelled',
            timestamp: Date.now(),
          };
        }

        return {
          success: password !== null,
          method: 'password',
          error: password === null ? 'User cancelled' : undefined,
          timestamp: Date.now(),
        };
      }

      return {
        success: false,
        method,
        error: `Method ${method} not available`,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        method,
        error: error instanceof Error ? error.message : 'Authentication failed',
        timestamp: Date.now(),
      };
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Require re-authentication for a capability.
 *
 * This is a convenience function that:
 * 1. Checks if the capability requires re-auth
 * 2. Calls the provider if needed
 * 3. Returns the result
 *
 * @param capability - The capability being requested
 * @param provider - The re-auth provider
 * @param appId - The app requesting the capability
 * @param reason - User-facing reason
 * @returns True if authenticated (or not required), false if failed
 */
export async function requireReAuthentication(
  capability: CapabilityType,
  provider: IReAuthProvider,
  appId: AppId,
  reason: string,
): Promise<{ authenticated: boolean; error?: string }> {
  // Check if this capability requires re-auth
  if (!requiresReAuth(capability)) {
    return { authenticated: true };
  }

  // Check if provider is available
  if (!provider.isAvailable()) {
    return {
      authenticated: false,
      error: 'Re-authentication not available on this platform',
    };
  }

  // Perform authentication
  const result = await provider.authenticate({
    capability,
    appId,
    reason,
  });

  return {
    authenticated: result.success,
    error: result.error,
  };
}

/**
 * Noop re-auth provider for testing.
 *
 * Always succeeds without prompting.
 */
export class NoopReAuthProvider implements IReAuthProvider {
  isAvailable(): boolean {
    return true;
  }

  getAvailableMethods(): readonly AuthMethod[] {
    return ['password'];
  }

  isMethodAvailable(): boolean {
    return true;
  }

  async authenticate(_options: ReAuthOptions): Promise<ReAuthResult> {
    return {
      success: true,
      method: 'password',
      timestamp: Date.now(),
    };
  }

  cancel(): void {
    // Noop
  }
}

/**
 * Create a noop re-auth provider for testing.
 */
export function createNoopReAuthProvider(): IReAuthProvider {
  return new NoopReAuthProvider();
}

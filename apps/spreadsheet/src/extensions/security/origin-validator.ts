/**
 * Origin Validator
 *
 * Validates message origins for cross-origin extension communication.
 * Provides strict allowlist-based validation with development mode support.
 *
 * SECURITY CRITICAL: This module is the first line of defense against
 * malicious messages from untrusted origins.
 *
 * @module extensions/security/origin-validator
 */

import { DEV_EXTENSION_ORIGINS, EXTENSION_ORIGIN_PRODUCTION, isDev } from '../constants';

// =============================================================================
// Types
// =============================================================================

export interface OriginValidationResult {
  /** Whether the origin is valid */
  valid: boolean;
  /** Reason for rejection (if invalid) */
  reason?: string;
  /** Whether this is a development origin */
  isDevelopment?: boolean;
}

// =============================================================================
// Trusted Origins
// =============================================================================

/**
 * Set of trusted extension origins.
 * Built dynamically based on environment.
 */
function getTrustedOrigins(): Set<string> {
  const origins = new Set<string>();

  // Always trust production origin
  origins.add(EXTENSION_ORIGIN_PRODUCTION);

  // In development, also trust localhost origins
  if (isDev()) {
    for (const origin of DEV_EXTENSION_ORIGINS) {
      origins.add(origin);
    }
  }

  return origins;
}

// Cache trusted origins (rebuilt on isDev change in tests)
let cachedTrustedOrigins: Set<string> | null = null;
let cachedIsDev: boolean | null = null;

function getOrCreateTrustedOrigins(): Set<string> {
  const currentIsDev = isDev();
  if (cachedTrustedOrigins === null || cachedIsDev !== currentIsDev) {
    cachedTrustedOrigins = getTrustedOrigins();
    cachedIsDev = currentIsDev;
  }
  return cachedTrustedOrigins;
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate if an origin is in the trusted extension origins allowlist.
 *
 * @param origin - The origin to validate (e.g., from MessageEvent.origin)
 * @returns Validation result with details
 *
 * @example
 * ```ts
 * const result = validateExtensionOrigin('https://extensions.shortcut.io');
 * if (result.valid) {
 * // Process message
 * } else {
 * console.warn('Rejected:', result.reason);
 * }
 * ```
 */
export function validateExtensionOrigin(origin: string): OriginValidationResult {
  // Null/undefined check
  if (!origin) {
    return {
      valid: false,
      reason: 'Origin is empty or undefined',
    };
  }

  // Type check
  if (typeof origin !== 'string') {
    return {
      valid: false,
      reason: 'Origin must be a string',
    };
  }

  // Normalize origin (remove trailing slash if any)
  const normalizedOrigin = origin.replace(/\/$/, '');

  // Check against trusted origins
  const trustedOrigins = getOrCreateTrustedOrigins();

  if (trustedOrigins.has(normalizedOrigin)) {
    // Check if it's a development origin
    const isDevOrigin = DEV_EXTENSION_ORIGINS.some((devOrigin) => devOrigin === normalizedOrigin);

    return {
      valid: true,
      isDevelopment: isDevOrigin,
    };
  }

  // Check if it looks like a development origin but we're in production
  if (!isDev()) {
    const looksLikeDev = DEV_EXTENSION_ORIGINS.some((devOrigin) => devOrigin === normalizedOrigin);
    if (looksLikeDev) {
      return {
        valid: false,
        reason:
          'Development origins are not allowed in production. ' +
          'Expected: ' +
          EXTENSION_ORIGIN_PRODUCTION,
      };
    }
  }

  // Unknown origin
  return {
    valid: false,
    reason: `Origin "${normalizedOrigin}" is not in the trusted origins allowlist`,
  };
}

/**
 * Simple boolean check for origin validity.
 * Use validateExtensionOrigin() for detailed error information.
 *
 * @param origin - The origin to validate
 * @returns true if origin is trusted
 */
export function isValidExtensionOrigin(origin: string): boolean {
  return validateExtensionOrigin(origin).valid;
}

/**
 * Validate the host origin (for extension-side validation).
 * Extensions should validate that messages come from the expected host.
 *
 * @param origin - The origin to validate
 * @param expectedHostOrigin - The expected host origin
 * @returns Validation result
 */
export function validateHostOrigin(
  origin: string,
  expectedHostOrigin: string,
): OriginValidationResult {
  if (!origin) {
    return {
      valid: false,
      reason: 'Origin is empty or undefined',
    };
  }

  if (!expectedHostOrigin) {
    return {
      valid: false,
      reason: 'Expected host origin not configured',
    };
  }

  // Normalize both origins
  const normalizedOrigin = origin.replace(/\/$/, '');
  const normalizedExpected = expectedHostOrigin.replace(/\/$/, '');

  if (normalizedOrigin === normalizedExpected) {
    return { valid: true };
  }

  // In development, also allow localhost variations
  if (isDev()) {
    const localhostPatterns = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/];

    const originIsLocalhost = localhostPatterns.some((p) => p.test(normalizedOrigin));
    const expectedIsLocalhost = localhostPatterns.some((p) => p.test(normalizedExpected));

    if (originIsLocalhost && expectedIsLocalhost) {
      return {
        valid: true,
        isDevelopment: true,
      };
    }
  }

  return {
    valid: false,
    reason: `Origin "${normalizedOrigin}" does not match expected host "${normalizedExpected}"`,
  };
}

/**
 * Get list of trusted origins (for debugging/logging).
 * Returns a copy to prevent mutation.
 */
export function getTrustedOriginsList(): string[] {
  return Array.from(getOrCreateTrustedOrigins());
}

/**
 * Clear the cached trusted origins.
 * Only useful for testing when isDev() changes.
 */
export function clearOriginCache(): void {
  cachedTrustedOrigins = null;
  cachedIsDev = null;
}

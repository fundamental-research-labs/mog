/**
 * Scoped Network API
 *
 * Creates a capability-gated wrapper for network operations.
 *
 * CRITICAL SECURITY:
 * - network:localhost is SEPARATE from network:any
 * - network:any does NOT grant localhost access
 * - Domain matching must be strict (no embedded domain attacks)
 */

import { CapabilityDeniedError } from '../../../errors/capability';
import type { IGatedNetworkAPI } from '../../../services/capabilities/gated-api';
import { domainMatches } from '../../../services/capabilities/scope';

import type { CapabilityGatedAPIOptions, ScopedAPIContext } from './types';

/**
 * Parse a URL and extract its host.
 */
function parseUrlHost(url: string): { host: string; isLocalhost: boolean } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLocalhost =
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
    return { host, isLocalhost };
  } catch {
    return null;
  }
}

/**
 * Create a scoped network API that enforces capability restrictions.
 *
 * @param context - The scoped API context
 * @param options - The gated API options (includes allowlist)
 * @returns A network API with restricted fetch, or undefined
 */
export function createScopedNetworkAPI(
  context: ScopedAPIContext,
  options: CapabilityGatedAPIOptions,
): IGatedNetworkAPI | undefined {
  const hasSameOrigin = context.hasCapability('network:sameorigin');
  const hasAllowlist = context.hasCapability('network:allowlist');
  const hasLocalhost = context.hasCapability('network:localhost');
  const hasAny = context.hasCapability('network:any');

  // If no network capabilities, return undefined
  if (!hasSameOrigin && !hasAllowlist && !hasLocalhost && !hasAny) {
    return undefined;
  }

  // Get the current origin for same-origin checks
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : null;

  /**
   * Check if a URL is allowed based on granted capabilities.
   */
  function isUrlAllowed(url: string): { allowed: boolean; reason?: string } {
    const parsed = parseUrlHost(url);
    if (!parsed) {
      return { allowed: false, reason: 'Invalid URL' };
    }

    const { host, isLocalhost } = parsed;

    // CRITICAL: Localhost requires network:localhost
    // network:any does NOT grant localhost access
    if (isLocalhost) {
      if (hasLocalhost) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Localhost access requires network:localhost capability',
      };
    }

    // network:any grants access to any remote URL (but not localhost)
    if (hasAny) {
      return { allowed: true };
    }

    // Check allowlist
    if (hasAllowlist && options.allowedDomains) {
      for (const pattern of options.allowedDomains) {
        if (domainMatches(pattern, host)) {
          return { allowed: true };
        }
      }
    }

    // Check same-origin
    if (hasSameOrigin && currentOrigin) {
      try {
        const urlOrigin = new URL(url).origin;
        if (urlOrigin === currentOrigin) {
          return { allowed: true };
        }
      } catch {
        // Invalid URL
      }
    }

    return {
      allowed: false,
      reason: `Access to ${host} not allowed by granted network capabilities`,
    };
  }

  // Build the API object with only the methods for granted capabilities
  return {
    // fetch is available if any network capability is granted
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      const check = isUrlAllowed(url);
      if (!check.allowed) {
        // Determine which capability to report as missing
        const parsed = parseUrlHost(url);
        const capability = parsed?.isLocalhost ? 'network:localhost' : 'network:any';
        throw new CapabilityDeniedError(context.appId, capability, {
          operation: `fetch ${url}`,
        });
      }

      // Use native fetch
      return fetch(url, init);
    },

    // getAllowedDomains is available if network:allowlist is granted
    ...(hasAllowlist && {
      getAllowedDomains: (): string[] => {
        return [...(options.allowedDomains ?? [])];
      },
    }),

    // requestDomain is available if network:allowlist is granted
    ...(hasAllowlist &&
      options.requestDomainApproval && {
        requestDomain: async (domain: string, reason: string): Promise<boolean> => {
          return options.requestDomainApproval!(domain, reason);
        },
      }),
  };
}

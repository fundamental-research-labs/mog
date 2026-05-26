/**
 * Resource Provider Registry — maps resource kinds to providers.
 *
 * Deterministic owner selection (first-registered wins). Core reserved
 * kinds (`mog.resource.workspace`, `mog.resource.settings`) can only be
 * registered by the `mog.core` package.  Fail-closed: a missing or
 * disabled provider returns `undefined`, never falls back.
 *
 */

import type { AccessMode, ResourceRef } from './types';

// ============================================================
// Public interfaces
// ============================================================

export interface ResourceProviderRegistration {
  readonly resourceKind: string;
  readonly ownerPackageId: string;
  readonly routePattern?: string;
  readonly supportedAccessModes: readonly AccessMode[];
}

export interface IResourceProviderRegistry {
  registerProvider(registration: ResourceProviderRegistration): void;
  unregisterProvider(resourceKind: string, ownerPackageId: string): void;
  getProvider(resourceKind: string): ResourceProviderRegistration | undefined;
  resolveRoute(
    path: string,
  ): { provider: ResourceProviderRegistration; resourceRef: ResourceRef } | undefined;
  listProviders(): readonly ResourceProviderRegistration[];
}

// ============================================================
// Reserved kinds
// ============================================================

const CORE_RESERVED_KINDS = new Set(['mog.resource.workspace', 'mog.resource.settings']);

const CORE_PACKAGE_ID = 'mog.core';

// ============================================================
// Implementation
// ============================================================

export function createResourceProviderRegistry(): IResourceProviderRegistry {
  /** kind → registration (first-registered wins) */
  const providers = new Map<string, ResourceProviderRegistration>();

  /**
   * Validate that the package can register under the given resource kind
   * namespace. A kind like `com.acme.foo` is owned by the `com.acme` prefix;
   * the registering package must share that prefix. Core reserved kinds are
   * restricted to `mog.core`.
   */
  function validateNamespace(kind: string, ownerPackageId: string): void {
    if (CORE_RESERVED_KINDS.has(kind) && ownerPackageId !== CORE_PACKAGE_ID) {
      throw new Error(
        `Resource kind "${kind}" is reserved for core. ` +
          `Package "${ownerPackageId}" cannot register it.`,
      );
    }

    // Non-reserved kinds: the kind must start with the package's namespace
    // prefix (everything up to the last dot segment of the package ID).
    // e.g. package "mog.spreadsheet" can register "mog.spreadsheet.workbook"
    // but not "mog.other.thing".
    if (!CORE_RESERVED_KINDS.has(kind)) {
      const kindPrefix = kind.split('.').slice(0, -1).join('.');
      // The kind's namespace prefix must start with the owner's package ID
      // OR the owner must be core (core can register anything).
      if (ownerPackageId !== CORE_PACKAGE_ID && !kindPrefix.startsWith(ownerPackageId)) {
        throw new Error(
          `Package "${ownerPackageId}" cannot register kind "${kind}": ` +
            `namespace mismatch (expected prefix "${ownerPackageId}").`,
        );
      }
    }
  }

  return {
    registerProvider(registration: ResourceProviderRegistration): void {
      const { resourceKind, ownerPackageId } = registration;

      validateNamespace(resourceKind, ownerPackageId);

      if (providers.has(resourceKind)) {
        throw new Error(
          `Resource kind "${resourceKind}" is already registered by ` +
            `"${providers.get(resourceKind)!.ownerPackageId}". ` +
            `Unregister it first to replace.`,
        );
      }

      providers.set(resourceKind, registration);
    },

    unregisterProvider(resourceKind: string, ownerPackageId: string): void {
      const existing = providers.get(resourceKind);
      if (!existing) return;
      if (existing.ownerPackageId !== ownerPackageId) {
        throw new Error(
          `Package "${ownerPackageId}" cannot unregister kind "${resourceKind}" ` +
            `owned by "${existing.ownerPackageId}".`,
        );
      }
      providers.delete(resourceKind);
    },

    getProvider(resourceKind: string): ResourceProviderRegistration | undefined {
      return providers.get(resourceKind);
    },

    resolveRoute(
      path: string,
    ): { provider: ResourceProviderRegistration; resourceRef: ResourceRef } | undefined {
      // Walk registered providers and try to match the route pattern.
      // Route patterns are simple prefix matches for current implementation:
      //   pattern "/workbook/:id" matches path "/workbook/abc123"
      for (const registration of providers.values()) {
        if (!registration.routePattern) continue;

        const match = matchRoutePattern(registration.routePattern, path);
        if (match) {
          return {
            provider: registration,
            resourceRef: {
              kind: registration.resourceKind,
              id: match.id ?? path,
            },
          };
        }
      }
      return undefined;
    },

    listProviders(): readonly ResourceProviderRegistration[] {
      return Array.from(providers.values());
    },
  };
}

// ============================================================
// Route matching (simple prefix + :id capture for current implementation)
// ============================================================

function matchRoutePattern(pattern: string, path: string): { id?: string } | null {
  // Split both into segments
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (pathParts.length < patternParts.length) return null;

  let id: string | undefined;

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const pathPart = pathParts[i];

    if (pp.startsWith(':')) {
      // Capture parameter
      if (pp === ':id') id = pathPart;
    } else if (pp !== pathPart) {
      return null;
    }
  }

  return { id };
}

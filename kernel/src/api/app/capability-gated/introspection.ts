/**
 * Capability Introspection Implementation
 *
 * Provides the ICapabilityIntrospection interface that allows apps
 * to introspect their granted capabilities.
 */

import type { CapabilityType } from '../../../services/capabilities/cap-types';
import type { ICapabilityIntrospection } from '../../../services/capabilities/gated-api';
import type { CapabilityScope } from '../../../services/capabilities/scope';
import { scopeMatches } from '../../../services/capabilities/scope';

import type { CapabilityGatedAPIOptions, ScopedAPIContext } from './types';

/**
 * Create a capability introspection implementation.
 */
export function createCapabilityIntrospection(
  context: ScopedAPIContext,
  options: CapabilityGatedAPIOptions,
): ICapabilityIntrospection {
  // Track onChange subscribers
  const changeSubscribers = new Set<(capabilities: CapabilityType[]) => void>();
  const expiringSubscribers = new Set<(capability: CapabilityType, expiresInMs: number) => void>();

  // Subscribe to registry changes
  // Note: We intentionally capture this subscription but don't use it yet
  // because there's no cleanup mechanism in ICapabilityIntrospection.
  // The subscription keeps event listeners alive for the lifetime of the API.
  void options.registry.subscribeToApp(options.appId, () => {
    const capabilities = options.registry.getEffectiveCapabilities(options.appId);
    for (const subscriber of changeSubscribers) {
      try {
        subscriber(capabilities);
      } catch (error) {
        console.error('[CapabilityIntrospection] onChange handler error:', error);
      }
    }
  });

  // Forward expiring notifications
  if (options.onCapabilityExpiring) {
    const originalHandler = options.onCapabilityExpiring;
    expiringSubscribers.add((cap, ms) => originalHandler(cap, ms));
  }

  return {
    has(capability: CapabilityType): boolean {
      return context.hasCapability(capability);
    },

    list(): CapabilityType[] {
      return options.registry.getEffectiveCapabilities(options.appId);
    },

    isScoped(capability: CapabilityType): boolean {
      return options.registry.isCapabilityScoped(options.appId, capability);
    },

    getScope(capability: CapabilityType): CapabilityScope | null {
      return context.getScope(capability);
    },

    hasAccessTo(capability: CapabilityType, resourceType: string, resourceId: string): boolean {
      return context.hasCapability(capability, { resourceType, resourceId });
    },

    async request(capability: CapabilityType, reason: string): Promise<boolean> {
      if (options.requestCapability) {
        return options.requestCapability(capability, reason);
      }
      // If no request handler, the capability cannot be requested at runtime
      return false;
    },

    onChange(callback: (capabilities: CapabilityType[]) => void): () => void {
      changeSubscribers.add(callback);
      return () => {
        changeSubscribers.delete(callback);
      };
    },

    onExpiring(callback: (capability: CapabilityType, expiresInMs: number) => void): () => void {
      expiringSubscribers.add(callback);
      return () => {
        expiringSubscribers.delete(callback);
      };
    },
  };
}

/**
 * Create a scoped API context from options.
 */
export function createScopedAPIContext(options: CapabilityGatedAPIOptions): ScopedAPIContext {
  const { appId, registry } = options;

  return {
    appId,
    registry,

    getScope(capability: CapabilityType): CapabilityScope | null {
      return registry.getCapabilityScope(appId, capability);
    },

    hasCapability(
      capability: CapabilityType,
      scope?: { resourceType: string; resourceId: string },
    ): boolean {
      // First check if the app has the capability at all
      if (!registry.hasCapability(appId, capability)) {
        return false;
      }

      // If no scope check requested, we're done
      if (!scope) {
        return true;
      }

      // Check if the grant is scoped
      const grantScope = registry.getCapabilityScope(appId, capability);
      if (!grantScope) {
        // Unscoped grant = full access
        return true;
      }

      // Check if the resource is within scope
      return scopeMatches(grantScope, scope.resourceType, scope.resourceId);
    },

    logAccess(capability: CapabilityType, operation: string): void {
      // This would log to the audit logger if available
      // For now, we rely on the registry's internal logging
      void capability;
      void operation;
    },
  };
}

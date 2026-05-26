/**
 * Capability Errors — KernelError subclasses for capability-related failures
 *
 * Capability errors for the unified kernel error system.
 *
 */

import { KernelError, type KernelErrorOptions } from './kernel-error';
import type { CapabilityType } from '../services/capabilities/cap-types';
import type { CapabilityScope } from '../services/capabilities/scope-types';
import type { KernelErrorCode } from './codes';

// =============================================================================
// Base Capability Error
// =============================================================================

/**
 * Base error class for capability-related errors.
 * Extends KernelError with appId, capability, and timestamp fields.
 */
export class CapabilityError extends KernelError {
  readonly appId: string;
  readonly capability: CapabilityType;
  readonly timestamp: number;

  constructor(
    code: KernelErrorCode,
    message: string,
    appId: string,
    capability: CapabilityType,
    options?: KernelErrorOptions,
  ) {
    super(code, message, { ...options, context: { ...options?.context, appId, capability } });
    this.name = 'CapabilityError';
    this.appId = appId;
    this.capability = capability;
    this.timestamp = Date.now();
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      appId: this.appId,
      capability: this.capability,
      timestamp: this.timestamp,
    };
  }
}

// =============================================================================
// Capability Denied Error
// =============================================================================

/**
 * Error thrown when an app attempts to use a capability it doesn't have.
 */
export class CapabilityDeniedError extends CapabilityError {
  /** The operation that was attempted */
  readonly operation?: string;

  /** Whether this was a runtime request that was denied */
  readonly wasDenied: boolean;

  /** Suggestion for how to fix */
  readonly suggestion: string;

  constructor(
    appId: string,
    capability: CapabilityType,
    options?: {
      operation?: string;
      wasDenied?: boolean;
    },
  ) {
    const operation = options?.operation;
    const message = operation
      ? `App "${appId}" does not have capability "${capability}" required for operation "${operation}"`
      : `App "${appId}" does not have capability "${capability}"`;

    super('CAP_DENIED', message, appId, capability, {
      suggestion: options?.wasDenied
        ? `The user denied this permission. Request it again with a clear explanation of why it's needed.`
        : `Add "${capability}" to your app manifest's required or optional capabilities.`,
    });
    this.name = 'CapabilityDeniedError';
    this.operation = operation;
    this.wasDenied = options?.wasDenied ?? false;
    this.suggestion = options?.wasDenied
      ? `The user denied this permission. Request it again with a clear explanation of why it's needed.`
      : `Add "${capability}" to your app manifest's required or optional capabilities.`;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      operation: this.operation,
      wasDenied: this.wasDenied,
      suggestion: this.suggestion,
    };
  }
}

// =============================================================================
// Capability Scope Error
// =============================================================================

/**
 * Error thrown when an app tries to access a resource outside its granted scope.
 */
export class CapabilityScopeError extends CapabilityError {
  /** The resource type being accessed */
  readonly resourceType: string;

  /** The resource ID being accessed */
  readonly resourceId: string;

  /** The granted scope that was violated */
  readonly grantedScope: CapabilityScope;

  /** Suggestion for how to fix */
  readonly suggestion: string;

  constructor(
    appId: string,
    capability: CapabilityType,
    resourceType: string,
    resourceId: string,
    grantedScope: CapabilityScope,
  ) {
    const scopeDesc =
      grantedScope != null ? `scoped to "${grantedScope}"` : 'not scoped for this resource';
    const message =
      `App "${appId}" has capability "${capability}" but it is ${scopeDesc}. ` +
      `Access to ${resourceType}:${resourceId} is not allowed.`;

    super('CAP_SCOPE_MISMATCH', message, appId, capability, {
      suggestion: `Request access to "${resourceType}:${resourceId}" in your app manifest's scoped capabilities.`,
    });
    this.name = 'CapabilityScopeError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
    this.grantedScope = grantedScope;
    this.suggestion = `Request access to "${resourceType}:${resourceId}" in your app manifest's scoped capabilities.`;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      grantedScope: this.grantedScope,
      suggestion: this.suggestion,
    };
  }
}

// =============================================================================
// Capability Expired Error
// =============================================================================

/**
 * Error thrown when a session-only capability has expired.
 */
export class CapabilityExpiredError extends CapabilityError {
  /** When the capability expired */
  readonly expiredAt: number;

  /** Suggestion for how to fix */
  readonly suggestion: string;

  constructor(appId: string, capability: CapabilityType, expiredAt: number) {
    const message = `Capability "${capability}" for app "${appId}" has expired`;
    super('CAP_EXPIRED', message, appId, capability, {
      suggestion: `Re-authenticate to renew the "${capability}" capability.`,
    });
    this.name = 'CapabilityExpiredError';
    this.expiredAt = expiredAt;
    this.suggestion = `Re-authenticate to renew the "${capability}" capability.`;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      expiredAt: this.expiredAt,
      suggestion: this.suggestion,
    };
  }
}

// =============================================================================
// Capability Requires Auth Error
// =============================================================================

/**
 * Error thrown when a capability requires re-authentication.
 */
export class CapabilityRequiresAuthError extends CapabilityError {
  /** What type of authentication is required */
  readonly authType: 'password' | 'biometric';

  /** Suggestion for how to fix */
  readonly suggestion: string;

  constructor(
    appId: string,
    capability: CapabilityType,
    authType: 'password' | 'biometric' = 'password',
  ) {
    const message = `Capability "${capability}" requires ${authType} authentication`;
    super('CAP_REQUIRES_AUTH', message, appId, capability, {
      suggestion: `Authenticate using ${authType} to grant the "${capability}" capability.`,
    });
    this.name = 'CapabilityRequiresAuthError';
    this.authType = authType;
    this.suggestion = `Authenticate using ${authType} to grant the "${capability}" capability.`;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      authType: this.authType,
      suggestion: this.suggestion,
    };
  }
}

// =============================================================================
// Invalid Scope Error (extends KernelError directly)
// =============================================================================

/**
 * Error thrown when a scope string is invalid.
 */
export class InvalidScopeError extends KernelError {
  /** The invalid scope string */
  readonly scope: string;

  /** Suggestion for how to fix */
  readonly suggestion: string;

  constructor(scope: string, reason: string) {
    super('CAP_INVALID_SCOPE', `Invalid scope "${scope}": ${reason}`, {
      context: { scope },
      suggestion: `Use format "type:pattern" (e.g., "table:contacts" or "table:sales_*")`,
    });
    this.name = 'InvalidScopeError';
    this.scope = scope;
    this.suggestion = `Use format "type:pattern" (e.g., "table:contacts" or "table:sales_*")`;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      scope: this.scope,
      suggestion: this.suggestion,
    };
  }
}

// =============================================================================
// Unbounded Wildcard Error (extends KernelError directly)
// =============================================================================

/**
 * Error thrown when an unbounded wildcard scope is used without the required
 * allXxx capability.
 */
export class UnboundedWildcardError extends KernelError {
  /** The resource type with unbounded wildcard */
  readonly resourceType: string;

  /** The capability required for unbounded access */
  readonly requiredCapability: CapabilityType;

  /** Suggestion for how to fix */
  readonly suggestion: string;

  constructor(resourceType: string, requiredCapability: CapabilityType) {
    const message =
      `Unbounded wildcard "${resourceType}:*" requires "${requiredCapability}" capability. ` +
      `Use a prefixed pattern like "${resourceType}:prefix_*" instead.`;

    super('CAP_UNBOUNDED_WILDCARD', message, {
      context: { resourceType, requiredCapability },
      suggestion: `Either request "${requiredCapability}" capability or use a prefixed pattern like "${resourceType}:prefix_*"`,
    });
    this.name = 'UnboundedWildcardError';
    this.resourceType = resourceType;
    this.requiredCapability = requiredCapability;
    this.suggestion = `Either request "${requiredCapability}" capability or use a prefixed pattern like "${resourceType}:prefix_*"`;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      resourceType: this.resourceType,
      requiredCapability: this.requiredCapability,
      suggestion: this.suggestion,
    };
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/** Check if an error is a CapabilityError (or any subclass). */
export function isCapabilityError(error: unknown): error is CapabilityError {
  return error instanceof CapabilityError;
}

/** Check if an error is a CapabilityDeniedError. */
export function isCapabilityDeniedError(error: unknown): error is CapabilityDeniedError {
  return error instanceof CapabilityDeniedError;
}

/** Check if an error is a CapabilityScopeError. */
export function isCapabilityScopeError(error: unknown): error is CapabilityScopeError {
  return error instanceof CapabilityScopeError;
}

/** Check if an error is a CapabilityExpiredError. */
export function isCapabilityExpiredError(error: unknown): error is CapabilityExpiredError {
  return error instanceof CapabilityExpiredError;
}

/** Check if an error is a CapabilityRequiresAuthError. */
export function isCapabilityRequiresAuthError(
  error: unknown,
): error is CapabilityRequiresAuthError {
  return error instanceof CapabilityRequiresAuthError;
}

/** Check if an error is an InvalidScopeError. */
export function isInvalidScopeError(error: unknown): error is InvalidScopeError {
  return error instanceof InvalidScopeError;
}

/** Check if an error is an UnboundedWildcardError. */
export function isUnboundedWildcardError(error: unknown): error is UnboundedWildcardError {
  return error instanceof UnboundedWildcardError;
}

// =============================================================================
// Factory Functions
// =============================================================================

/** Create a CapabilityDeniedError for a specific operation. */
export function capabilityDenied(
  appId: string,
  capability: CapabilityType,
  operation?: string,
): CapabilityDeniedError {
  return new CapabilityDeniedError(appId, capability, { operation });
}

/** Create a CapabilityScopeError for an out-of-scope access. */
export function scopeMismatch(
  appId: string,
  capability: CapabilityType,
  resourceType: string,
  resourceId: string,
  grantedScope: CapabilityScope,
): CapabilityScopeError {
  return new CapabilityScopeError(appId, capability, resourceType, resourceId, grantedScope);
}

/** Create a CapabilityExpiredError. */
export function capabilityExpired(
  appId: string,
  capability: CapabilityType,
  expiredAt: number,
): CapabilityExpiredError {
  return new CapabilityExpiredError(appId, capability, expiredAt);
}

/** Create a CapabilityRequiresAuthError. */
export function authRequired(
  appId: string,
  capability: CapabilityType,
  authType: 'password' | 'biometric' = 'password',
): CapabilityRequiresAuthError {
  return new CapabilityRequiresAuthError(appId, capability, authType);
}

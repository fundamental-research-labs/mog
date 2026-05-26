/**
 * Capability-Gated API Types
 *
 * Internal types for the capability-gated API implementation.
 */

import type { CapabilityType } from '../../../services/capabilities/cap-types';
import type {
  ICapabilityIntrospection,
  IGatedAppKernelAPI,
} from '../../../services/capabilities/gated-api';
import type { AppId } from '../../../services/capabilities/grants';
import type { CapabilityScope } from '../../../services/capabilities/scope';

import type { ICapabilityRegistry } from '../../../services/capabilities/types';

/**
 * Options for creating a capability-gated API.
 */
export interface CapabilityGatedAPIOptions {
  /** The app ID receiving the gated API */
  readonly appId: AppId;

  /** The capability registry for checking grants */
  readonly registry: ICapabilityRegistry;

  /** Callback for requesting capabilities at runtime */
  readonly requestCapability?: (capability: CapabilityType, reason: string) => Promise<boolean>;

  /** Callback when capabilities change */
  readonly onCapabilitiesChange?: (capabilities: CapabilityType[]) => void;

  /** Callback when a capability is about to expire */
  readonly onCapabilityExpiring?: (capability: CapabilityType, expiresInMs: number) => void;

  /** Network domain allowlist (for network:allowlist capability) */
  readonly allowedDomains?: readonly string[];

  /** Callback for requesting domain approval */
  readonly requestDomainApproval?: (domain: string, reason: string) => Promise<boolean>;

  /**
   * Managed table IDs from app manifest.
   *
   * When provided, this is a Set of table IDs that the app has declared in its
   * manifest.managedTables array. These tables are "owned" by the app.
   *
   * Purpose:
   * - Auto-scopes ALL table-related APIs (tables, columns, records, relations, events)
   *   to ONLY these table IDs
   * - Enables apps to have tables:readwrite access to their OWN tables without
   *   requiring tables:create capability
   * - Table ID checking takes precedence over name-based scope checking
   *
   * Security model:
   * - Apps cannot access tables outside this set, even with broad scopes
   * - Unknown table IDs are treated as inaccessible (return null/empty)
   * - This prevents apps from accidentally accessing user's other tables
   */
  readonly managedTableIds?: ReadonlySet<string>;
}

/**
 * Context passed to scoped API wrappers.
 */
export interface ScopedAPIContext {
  /** The app ID */
  readonly appId: AppId;

  /** The capability registry */
  readonly registry: ICapabilityRegistry;

  /** Get the scope for a capability */
  getScope(capability: CapabilityType): CapabilityScope | null;

  /** Check if app has capability with optional scope check */
  hasCapability(
    capability: CapabilityType,
    scope?: { resourceType: string; resourceId: string },
  ): boolean;

  /** Log a capability check (for audit) */
  logAccess(capability: CapabilityType, operation: string): void;
}

/**
 * Batch operation for validation.
 *
 * The `capability` field is the single source of truth for what permission
 * is required. There is no separate `type` field — previously a hardcoded
 * string union drifted from CapabilityType, so we removed it to avoid
 * maintaining two parallel enumerations.
 */
export interface BatchOperation {
  /** The capability required for this operation */
  readonly capability: CapabilityType;

  /** Resource type (table, sheet, cell) */
  readonly resourceType?: string;

  /** Resource ID */
  readonly resourceId?: string;
}

/**
 * Result of batch validation.
 */
export interface BatchValidationResult {
  /** Whether all operations are valid */
  readonly valid: boolean;

  /** First failed operation (if any) */
  readonly failedOperation?: BatchOperation;

  /** Error message (if any) */
  readonly error?: string;
}

/**
 * Factory function type for creating gated APIs.
 */
export type CreateGatedAPIFn = (options: CapabilityGatedAPIOptions) => IGatedAppKernelAPI;

/**
 * Factory function type for capability introspection.
 */
export type CreateIntrospectionFn = (
  context: ScopedAPIContext,
  options: CapabilityGatedAPIOptions,
) => ICapabilityIntrospection;

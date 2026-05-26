/**
 * Security Subpath - Public capability types and pure helpers
 *
 * This barrel consolidates the public API surface of the capability system.
 * It exports:
 * - Types: capability definitions, grant types, registry interfaces, audit types
 * - Pure helpers: capability checks, introspection, app-id factory
 *
 * It does NOT export:
 * - Registry factories (createCapabilityRegistry)
 * - Store implementations (MemoryGrantsStore, SQLiteGrantsStore, etc.)
 * - Requesters (CapabilityRequester)
 * - Sensitive handlers (SensitiveCapabilityHandler)
 * - Re-auth providers
 * - Audit logger implementations
 *
 * Registry creation is deferred to @mog-sdk/app-platform.
 *
 * @module @mog-sdk/kernel/security
 */

// =============================================================================
// Cap-Types (capability type definitions and registry)
// =============================================================================

export type {
  CapabilityInfo,
  CapabilityRiskLevel,
  CapabilityTier,
  CapabilityType,
} from '../services/capabilities/cap-types';

export {
  CAPABILITY_REGISTRY,
  getAllCapabilities,
  getCapabilityInfo,
  isCapabilityType,
} from '../services/capabilities/cap-types';

// =============================================================================
// Taxonomy (pure helpers for capability expansion)
// =============================================================================

export { expandCapabilities } from '../services/capabilities/taxonomy';

// =============================================================================
// Grants (AppId, grant types, pure utilities)
// =============================================================================

export type {
  AppId,
  CapabilityGrant,
  GrantChangeEvent,
  GrantChangeType,
  GrantOptions,
  GrantSource,
} from '../services/capabilities/grants';

export { appId } from '../services/capabilities/grants';

// =============================================================================
// Scope (CapabilityScope type)
// =============================================================================

export type { CapabilityScope } from '../services/capabilities/scope';
export { scopeMatches } from '../services/capabilities/scope';

// =============================================================================
// Gated API types (read-only introspection interfaces)
// =============================================================================

export type {
  IGatedAppKernelAPI,
  ICapabilityIntrospection,
} from '../services/capabilities/gated-api';

export {
  hasFilesystemAccess,
  hasNetworkAccess,
  hasTableFullAccess,
  hasTableReadAccess,
} from '../services/capabilities/gated-api';

// =============================================================================
// Manifest (first-party app detection)
// =============================================================================

export { isFirstPartyApp } from '../services/capabilities/manifest';

// =============================================================================
// Registry types (interfaces and event types - NOT factories)
// =============================================================================

export type {
  AuditEventType,
  CapabilityAuditEntry,
  CapabilityEventMap,
  ICapabilityAuditLog,
  ICapabilityRegistry,
  RegistryEvent,
  RegistryEventType,
} from '../services/capabilities/types';

// =============================================================================
// Audit query types (pure query/result types for audit log consumers)
// =============================================================================

export type { AuditQueryOptions, AuditStats } from '../services/capabilities/audit-logger';

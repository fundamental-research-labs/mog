/**
 * Capability System - Kernel Service
 *
 * Central capability registry and grant stores for the permission system.
 *
 * This module also re-exports runtime code extracted from contracts.
 * Contracts now only exports types; all runtime lives here.
 *
 * Usage:
 * ```typescript
 * import {
 *   CapabilityRegistry,
 *   createCapabilityRegistry,
 *   createMemoryGrantsStore,
 * } from '@mog-sdk/kernel/services/capabilities';
 *
 * const store = createMemoryGrantsStore();
 * const registry = createCapabilityRegistry(store);
 *
 * // Grant a capability
 * registry.grant('my-app' as AppId, 'cells:write');
 *
 * // Check (includes implied capabilities)
 * registry.hasCapability('my-app' as AppId, 'cells:read'); // true
 * ```
 *
 */

// =============================================================================
// Contracts Runtime (extracted from @mog-sdk/contracts/capabilities)
// =============================================================================

// Cap-Types (capability type definitions and registry)
export type {
  CapabilityInfo,
  CapabilityRiskLevel,
  CapabilityTier,
  CapabilityType,
  Tier0Capability,
  Tier1Capability,
  Tier2Capability,
  Tier3Capability,
  Tier4Capability,
  Tier5Capability,
} from './cap-types';

export {
  CAPABILITY_REGISTRY,
  getAllCapabilities,
  getCapabilitiesByRiskLevel,
  getCapabilitiesByTier,
  getCapabilityInfo,
  getSessionDuration,
  isCapabilityType,
  isSessionOnly,
  requiresAuthentication,
} from './cap-types';

// Taxonomy
export type { CompositeCapability } from './taxonomy';

export {
  CAPABILITY_IMPLIES,
  COMPOSITE_CAPABILITIES,
  capabilityImplies,
  expandCapabilities,
  expandComposite,
  expandWithDependencies,
  getAllCompositeCapabilities,
  getCapabilitiesImplying,
  getDirectDependencies,
  isCompositeCapability,
} from './taxonomy';

// Scope
export type { CapabilityScope, ParsedScope, ScopeValidationResult } from './scope';

export {
  combineScopes,
  createScope,
  domainMatches,
  filterScopeByType,
  getScopeResourceTypes,
  isScopeEmpty,
  parseScope,
  scopeMatches,
  validateScope,
} from './scope';

// Manifest
export type {
  AppCapabilityManifest,
  AppManifestWithCapabilities,
  CapabilityTrigger,
  ManifestValidationError,
  ManifestValidationResult,
  OptionalCapabilityRequest,
  RuntimeCapabilityRequest,
  ScopedCapabilityRequest,
} from './manifest';

export {
  FIRST_PARTY_APP_IDS,
  getAllManifestCapabilities,
  getCapabilityReason,
  isFirstPartyApp,
  manifestDeclaresCapability,
  validateCapabilityManifest,
} from './manifest';

// Grants
export type {
  AppId,
  CapabilityDenial,
  CapabilityGrant,
  GrantChangeEvent,
  GrantChangeType,
  GrantOptions,
  GrantSource,
  IGrantsStore,
} from './grants';

export {
  appId,
  createGrant,
  getGrantRemainingTime,
  isGrantExpired,
  isGrantExpiringSoon,
} from './grants';

// Gated API
export type {
  ICapabilityIntrospection,
  IGatedAppKernelAPI,
  IGatedCellsAPI,
  IGatedCheckpointsAPI,
  IGatedConnectionsAPI,
  IGatedDialogsAPI,
  IGatedFilesystemAPI,
  IGatedFormattingAPI,
  IGatedFormulasAPI,
  IGatedNetworkAPI,
  IGatedSheetsAPI,
  IGatedShellAPI,
} from './gated-api';

export {
  hasFilesystemAccess,
  hasNetworkAccess,
  hasTableFullAccess,
  hasTableReadAccess,
} from './gated-api';

// Errors
export {
  CapabilityDeniedError,
  CapabilityError,
  CapabilityExpiredError,
  CapabilityRequiresAuthError,
  CapabilityScopeError,
  InvalidScopeError,
  UnboundedWildcardError,
  authRequired,
  capabilityDenied,
  capabilityExpired,
  isCapabilityDeniedError,
  isCapabilityError,
  isCapabilityExpiredError,
  isCapabilityRequiresAuthError,
  isCapabilityScopeError,
  isInvalidScopeError,
  isUnboundedWildcardError,
  scopeMismatch,
} from '../../errors/capability';

// Cap-Requester (interfaces and types for capability requests)
export type {
  CapabilityDenialReason,
  CapabilityPromptFn,
  CapabilityPromptRequest,
  CapabilityPromptResult,
  CapabilityRequest,
  CapabilityRequestResult,
  ICapabilityRequester,
  SingleRequestResult,
} from './cap-requester';

// Sensitive (session management types and helpers)
export type {
  AuthMethod,
  ExpiryWarning,
  IReAuthProvider,
  ISensitiveCapabilityHandler,
  RateLimitStatus,
  ReAuthOptions,
  ReAuthResult,
  SessionGrant,
  SessionOptions,
} from './sensitive';

export {
  getDefaultSessionDuration,
  getExpiryWarningThresholds,
  getRateLimitCooldown,
  isSessionOnlyCapability,
  requiresReAuth,
} from './sensitive';

// =============================================================================
// Registry
// =============================================================================

export { createCapabilityRegistry } from './registry';
export type { CapabilityRegistry } from './registry';
export type { CapabilityEvents } from './registry';

// =============================================================================
// Audit Logger
// =============================================================================

export { CapabilityAuditLogger, createCapabilityAuditLogger } from './audit-logger';
export type { AuditLoggerOptions, AuditQueryOptions, AuditStats } from './audit-logger';

// =============================================================================
// Stores
// =============================================================================

export {
  // Cloud store (for web)
  CloudGrantsStore,
  // Memory store (for tests)
  MemoryGrantsStore,
  // SQLite store (for desktop)
  SQLiteGrantsStore,
  // Vector clock utilities
  compareVectorClocks,
  createCloudGrantsStore,
  createMemoryGrantsStore,
  createSQLiteGrantsStore,
  incrementVectorClock,
  mergeVectorClocks,
} from './stores';

export type { ISQLiteDatabase } from './stores';

// =============================================================================
// Requester
// =============================================================================

export { CapabilityRequester, createCapabilityRequester } from './requester';

export type { CapabilityRequesterOptions } from './requester';

// =============================================================================
// Sensitive Capability Handler
// =============================================================================

export { SensitiveCapabilityHandler, createSensitiveCapabilityHandler } from './sensitive-handler';

// =============================================================================
// Re-Authentication
// =============================================================================

export {
  DesktopReAuthProvider,
  NoopReAuthProvider,
  WebReAuthProvider,
  createNoopReAuthProvider,
  createReAuthProvider,
  requireReAuthentication,
} from './re-auth';

export type { ReAuthProviderFactoryOptions } from './re-auth';

// =============================================================================
// Local Types
// =============================================================================

export type {
  // Audit types
  AuditEventType,
  CapabilityAuditEntry,
  // Capability event map (for interface)
  CapabilityEventMap,
  CloudGrant,
  CloudStoreOptions,
  // Capability registry interface
  ICapabilityAuditLog,
  ICapabilityRegistry,
  RegistryEvent,
  RegistryEventHandler,
  // Registry event types
  RegistryEventType,
  // Store options
  SQLiteStoreOptions,
  // Vector clock types
  VectorClock,
  VectorClockComparison,
} from './types';

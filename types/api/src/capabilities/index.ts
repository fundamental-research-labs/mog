/**
 * Capability System - Public API (Types Only)
 *
 * This module exports ONLY type definitions for the capability system.
 * Runtime implementation has been moved to @mog-sdk/kernel/services/capabilities.
 *
 * For runtime code (scope matching, taxonomy expansion, error classes,
 * grant utilities, manifest validation, etc.), import from:
 * @mog-sdk/kernel/services/capabilities
 *
 */

// =============================================================================
// Types - Core capability type definitions
// =============================================================================

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
} from './types';

// =============================================================================
// Taxonomy Types
// =============================================================================

export type { CompositeCapability } from './taxonomy';

// =============================================================================
// Scope Types
// =============================================================================

export type { CapabilityScope, ParsedScope, ScopeValidationResult } from './scope';

// =============================================================================
// Manifest Types
// =============================================================================

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

// =============================================================================
// Grants Types
// =============================================================================

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

// =============================================================================
// Gated API Types
// =============================================================================

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

// =============================================================================
// Error Types
// =============================================================================

export type { CapabilityErrorCode } from './errors';

// =============================================================================
// Requester Types
// =============================================================================

export type {
  CapabilityDenialReason,
  CapabilityPromptFn,
  CapabilityPromptRequest,
  CapabilityPromptResult,
  CapabilityRequest,
  CapabilityRequestResult,
  ICapabilityRequester,
  SingleRequestResult,
} from './requester';

// =============================================================================
// Sensitive Types
// =============================================================================

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

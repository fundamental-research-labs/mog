/**
 * Security System - Public Type Surface
 *
 * Types that the TS SDK and app layer consume for data access control.
 * Enforcement is entirely Rust-side (compute-security crate +
 * compute-core storage::security_*). These are only the wire-shape
 * contracts for bridge calls and the session-level security config.
 */

// =============================================================================
// Core types
// =============================================================================

export type {
  AccessLevel,
  AccessPolicy,
  AccessPolicyMetadata,
  AccessPrincipal,
  AccessTarget,
  PolicyId,
  TagMatcher,
  TagSpecificity,
  TargetMatcher,
} from './types';

export { ACCESS_LEVEL_ORDER } from './types';

// =============================================================================
// SDK surface — AccessExplanation + DocumentSecurityConfig
// =============================================================================

export type { AccessExplanation, DocumentSecurityConfig } from './evaluator';

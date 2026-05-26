/**
 * Security contract types kept for the TS SDK surface.
 *
 * Enforcement and policy evaluation now live entirely in Rust
 * (compute-security crate + compute-core storage::security_*). These
 * types are the thin wire-shape contract between the SDK and the
 * bridge methods under `ComputeBridge.wbSecurity*`.
 */

import type { AccessLevel, AccessPolicy, AccessPrincipal } from './types';

// =============================================================================
// Access Explanation (wb.security.explainAccess return shape)
// =============================================================================

/**
 * Derivation trace returned by `wb.security.explainAccess(...)`. Matches
 * the Rust `compute_security::engine::AccessExplanation` serde shape.
 */
export interface AccessExplanation {
  /** The resolved access level */
  readonly level: AccessLevel;

  /** The policy that determined the level (null = default, no policy matched) */
  readonly matchedPolicy: AccessPolicy | null;

  /** Why this level was chosen */
  readonly reason: string;

  /** All policies that were considered during evaluation */
  readonly candidatePolicies: AccessPolicy[];

  /** Warnings (e.g., "ambiguous: 2 policies at same specificity+priority disagree") */
  readonly warnings: string[];
}

// =============================================================================
// Document Security Configuration (SDK entry point)
// =============================================================================

/**
 * Configuration provided by the app at document creation time.
 * The kernel invokes `resolvePrincipal` once at session start and forwards
 * the result to the Rust engine via `computeBridge.setActivePrincipal(...)`.
 */
export interface DocumentSecurityConfig {
  /**
   * Callback to resolve the current principal. Called once per document
   * session; the returned principal is forwarded to Rust and governs
   * every bridge call until the document is disposed.
   */
  resolvePrincipal: () => AccessPrincipal;
}

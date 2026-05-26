/**
 * Capability Errors - Error types for capability-related failures
 *
 * This file defines:
 * - CapabilityErrorCode type
 *
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Error codes for capability-related failures.
 */
export type CapabilityErrorCode =
  | 'CAPABILITY_DENIED'
  | 'CAPABILITY_SCOPE_MISMATCH'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_NOT_GRANTED'
  | 'CAPABILITY_REQUIRES_AUTH'
  | 'INVALID_SCOPE'
  | 'UNBOUNDED_WILDCARD';

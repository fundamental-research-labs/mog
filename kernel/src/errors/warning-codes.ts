/**
 * Kernel Warning Code Registry
 *
 * Every warning code the kernel can produce. Grouped by domain prefix.
 * Mirrors the KernelErrorCode pattern but for non-fatal conditions
 * that callers should be aware of.
 */

export type KernelWarningCode =
  // === API / Batch Operations (API_*) ===
  | 'API_DUPLICATE_COORDINATES'
  | 'API_VALUE_TRUNCATED'
  | 'API_TYPE_COERCED'
  | 'API_RANGE_CLAMPED'
  | 'API_NAME_COLLISION'
  // === Table (TABLE_*) ===
  | 'TABLE_AUTO_RENAMED'
  // === Generic ===
  | 'PARTIAL_WRITE';

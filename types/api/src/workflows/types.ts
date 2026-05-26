/**
 * Workflow Shared Types
 *
 * Shared type primitives used across workflow runtime and instance contracts.
 * Extracted here to break the `runtime.ts` <-> `instance.ts` import cycle:
 * both modules import `RuntimeType` from this file instead of each other.
 *
 */

// =============================================================================
// Runtime Type (shared between runtime and instance contracts)
// =============================================================================

/**
 * Runtime type for workflow execution.
 *
 * - 'local': Browser-based (Pyodide/WebAssembly)
 * - 'cloud': Server-based (Python)
 * - 'auto': Automatically selected, may promote from local to cloud
 */
export type RuntimeType = 'local' | 'cloud' | 'auto';

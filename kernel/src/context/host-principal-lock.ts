import type { KernelPrincipalHandoff } from '@mog-sdk/types-host/identity';

/**
 * Immutable principal lock for host-backed workbooks.
 *
 * Once a trusted host adapter has projected a verified principal into the Rust
 * workbook security session, the lock prevents any public API from mutating the
 * active principal. This ensures that callers cannot escalate privileges by
 * calling `setActivePrincipal(['mog:owner'])` after construction.
 *
 * The lock is installed during host-backed workbook construction and persists
 * for the lifetime of the workbook. It is never unlocked.
 */
export interface HostPrincipalLock {
  readonly isLocked: true;
  readonly lockedPrincipal: KernelPrincipalHandoff;
  assertNotLocked(operation: string): never;
}

/**
 * Error thrown when a caller attempts to mutate the active principal on a
 * host-backed workbook where the principal has been locked by the trusted host.
 */
export class HostPrincipalMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostPrincipalMutationError';
  }
}

/**
 * Create an immutable principal lock from a verified handoff.
 *
 * The returned lock object throws `HostPrincipalMutationError` on any attempt
 * to mutate the principal via public workbook APIs.
 */
export function createHostPrincipalLock(handoff: KernelPrincipalHandoff): HostPrincipalLock {
  return {
    isLocked: true,
    lockedPrincipal: handoff,
    assertNotLocked(operation: string): never {
      throw new HostPrincipalMutationError(
        `Cannot ${operation} on a host-backed workbook: principal is immutable after host construction. ` +
          `The active principal was set by the trusted host adapter and cannot be changed through public APIs.`,
      );
    },
  };
}

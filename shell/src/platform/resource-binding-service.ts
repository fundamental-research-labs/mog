/**
 * Resource Binding Service — manages resource leases and binding resolution.
 *
 * Resolves `ResourceBindingDescriptor`s into `ResolvedResourceBinding`s
 * backed by unique leases. Tracks lease state transitions and produces
 * app-facing snapshots that strip internal details.
 *
 */

import type {
  AppResourceBindingSnapshot,
  ResourceBindingDescriptor,
  ResourceLeaseState,
  ResolvedResourceBinding,
} from './types';

// ============================================================
// Error type
// ============================================================

export interface BindingError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

function bindingError(code: string, message: string): BindingError {
  return { ok: false, code, message };
}

// ============================================================
// Public interface
// ============================================================

export interface IResourceBindingService {
  /** Resolve a binding descriptor into a resolved binding with a lease. */
  resolveBinding(
    descriptor: ResourceBindingDescriptor,
    grantSubject: string,
  ): ResolvedResourceBinding | BindingError;

  /** Suspend a lease (retain data or downgrade access). */
  suspendLease(leaseId: string, mode: 'retain' | 'downgrade'): void;

  /** Resume a suspended lease. */
  resumeLease(leaseId: string): void;

  /** Release a lease (terminal state). */
  releaseLease(leaseId: string): void;

  /** Transfer a lease to a new owner. */
  transferLease(leaseId: string, newOwner: string): void;

  /** Look up a binding by lease ID. */
  getBinding(leaseId: string): ResolvedResourceBinding | undefined;

  /** Look up a lease state by lease ID. */
  getLeaseState(leaseId: string): ResourceLeaseState | undefined;

  /** Create a public-facing snapshot that strips internal details. */
  createBindingSnapshot(binding: ResolvedResourceBinding): AppResourceBindingSnapshot;
}

// ============================================================
// Implementation
// ============================================================

let leaseCounter = 0;

function generateLeaseId(): string {
  leaseCounter += 1;
  return `lease-${Date.now()}-${leaseCounter}`;
}

export function createResourceBindingService(): IResourceBindingService {
  /** leaseId → binding */
  const bindings = new Map<string, ResolvedResourceBinding>();
  /** leaseId → state */
  const leaseStates = new Map<string, ResourceLeaseState>();

  return {
    resolveBinding(
      descriptor: ResourceBindingDescriptor,
      grantSubject: string,
    ): ResolvedResourceBinding | BindingError {
      if (!descriptor.resourceKind) {
        return bindingError('MISSING_KIND', 'Resource kind is required.');
      }
      if (!descriptor.resourceId) {
        return bindingError('MISSING_ID', 'Resource ID is required.');
      }

      const leaseId = generateLeaseId();
      const binding: ResolvedResourceBinding = {
        descriptor,
        resourceRef: {
          kind: descriptor.resourceKind,
          id: descriptor.resourceId,
        },
        leaseId,
        grantSubject,
        resolvedAt: Date.now(),
      };

      bindings.set(leaseId, binding);
      leaseStates.set(leaseId, 'active');

      return binding;
    },

    suspendLease(leaseId: string, mode: 'retain' | 'downgrade'): void {
      const state = leaseStates.get(leaseId);
      if (!state) throw new Error(`Unknown lease: ${leaseId}`);
      if (state !== 'active') {
        throw new Error(`Cannot suspend lease in state "${state}".`);
      }
      leaseStates.set(leaseId, mode === 'retain' ? 'suspended-retain' : 'suspended-downgrade');
    },

    resumeLease(leaseId: string): void {
      const state = leaseStates.get(leaseId);
      if (!state) throw new Error(`Unknown lease: ${leaseId}`);
      if (state !== 'suspended-retain' && state !== 'suspended-downgrade') {
        throw new Error(`Cannot resume lease in state "${state}".`);
      }
      leaseStates.set(leaseId, 'active');
    },

    releaseLease(leaseId: string): void {
      const state = leaseStates.get(leaseId);
      if (!state) throw new Error(`Unknown lease: ${leaseId}`);
      if (state === 'released' || state === 'transferred') {
        throw new Error(`Lease already in terminal state "${state}".`);
      }
      leaseStates.set(leaseId, 'released');
      bindings.delete(leaseId);
    },

    transferLease(leaseId: string, newOwner: string): void {
      const state = leaseStates.get(leaseId);
      if (!state) throw new Error(`Unknown lease: ${leaseId}`);
      if (state === 'released' || state === 'transferred') {
        throw new Error(`Lease already in terminal state "${state}".`);
      }

      const existing = bindings.get(leaseId);
      if (!existing) throw new Error(`No binding for lease: ${leaseId}`);

      // Create a new binding under the same lease ID with the new owner
      const transferred: ResolvedResourceBinding = {
        ...existing,
        grantSubject: newOwner,
      };
      bindings.set(leaseId, transferred);
      leaseStates.set(leaseId, 'transferred');
    },

    getBinding(leaseId: string): ResolvedResourceBinding | undefined {
      return bindings.get(leaseId);
    },

    getLeaseState(leaseId: string): ResourceLeaseState | undefined {
      return leaseStates.get(leaseId);
    },

    createBindingSnapshot(binding: ResolvedResourceBinding): AppResourceBindingSnapshot {
      return {
        resourceKind: binding.descriptor.resourceKind,
        resourceId: binding.descriptor.resourceId,
        accessMode: binding.descriptor.accessMode,
        label: binding.descriptor.label,
      };
    },
  };
}

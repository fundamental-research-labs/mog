/**
 * Deterministic storage fixtures for host-contract testing.
 *
 * Provides in-memory implementations of replay registry, provider
 * materializer, source handle resolver, and transport bindings. All
 * behavior is predictable with zero randomness.
 */

import type {
  HostHandoffReplayRegistry,
  HandoffReplayKey,
  HostProviderMaterializerRegistry,
  ProviderMaterializerRequest,
  ProviderMaterializerHandle,
  HostSourceHandleResolverRegistry,
  SourceHandleResolveRequest,
  SourceHandleResolveResult,
  HostTransportBindingRegistry,
  HostTransportBinding,
  HostKernelAdapterBindings,
} from '@mog-sdk/types-host/bindings';

// ---------------------------------------------------------------------------
// Replay Registry
// ---------------------------------------------------------------------------

function serializeReplayKey(key: HandoffReplayKey): string {
  return `${key.sourceHostId}:${key.sessionId}:${key.decisionId}:${key.operation}:${key.nonce}:${key.resourceFingerprint}`;
}

export interface DeterministicReplayRegistry extends HostHandoffReplayRegistry {
  /** Set of serialized keys that have been consumed. */
  readonly consumed: ReadonlySet<string>;
  /** Clear all consumed keys. */
  reset(): void;
}

export function createDeterministicReplayRegistry(): DeterministicReplayRegistry {
  const consumed = new Set<string>();

  return {
    consumeOnce(key: HandoffReplayKey): boolean {
      const serialized = serializeReplayKey(key);
      if (consumed.has(serialized)) {
        return false;
      }
      consumed.add(serialized);
      return true;
    },

    get consumed(): ReadonlySet<string> {
      return consumed;
    },

    reset(): void {
      consumed.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Provider Materializer
// ---------------------------------------------------------------------------

export interface DeterministicProviderMaterializer extends HostProviderMaterializerRegistry {
  /** All materialization requests received. */
  readonly requests: readonly ProviderMaterializerRequest[];
  /** All materialized handles. */
  readonly handles: readonly ProviderMaterializerHandle[];
  /** Reset recorded state. */
  reset(): void;
}

export function createDeterministicProviderMaterializer(): DeterministicProviderMaterializer {
  const requests: ProviderMaterializerRequest[] = [];
  const handles: ProviderMaterializerHandle[] = [];
  const knownProviderRefIds = new Set<string>(['memory', 'indexeddb', 'filesystem']);

  return {
    has(providerRefId: string): boolean {
      return knownProviderRefIds.has(providerRefId);
    },

    async resolve(request: ProviderMaterializerRequest): Promise<ProviderMaterializerHandle> {
      requests.push(request);

      const handle: ProviderMaterializerHandle = {
        providerRefId: request.providerRefId,
        materialized: true as const,
        async attach(_rustDocument: unknown): Promise<void> {
          // no-op for deterministic fixture
        },
        dispose(): void {
          // no-op for deterministic fixture
        },
      };
      handles.push(handle);
      return handle;
    },

    get requests(): readonly ProviderMaterializerRequest[] {
      return requests;
    },

    get handles(): readonly ProviderMaterializerHandle[] {
      return handles;
    },

    reset(): void {
      requests.length = 0;
      handles.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Source Handle Resolver
// ---------------------------------------------------------------------------

/** Fixed deterministic content for source handle resolution. */
const DETERMINISTIC_SOURCE_BYTES = new Uint8Array([
  0x50,
  0x4b,
  0x03,
  0x04, // PK zip signature (XLSX is a zip)
  0x00,
  0x00,
  0x00,
  0x00, // placeholder bytes
]);

export interface DeterministicSourceHandleResolver extends HostSourceHandleResolverRegistry {
  /** All resolution requests received. */
  readonly requests: readonly SourceHandleResolveRequest[];
  /** Reset recorded state. */
  reset(): void;
}

export function createDeterministicSourceHandleResolver(): DeterministicSourceHandleResolver {
  const requests: SourceHandleResolveRequest[] = [];
  const knownSourceKinds = new Set<string>(['file-url', 'uploaded-bytes', 'host-callback']);

  return {
    has(sourceKind: string): boolean {
      return knownSourceKinds.has(sourceKind);
    },

    async resolve(request: SourceHandleResolveRequest): Promise<SourceHandleResolveResult> {
      requests.push(request);

      return {
        sourceHandleId: request.sourceHandleId,
        bytes: DETERMINISTIC_SOURCE_BYTES,
        contentIdentity: request.expectedContentIdentity,
        contentIdentityVerified: true as const,
      };
    },

    get requests(): readonly SourceHandleResolveRequest[] {
      return requests;
    },

    reset(): void {
      requests.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Transport Bindings
// ---------------------------------------------------------------------------

export interface DeterministicTransportBindings extends HostTransportBindingRegistry {
  /** All runtime kinds that have been queried. */
  readonly queriedKinds: readonly string[];
  /** Reset recorded state. */
  reset(): void;
}

export function createDeterministicTransportBindings(): DeterministicTransportBindings {
  const queriedKinds: string[] = [];

  return {
    has(runtimeKind: string): boolean {
      return runtimeKind === 'test';
    },

    resolve(runtimeKind: string): HostTransportBinding {
      queriedKinds.push(runtimeKind);

      return {
        runtimeKind,
        createTransportConfig(): unknown {
          return { kind: 'test', deterministic: true };
        },
      };
    },

    get queriedKinds(): readonly string[] {
      return queriedKinds;
    },

    reset(): void {
      queriedKinds.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Composed Adapter Bindings
// ---------------------------------------------------------------------------

export interface DeterministicAdapterBindings extends HostKernelAdapterBindings {
  /** Reset all sub-registries. */
  reset(): void;
}

export function createDeterministicAdapterBindings(): DeterministicAdapterBindings {
  const providerMaterializers = createDeterministicProviderMaterializer();
  const sourceHandleResolvers = createDeterministicSourceHandleResolver();
  const replayRegistry = createDeterministicReplayRegistry();
  const transportBindings = createDeterministicTransportBindings();

  return {
    providerMaterializers,
    sourceHandleResolvers,
    replayRegistry,
    transportBindings,

    reset(): void {
      (providerMaterializers as DeterministicProviderMaterializer).reset();
      (sourceHandleResolvers as DeterministicSourceHandleResolver).reset();
      (replayRegistry as DeterministicReplayRegistry).reset();
      (transportBindings as DeterministicTransportBindings).reset();
    },
  };
}

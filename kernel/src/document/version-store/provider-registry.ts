import {
  IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES,
  IN_MEMORY_VERSION_STORE_CAPABILITIES,
  createInMemoryVersionStoreProvider,
  type InMemoryVersionStoreProviderOptions,
  type VersionAccessContext,
  type VersionStoreCapabilities,
  type VersionStoreProvider,
} from './provider';
import type {
  InMemoryVersionDocumentProviderBackend,
  InMemoryVersionProviderDurability,
} from './provider-memory-backend';
import {
  INDEXEDDB_VERSION_STORE_CAPABILITIES,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
  createIndexedDbVersionStoreProvider,
} from './provider-indexeddb/backend';
import type { VersionDocumentScope } from './registry';

export type VersionStoreProviderKind =
  | 'memory'
  | 'memory-durable-snapshot'
  | typeof INDEXEDDB_VERSION_STORE_PROVIDER_KIND
  | 'unavailable';

export type VersionStoreProviderRequest = {
  readonly kind: VersionStoreProviderKind | (string & {});
  readonly documentScope: VersionDocumentScope;
  readonly accessContext?: VersionAccessContext;
  readonly backend?: InMemoryVersionDocumentProviderBackend;
  readonly readOnly?: boolean;
  readonly requireDurablePersistence?: boolean;
};

export type VersionStoreProviderFactory = {
  readonly kind: VersionStoreProviderKind;
  readonly capabilities: VersionStoreCapabilities;
  readonly productionDurable: boolean;
  create(request: VersionStoreProviderRequest): VersionStoreProvider;
};

export class VersionStoreProviderRegistry {
  private readonly factories = new Map<string, VersionStoreProviderFactory>();

  register(factory: VersionStoreProviderFactory): void {
    if (this.factories.has(factory.kind)) {
      throw new Error(`Version store provider kind is already registered: ${factory.kind}`);
    }
    this.factories.set(factory.kind, factory);
  }

  capabilities(kind: string): VersionStoreCapabilities | null {
    return this.factories.get(kind)?.capabilities ?? null;
  }

  create(request: VersionStoreProviderRequest): VersionStoreProvider {
    const factory = this.factories.get(request.kind);
    if (!factory || request.kind === 'unavailable') {
      return unavailableProvider(request);
    }
    if (
      request.requireDurablePersistence &&
      (!factory.capabilities.durableGraphRegistry || !factory.capabilities.durableObjects)
    ) {
      return unavailableProvider(request);
    }
    return factory.create(request);
  }
}

export function createDefaultVersionStoreProviderRegistry(): VersionStoreProviderRegistry {
  const registry = new VersionStoreProviderRegistry();
  registry.register(memoryFactory('memory', 'ephemeral', IN_MEMORY_VERSION_STORE_CAPABILITIES));
  registry.register(
    memoryFactory(
      'memory-durable-snapshot',
      'snapshot-test-double',
      IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES,
    ),
  );
  registry.register({
    kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
    capabilities: INDEXEDDB_VERSION_STORE_CAPABILITIES,
    productionDurable: true,
    create: (request) =>
      createIndexedDbVersionStoreProvider({
        documentScope: request.documentScope,
        accessContext: request.accessContext,
        readOnly: request.readOnly,
      }),
  });
  registry.register({
    kind: 'unavailable',
    capabilities: unavailableProvider({ kind: 'unavailable', documentScope: { documentId: 'x' } })
      .capabilities,
    productionDurable: false,
    create: unavailableProvider,
  });
  return registry;
}

export function selectVersionStoreProvider(
  request: VersionStoreProviderRequest,
  registry = createDefaultVersionStoreProviderRegistry(),
): VersionStoreProvider {
  return registry.create(request);
}

function memoryFactory(
  kind: Extract<VersionStoreProviderKind, 'memory' | 'memory-durable-snapshot'>,
  durability: InMemoryVersionProviderDurability,
  capabilities: VersionStoreCapabilities,
): VersionStoreProviderFactory {
  return {
    kind,
    capabilities,
    productionDurable: false,
    create: (request) => createInMemoryVersionStoreProvider(memoryOptions(request, durability)),
  };
}

function memoryOptions(
  request: VersionStoreProviderRequest,
  durability: InMemoryVersionProviderDurability,
): InMemoryVersionStoreProviderOptions {
  return {
    documentScope: request.documentScope,
    accessContext: request.accessContext,
    backend: request.backend,
    readOnly: request.readOnly,
    durability,
  };
}

function unavailableProvider(request: VersionStoreProviderRequest): VersionStoreProvider {
  return createInMemoryVersionStoreProvider({
    documentScope: request.documentScope,
    accessContext: request.accessContext,
    backend: request.backend,
    unavailable: true,
  });
}

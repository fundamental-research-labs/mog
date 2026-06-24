import type { DocumentContext } from '../../../../context';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import { namespaceForRegistry } from '../../../../document/version-store/registry';
import type {
  AttachedCheckoutAdmissionReadService,
  BoundMethod,
  MaybePromise,
  MaybeVersionRuntimeContext,
} from './version-checkout-admission-types';

export function getAttachedVersionRuntimeServices(ctx: DocumentContext): unknown {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

export function getAttachedCheckoutAdmissionReadService(
  services: unknown,
): AttachedCheckoutAdmissionReadService | null {
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.readService,
    services.writeService,
    services.commitService,
    services.versionReadService,
    services.publicService,
    services,
  ]) {
    const readService = toCheckoutAdmissionReadService(candidate);
    if (readService) return readService;
  }
  return providerCheckoutAdmissionReadService(getAttachedVersionStoreProvider(services));
}

function toCheckoutAdmissionReadService(
  value: unknown,
): AttachedCheckoutAdmissionReadService | null {
  const readRef = bindMethod(value, 'readRef');
  return readRef ? { readRef: (name) => readRef(name) } : null;
}

function providerCheckoutAdmissionReadService(
  provider: VersionStoreProvider | null,
): AttachedCheckoutAdmissionReadService | null {
  if (!provider) return null;
  return {
    readRef: async (name) => {
      const registry = await provider.readGraphRegistry();
      if (registry.status !== 'ok') return null;
      const graph = await provider.openGraph(
        namespaceForRegistry(registry.registry),
        provider.accessContext,
      );
      return graph.readRef(name);
    },
  };
}

export function getAttachedVersionStoreProvider(services: unknown): VersionStoreProvider | null {
  if (!isRecord(services)) return null;
  for (const candidate of [services.provider, services.storageProvider, services]) {
    if (isVersionStoreProvider(candidate)) return candidate;
  }
  return null;
}

function isVersionStoreProvider(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

import type { DocumentContext } from '../../../../context';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import type { MaybeVersionRuntimeContext } from './provider-writes-types';
import { isRecord } from './provider-writes-utils';

export function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
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

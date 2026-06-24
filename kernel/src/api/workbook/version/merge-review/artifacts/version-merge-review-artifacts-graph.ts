import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../../context';
import type { VersionGraphNamespace } from '../../../../../document/version-store/object-store';
import type { VersionStoreProvider } from '../../../../../document/version-store/provider';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import { namespaceForRegistry } from '../../../../../document/version-store/registry';
import type { VersionMergePublicOperation } from '../../merge/version-merge-capability';
import {
  mapMergeReviewProviderDiagnostics,
  mergeReviewDiagnostic,
  mergeReviewProviderErrorDiagnostic,
} from './version-merge-review-artifacts-diagnostics';
import { isRecord } from './version-merge-review-artifacts-guards';

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
  readonly publicService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type MergeReviewGraphOpenResult =
  | {
      readonly ok: true;
      readonly namespace: VersionGraphNamespace;
      readonly graph: VersionGraphStore;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function openMergeReviewGraph(
  ctx: DocumentContext,
  operation: VersionMergePublicOperation,
): Promise<MergeReviewGraphOpenResult> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_STORE_UNAVAILABLE',
          'No version graph provider is attached for persisted merge review.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return {
        ok: false,
        diagnostics: mapMergeReviewProviderDiagnostics(operation, registry.diagnostics),
      };
    }
    const namespace = namespaceForRegistry(registry.registry);
    return {
      ok: true,
      namespace,
      graph: await provider.openGraph(namespace, provider.accessContext),
    };
  } catch {
    return { ok: false, diagnostics: [mergeReviewProviderErrorDiagnostic(operation)] };
  }
}

function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.provider,
    services.versionStoreProvider,
    services.storeProvider,
    services.publicService,
    services,
  ]) {
    if (hasVersionStoreProviderReads(candidate)) return candidate as VersionStoreProvider;
  }
  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

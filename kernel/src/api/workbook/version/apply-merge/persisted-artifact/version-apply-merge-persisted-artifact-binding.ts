import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../../context';
import {
  hasMergeApplyIntentStoreProvider,
  type MergeApplyIntentStore,
} from '../../../../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest as InternalObjectDigest } from '../../../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../../../document/version-store/object-store';
import type { VersionStoreProvider } from '../../../../../document/version-store/provider';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import { namespaceForRegistry } from '../../../../../document/version-store/registry';
import {
  mapProviderDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
} from './version-apply-merge-persisted-artifact-diagnostics';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedVersionApplyMergeService = {
  readonly mergeCommit?: (input: {
    readonly base: WorkbookCommitId;
    readonly ours: WorkbookCommitId;
    readonly theirs: WorkbookCommitId;
    readonly targetRef: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead: VersionCommitExpectedHead;
    readonly changes: readonly VersionMergeChange[];
    readonly resolutionCount: number;
    readonly resolvedMergeAttemptDigest?: InternalObjectDigest;
  }) => MaybePromise<unknown>;
};

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
  readonly writeService?: unknown;
  readonly versionWriteService?: unknown;
  readonly commitService?: unknown;
  readonly applyMergeService?: unknown;
  readonly versionApplyMergeService?: unknown;
  readonly publicService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type OpenPersistedMergeGraphResult =
  | {
      readonly ok: true;
      readonly namespace: VersionGraphNamespace;
      readonly graph: VersionGraphStore;
      readonly intentStore: MergeApplyIntentStore | null;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function openPersistedMergeGraph(
  ctx: DocumentContext,
): Promise<OpenPersistedMergeGraphResult> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_STORE_UNAVAILABLE',
          'No version graph provider is attached for persisted applyMerge.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return { ok: false, diagnostics: mapProviderDiagnostics(registry.diagnostics) };
    }
    const namespace = namespaceForRegistry(registry.registry);
    return {
      ok: true,
      namespace,
      graph: await provider.openGraph(namespace, provider.accessContext),
      intentStore: hasMergeApplyIntentStoreProvider(provider)
        ? await provider.openMergeApplyIntentStore(namespace)
        : null,
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

export function getAttachedVersionApplyMergeService(
  ctx: DocumentContext,
): AttachedVersionApplyMergeService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.versionWriteService,
    services.commitService,
    services.publicService,
  ]) {
    const service = toApplyMergeService(candidate);
    if (service) return service;
  }
  return null;
}

function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.provider,
    services.versionStoreProvider,
    services.storeProvider,
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

function toApplyMergeService(value: unknown): AttachedVersionApplyMergeService | null {
  const mergeCommit =
    bindMethod(value, 'mergeCommit') ??
    bindMethod(value, 'applyMerge') ??
    bindMethod(value, 'applyMergeVersion') ??
    bindMethod(value, 'applyMergeCommit');
  if (!mergeCommit) return null;
  return { mergeCommit: (input) => mergeCommit(input) };
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return isRecord(value) && typeof value.readGraphRegistry === 'function';
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

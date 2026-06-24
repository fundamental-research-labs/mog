import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  hasMergeApplyIntentStoreProvider,
  intentIdForMergeResultId,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
  type MergeApplyIntentStoreProvider,
} from '../../../../document/version-store/merge-apply-intent-store';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import { namespaceForRegistry } from '../../../../document/version-store/registry';
import {
  intentStoreDiagnostics,
  invalidApplyMergeOptionDiagnostic,
  mapProviderDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
} from './version-apply-merge-persisted-diagnostics';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionApplyMergeService = {
  readonly fastForwardMerge?: (input: {
    readonly base: WorkbookCommitId;
    readonly ours: WorkbookCommitId;
    readonly theirs: WorkbookCommitId;
    readonly targetRef: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => MaybePromise<unknown>;
};

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
  readonly writeService?: unknown;
  readonly versionWriteService?: unknown;
  readonly applyMergeService?: unknown;
  readonly versionApplyMergeService?: unknown;
  readonly publicService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export async function openPersistedMergeIntentStore(ctx: DocumentContext): Promise<
  | {
      readonly ok: true;
      readonly provider: VersionStoreProvider & MergeApplyIntentStoreProvider;
      readonly store: MergeApplyIntentStore;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const provider = getAttachedMergeApplyIntentStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_STORE_UNAVAILABLE',
          'No merge apply intent store is attached for persisted applyMerge.',
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
    return {
      ok: true,
      provider,
      store: await provider.openMergeApplyIntentStore(namespaceForRegistry(registry.registry)),
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

export async function lookupPersistedMergeIntentRecord(
  store: MergeApplyIntentStore,
  resultId: VersionMergeResultId,
): Promise<
  | { readonly ok: true; readonly record: MergeApplyIntentRecord }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const intentId = intentIdForMergeResultId(resultId);
  if (!intentId) {
    return {
      ok: false,
      diagnostics: [invalidApplyMergeOptionDiagnostic('resultId', 'resultId is invalid.')],
    };
  }
  const read = await store.readByIntentId(intentId);
  if (read.status !== 'found') {
    return { ok: false, diagnostics: intentStoreDiagnostics(read.diagnostics) };
  }
  return { ok: true, record: read.record };
}

export async function readCurrentTargetHead(
  provider: VersionStoreProvider,
  record: MergeApplyIntentRecord,
): Promise<
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return { ok: false, diagnostics: mapProviderDiagnostics(registry.diagnostics) };
    }
    const graph = await provider.openGraph(
      namespaceForRegistry(registry.registry),
      provider.accessContext,
    );
    const read = await graph.readRef(record.targetRef);
    if (read.status !== 'success' || !('commitId' in read.ref)) {
      return {
        ok: false,
        diagnostics: mapProviderDiagnostics(read.diagnostics),
      };
    }
    return { ok: true, commitId: read.ref.commitId };
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
    services.publicService,
    services,
  ]) {
    const service = toApplyMergeService(candidate);
    if (service) return service;
  }
  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function toApplyMergeService(value: unknown): AttachedVersionApplyMergeService | null {
  const fastForwardMerge =
    bindMethod(value, 'fastForwardMerge') ??
    bindMethod(value, 'fastForward') ??
    bindMethod(value, 'applyFastForwardMerge');
  if (!fastForwardMerge) return null;
  return { fastForwardMerge: (input) => fastForwardMerge(input) };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function getAttachedMergeApplyIntentStoreProvider(
  ctx: DocumentContext,
): (VersionStoreProvider & MergeApplyIntentStoreProvider) | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.provider,
    services.versionStoreProvider,
    services.storeProvider,
    services,
  ]) {
    if (hasMergeApplyIntentStoreProvider(candidate) && hasVersionStoreProviderReads(candidate)) {
      return candidate as VersionStoreProvider & MergeApplyIntentStoreProvider;
    }
  }
  return null;
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return isRecord(value) && typeof value.readGraphRegistry === 'function';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

import type {
  VersionMergeInput,
  VersionMergeResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  resolveVersionMergeBase,
  type VersionMergeBaseCommitRead,
} from '../../document/version-store/merge-base-resolution';
import {
  VersionStoreProviderError,
  type VersionGraphStore,
  type VersionStoreProvider,
} from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';
import {
  mapGraphDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
} from './version-merge-public-diagnostics';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionGraphProvider = Pick<VersionStoreProvider, 'readGraphRegistry' | 'openGraph'> &
  Partial<Pick<VersionStoreProvider, 'accessContext'>>;

export async function validatePublicMergeBaseGate(
  services: unknown,
  input: VersionMergeInput,
): Promise<readonly VersionStoreDiagnostic[]> {
  const provider = getAttachedVersionGraphProvider(services);
  if (!provider) return [];

  const opened = await openPublicMergeBaseGraph(provider);
  if (!opened.ok) return opened.diagnostics;

  const base = await readPublicMergeBaseCommit(opened.graph, input.base);
  if (!base.ok) return base.diagnostics;
  const ours = await readPublicMergeBaseCommit(opened.graph, input.ours);
  if (!ours.ok) return ours.diagnostics;
  const theirs = await readPublicMergeBaseCommit(opened.graph, input.theirs);
  if (!theirs.ok) return theirs.diagnostics;

  const resolution = resolveVersionMergeBase(input, ours.commit, theirs.commit);
  return resolution.status === 'blocked' ? [resolution.diagnostic] : [];
}

export async function publicMergeBaseGateResult(
  services: unknown,
  input: VersionMergeInput,
): Promise<VersionMergeResult | null> {
  const diagnostics = await validatePublicMergeBaseGate(services, input);
  return diagnostics.length > 0
    ? {
        status: 'blocked',
        base: input.base,
        ours: input.ours,
        theirs: input.theirs,
        changes: [],
        conflicts: [],
        diagnostics,
        mutationGuarantee: 'preview-only',
      }
    : null;
}

function getAttachedVersionGraphProvider(services: unknown): AttachedVersionGraphProvider | null {
  const serviceRecord = isRecord(services) ? services : {};
  for (const candidate of [
    serviceRecord.provider,
    serviceRecord.graphProvider,
    serviceRecord.versionStoreProvider,
    serviceRecord.storeProvider,
    services,
  ]) {
    const provider = toGraphProvider(candidate);
    if (provider) return provider;
  }

  return null;
}

function toGraphProvider(value: unknown): AttachedVersionGraphProvider | null {
  if (!isRecord(value)) return null;

  const readGraphRegistry = bindMethod(value, 'readGraphRegistry');
  const openGraph = bindMethod(value, 'openGraph');
  if (!readGraphRegistry || !openGraph) return null;

  const accessContext = isRecord(value.accessContext)
    ? (value.accessContext as VersionStoreProvider['accessContext'])
    : undefined;

  return {
    readGraphRegistry: () =>
      Promise.resolve(readGraphRegistry()) as ReturnType<VersionStoreProvider['readGraphRegistry']>,
    openGraph: (namespace, nextAccessContext) =>
      Promise.resolve(openGraph(namespace, nextAccessContext)) as ReturnType<
        VersionStoreProvider['openGraph']
      >,
    ...(accessContext ? { accessContext } : {}),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

async function openPublicMergeBaseGraph(
  provider: AttachedVersionGraphProvider,
): Promise<
  | { readonly ok: true; readonly graph: VersionGraphStore }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const registryRead = await provider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return { ok: false, diagnostics: mapGraphDiagnostics(registryRead.diagnostics) };
    }

    return {
      ok: true,
      graph: await provider.openGraph(
        namespaceForRegistry(registryRead.registry),
        provider.accessContext,
      ),
    };
  } catch (error) {
    if (error instanceof VersionStoreProviderError) {
      return { ok: false, diagnostics: mapGraphDiagnostics(error.diagnostics) };
    }
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

async function readPublicMergeBaseCommit(
  graph: VersionGraphStore,
  commitId: WorkbookCommitId,
): Promise<
  | { readonly ok: true; readonly commit: VersionMergeBaseCommitRead }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const closure = await graph.readCommitClosure(commitId);
  if (closure.status !== 'success') {
    return { ok: false, diagnostics: mapGraphDiagnostics(closure.diagnostics) };
  }

  const commit = closure.commits.find((candidate) => candidate.id === commitId);
  if (!commit) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'The requested version merge is not previewable by the attached service.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }

  return { ok: true, commit: { commit, closure: closure.commits } };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

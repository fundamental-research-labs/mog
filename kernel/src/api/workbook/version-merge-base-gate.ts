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
type MergeInputRef = 'base' | 'ours' | 'theirs';

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

  const reads = await Promise.all([
    readPublicMergeBaseCommit(opened.graph, input.base, 'base'),
    readPublicMergeBaseCommit(opened.graph, input.ours, 'ours'),
    readPublicMergeBaseCommit(opened.graph, input.theirs, 'theirs'),
  ]);
  const readDiagnostics = reads.flatMap((read) => (read.ok ? [] : read.diagnostics));
  if (readDiagnostics.length > 0) return readDiagnostics;
  const [base, ours, theirs] = reads;
  if (!base.ok || !ours.ok || !theirs.ok) return readDiagnostics;

  const resolution = resolveVersionMergeBase(input, ours.commit, theirs.commit);
  if (resolution.status === 'blocked') return [resolution.diagnostic];

  const baseProofDiagnostic = validatePublicMergeBaseProof(input, ours.commit, theirs.commit);
  if (baseProofDiagnostic) return [baseProofDiagnostic];

  return resolution.status === 'divergent'
    ? validatePublicMergeAncestry(input, ours.commit.commit, theirs.commit.commit)
    : [];
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
  mergeRef: MergeInputRef,
): Promise<
  | { readonly ok: true; readonly commit: VersionMergeBaseCommitRead }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const closure = await graph.readCommitClosure(commitId);
    if (closure.status !== 'success') {
      return {
        ok: false,
        diagnostics: mapGraphDiagnostics(closure.diagnostics).map((diagnostic) =>
          diagnosticWithMergeRef(diagnostic, mergeRef),
        ),
      };
    }

    const commit = closure.commits.find((candidate) => candidate.id === commitId);
    if (!commit) {
      return {
        ok: false,
        diagnostics: [
          publicDiagnostic(
            'VERSION_UNMATERIALIZABLE_COMMIT',
            'The requested version merge is not previewable by the attached service.',
            {
              recoverability: 'unsupported',
              payload: {
                diagnosticCode: 'commitClosureRefMismatch',
                mergeRef,
              },
            },
          ),
        ],
      };
    }

    return { ok: true, commit: { commit, closure: closure.commits } };
  } catch (error) {
    if (error instanceof VersionStoreProviderError) {
      return {
        ok: false,
        diagnostics: mapGraphDiagnostics(error.diagnostics).map((diagnostic) =>
          diagnosticWithMergeRef(diagnostic, mergeRef),
        ),
      };
    }
    return {
      ok: false,
      diagnostics: [diagnosticWithMergeRef(providerErrorDiagnostic(), mergeRef)],
    };
  }
}

function validatePublicMergeBaseProof(
  input: VersionMergeInput,
  ours: VersionMergeBaseCommitRead,
  theirs: VersionMergeBaseCommitRead,
): VersionStoreDiagnostic | null {
  const baseInOurs = commitClosureContains(ours, input.base);
  const baseInTheirs = commitClosureContains(theirs, input.base);
  if (baseInOurs && baseInTheirs) return null;

  return publicDiagnostic(
    'VERSION_MERGE_BASE_MISMATCH',
    'Merge preview requires the requested base to be present in both branch histories.',
    {
      recoverability: 'unsupported',
      payload: {
        diagnosticCode: 'missingBaseProof',
        baseInOurs,
        baseInTheirs,
      },
    },
  );
}

function commitClosureContains(
  read: VersionMergeBaseCommitRead,
  commitId: WorkbookCommitId,
): boolean {
  return read.closure.some((candidate) => candidate.id === commitId);
}

function validatePublicMergeAncestry(
  input: VersionMergeInput,
  ours: VersionMergeBaseCommitRead['commit'],
  theirs: VersionMergeBaseCommitRead['commit'],
): readonly VersionStoreDiagnostic[] {
  return [
    publicDirectChildDiagnostic(input.base, ours, 'ours'),
    publicDirectChildDiagnostic(input.base, theirs, 'theirs'),
  ].filter((diagnostic): diagnostic is VersionStoreDiagnostic => Boolean(diagnostic));
}

function publicDirectChildDiagnostic(
  baseCommitId: WorkbookCommitId,
  commit: VersionMergeBaseCommitRead['commit'],
  mergeRef: Exclude<MergeInputRef, 'base'>,
): VersionStoreDiagnostic | null {
  if (
    commit.payload.parentCommitIds.length === 1 &&
    commit.payload.parentCommitIds[0] === baseCommitId
  ) {
    return null;
  }

  return publicDiagnostic(
    'VERSION_MERGE_UNSUPPORTED_ANCESTRY',
    'Merge preview requires non-ancestral divergent commits to be direct children of base.',
    {
      recoverability: 'unsupported',
      payload: {
        mergeRef,
        parentCount: commit.payload.parentCommitIds.length,
        parentMatchesBase: commit.payload.parentCommitIds[0] === baseCommitId,
      },
    },
  );
}

function diagnosticWithMergeRef(
  diagnostic: VersionStoreDiagnostic,
  mergeRef: MergeInputRef,
): VersionStoreDiagnostic {
  return {
    ...diagnostic,
    payload: {
      ...(diagnostic.payload ?? {}),
      mergeRef,
    },
    redacted: true,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

import {
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from './object-digest';
import {
  createInMemoryVersionObjectStore,
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type InMemoryVersionObjectStore,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';
import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitInput,
  type InMemoryWorkbookCommitStore,
  type ReadWorkbookCommitResult,
  type WorkbookCommit,
  type WorkbookCommitStoreDiagnostic,
} from './commit-store';
import {
  createInMemoryRefStore,
  refVersionsEqual,
  type InMemoryRefStore,
  type LiveRefRecord,
  type ProviderEpoch,
  type RefVersion,
  type VersionDiagnostic,
} from './ref-store';
import type { InMemoryRefStoreSnapshot } from './ref-store-snapshot';
import { parseVc04ParentCommitIds } from './commit-store-parents';
import { orderTopologicalNewestFirst, uniqueSortedCommitIds } from './graph-store-traversal';
import type { RefName } from './ref-name';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  commitRefFromLiveRef,
  graphRefFromLiveRef,
  graphRefNameFromRefName,
  parseGraphRefSelector,
  symbolicHeadFromLiveRef,
  type VersionGraphBranchRefName,
} from './graph-store-refs';

export const VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE = 50;
export const VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE = 500;

export { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph-store-refs';
export type { VersionGraphBranchRefName } from './graph-store-refs';

export type VersionGraphCommitContentInput = Omit<
  CreateWorkbookCommitInput,
  'documentId' | 'parentCommitIds'
>;

export type InitializeVersionGraphInput = VersionGraphCommitContentInput;

export type CommitVersionGraphInput = VersionGraphCommitContentInput & {
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion: RefVersion;
  readonly parentCommitIds?: readonly (WorkbookCommitId | string)[];
};

export type VersionGraphRef = {
  readonly name: VersionGraphBranchRefName;
  readonly commitId: WorkbookCommitId;
  readonly revision: RefVersion;
  readonly updatedAt: string;
  readonly providerRefId?: string;
  readonly providerEpoch?: ProviderEpoch;
  readonly refIncarnationId?: string;
  readonly protected?: boolean;
};

export type VersionGraphSymbolicRef = {
  readonly name: typeof VERSION_GRAPH_HEAD_REF;
  readonly target: typeof VERSION_GRAPH_MAIN_REF;
  readonly revision: RefVersion;
};

export type VersionGraphRefSelector = typeof VERSION_GRAPH_HEAD_REF | VersionGraphBranchRefName;

export type VersionGraphCommitRef = {
  readonly id: WorkbookCommitId;
  readonly refName: VersionGraphBranchRefName;
  readonly resolvedFrom: VersionGraphRefSelector;
  readonly refRevision: RefVersion;
};

export type VersionGraphCommitSummary = {
  readonly id: WorkbookCommitId;
  readonly parents: readonly WorkbookCommitId[];
  readonly createdAt: string;
  readonly author: WorkbookCommit['payload']['author'];
};

export type VersionGraphReadHeadResult =
  | {
      readonly status: 'success';
      readonly head: VersionGraphCommitRef;
      readonly main: VersionGraphRef;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly head: null;
      readonly main?: VersionGraphRef;
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type VersionGraphReadRefResult =
  | {
      readonly status: 'success';
      readonly ref: VersionGraphRef | VersionGraphSymbolicRef;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly ref: VersionGraphRef | VersionGraphSymbolicRef | null;
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type VersionGraphListCommitsOptions = {
  readonly pageSize?: number;
  readonly pageToken?: string;
};

export type VersionGraphCommitPageResult =
  | {
      readonly status: 'success';
      readonly commits: readonly VersionGraphCommitSummary[];
      readonly readRevision: RefVersion;
      readonly order: 'topological-newest';
      readonly pageSize: number;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type VersionGraphStoreOperation =
  | 'initializeGraph'
  | 'commit'
  | 'readCommitClosure'
  | 'readHead'
  | 'readRef'
  | 'listCommits';

export type VersionGraphStoreDiagnosticCode =
  | 'VERSION_WRONG_NAMESPACE'
  | 'VERSION_MISSING_PARENT'
  | 'VERSION_MISSING_OBJECT'
  | 'VERSION_REF_CONFLICT'
  | 'VERSION_DANGLING_REF'
  | 'VERSION_UNSUPPORTED_PARENT_COMMIT'
  | 'VERSION_UNSUPPORTED_PAGE_TOKEN'
  | 'VERSION_INVALID_OPTIONS'
  | 'VERSION_STALE_PAGE_CURSOR'
  | 'VERSION_OBJECT_STORE_FAILURE'
  | 'VERSION_GRAPH_CONFLICT'
  | 'VERSION_GRAPH_UNINITIALIZED'
  | 'VERSION_INVALID_COMMIT_ID'
  | 'VERSION_INVALID_COMMIT_PAYLOAD'
  | 'VERSION_WRONG_DOCUMENT'
  | 'VERSION_MISSING_DEPENDENCY';

export type VersionGraphStoreDiagnostic = {
  readonly code: VersionGraphStoreDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly objectKind?: 'commit';
  readonly operation?: VersionGraphStoreOperation;
  readonly option?: 'pageSize' | 'pageToken' | 'ref';
  readonly namespace?: VersionGraphNamespace;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly (
    | WorkbookCommitStoreDiagnostic
    | VersionDiagnostic
    | VersionObjectStoreDiagnostic
  )[];
};

export type VersionGraphWriteSuccess = {
  readonly status: 'success';
  readonly commit: WorkbookCommit;
  readonly main: VersionGraphRef;
  readonly diagnostics: readonly [];
};

export type VersionGraphWriteFailure = {
  readonly status: 'failed';
  readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
  readonly mutationGuarantee: 'no-write-attempted' | 'ref-not-mutated';
};

export type VersionGraphWriteResult = VersionGraphWriteSuccess | VersionGraphWriteFailure;

export type VersionGraphClosureReadResult =
  | {
      readonly status: 'success';
      readonly commits: readonly WorkbookCommit[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type InMemoryVersionGraphStoreOptions = {
  readonly namespace: VersionGraphNamespace;
  readonly objectStore?: InMemoryVersionObjectStore;
  readonly commitStore?: InMemoryWorkbookCommitStore;
  readonly refStore?: InMemoryRefStore;
};

export type InMemoryVersionGraphStoreSnapshot = {
  readonly namespace: VersionGraphNamespace;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
  readonly refStore: InMemoryRefStoreSnapshot;
};

export class InMemoryVersionGraphStore {
  readonly namespace: VersionGraphNamespace;
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
  readonly refStore: InMemoryRefStore;

  private readonly namespaceKey: string;

  constructor(options: InMemoryVersionGraphStoreOptions) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.objectStore = options.objectStore ?? createInMemoryVersionObjectStore(this.namespace);
    this.commitStore = options.commitStore ?? createInMemoryWorkbookCommitStore(this.objectStore);
    this.refStore =
      options.refStore ?? createInMemoryRefStore({ versionDocumentId: this.namespace.documentId });
  }

  async initializeGraph(input: InitializeVersionGraphInput): Promise<VersionGraphWriteResult> {
    const namespaceDiagnostics = validateInputNamespaces(this.namespaceKey, input);
    if (namespaceDiagnostics.length > 0) {
      return failedWrite(namespaceDiagnostics, 'no-write-attempted');
    }

    const created = await this.commitStore.createWorkbookCommit({
      ...input,
      documentId: this.namespace.documentId,
      parentCommitIds: [],
    });
    if (created.status !== 'success') {
      return failedWrite(mapCommitDiagnostics(created.diagnostics), 'no-write-attempted');
    }

    const initialized = this.refStore.initializeMain({
      targetCommitId: created.commit.id,
      createdBy: input.author,
      protected: true,
    });
    if (initialized.ok) {
      return successWrite(created.commit, initialized.ref);
    }

    const existing = this.refStore.getRef('main');
    if (existing.ok && existing.ref?.targetCommitId === created.commit.id) {
      return successWrite(created.commit, existing.ref);
    }

    return failedWrite(
      [
        diagnostic('VERSION_GRAPH_CONFLICT', 'Graph main ref is already initialized.', {
          refName: VERSION_GRAPH_MAIN_REF,
          commitId: existing.ok && existing.ref ? existing.ref.targetCommitId : undefined,
          sourceDiagnostics: initialized.diagnostics,
        }),
      ],
      'ref-not-mutated',
    );
  }

  async commit(input: CommitVersionGraphInput): Promise<VersionGraphWriteResult> {
    const namespaceDiagnostics = validateInputNamespaces(this.namespaceKey, input);
    if (namespaceDiagnostics.length > 0) {
      return failedWrite(namespaceDiagnostics, 'no-write-attempted');
    }

    const current = this.readMainRef();
    if (!current.ok) {
      return failedWrite(current.diagnostics, 'no-write-attempted');
    }

    const expectedHead = parseExpectedHead(input.expectedHeadCommitId);
    if (!expectedHead.ok) {
      return failedWrite(expectedHead.diagnostics, 'no-write-attempted');
    }
    const parentResult = parseNormalCommitParents(input.parentCommitIds, current.ref);
    if (!parentResult.ok) {
      return failedWrite(parentResult.diagnostics, 'no-write-attempted');
    }
    if (
      current.ref.targetCommitId !== expectedHead.commitId ||
      !refVersionsEqual(current.ref.refVersion, input.expectedMainRefVersion)
    ) {
      return failedWrite(
        [refConflictDiagnostic(current.ref, expectedHead.commitId)],
        'no-write-attempted',
      );
    }

    const created = await this.commitStore.createWorkbookCommit({
      ...input,
      documentId: this.namespace.documentId,
      parentCommitIds: [current.ref.targetCommitId],
    });
    if (created.status !== 'success') {
      return failedWrite(mapCommitDiagnostics(created.diagnostics), 'ref-not-mutated');
    }

    const advanced = this.refStore.advanceRefForGraphWrite({
      name: 'main',
      nextCommitId: created.commit.id,
      expectedHead: current.ref.targetCommitId,
      expectedRefVersion: current.ref.refVersion,
      updatedBy: input.author,
    });
    if (!advanced.ok) {
      return failedWrite(
        [refConflictDiagnostic(current.ref, expectedHead.commitId, advanced.diagnostics)],
        'ref-not-mutated',
      );
    }

    return successWrite(created.commit, advanced.ref);
  }

  async readCommit(commitId: WorkbookCommitId | string): Promise<ReadWorkbookCommitResult> {
    return this.commitStore.readCommit(commitId);
  }

  async getObjectRecord<TPayload>(
    ref: VersionDependencyRef,
  ): Promise<VersionObjectRecord<TPayload>> {
    return this.objectStore.getObjectRecord(ref);
  }

  async hasObject(ref: VersionDependencyRef): Promise<boolean> {
    return this.objectStore.hasObject(ref);
  }

  async readHead(): Promise<VersionGraphReadHeadResult> {
    const current = this.readMainRef('readHead');
    if (!current.ok) {
      return { status: 'degraded', head: null, diagnostics: current.diagnostics };
    }

    const main = graphRefFromLiveRef(current.ref);
    const readable = await this.readCommitFromRef(current.ref, 'readHead');
    if (!readable.ok) {
      return {
        status: 'degraded',
        head: null,
        main,
        diagnostics: readable.diagnostics,
      };
    }

    return {
      status: 'success',
      head: commitRefFromLiveRef(current.ref, VERSION_GRAPH_HEAD_REF),
      main,
      diagnostics: [],
    };
  }

  async readRef(name: VersionGraphRefSelector | string): Promise<VersionGraphReadRefResult> {
    const selector = parseGraphRefSelector(name, diagnostic);
    if (!selector.ok) {
      return { status: 'degraded', ref: null, diagnostics: selector.diagnostics };
    }

    if (selector.name === VERSION_GRAPH_HEAD_REF) {
      const current = this.readMainRef('readRef');
      if (!current.ok) {
        return { status: 'degraded', ref: null, diagnostics: current.diagnostics };
      }

      const ref = symbolicHeadFromLiveRef(current.ref);
      const readable = await this.readCommitFromRef(current.ref, 'readRef');
      if (!readable.ok) {
        return {
          status: 'degraded',
          ref,
          diagnostics: readable.diagnostics,
        };
      }

      return { status: 'success', ref, diagnostics: [] };
    }

    const current =
      selector.refName === 'main'
        ? this.readMainRef('readRef')
        : this.readBranchRef(selector.refName, 'readRef');
    if (!current.ok) {
      return { status: 'degraded', ref: null, diagnostics: current.diagnostics };
    }

    const ref = graphRefFromLiveRef(current.ref);
    const readable = await this.readCommitFromRef(current.ref, 'readRef');
    if (!readable.ok) {
      return {
        status: 'degraded',
        ref,
        diagnostics: readable.diagnostics,
      };
    }

    return { status: 'success', ref, diagnostics: [] };
  }

  async listCommits(
    options: VersionGraphListCommitsOptions = {},
  ): Promise<VersionGraphCommitPageResult> {
    const parsedOptions = parseListCommitsOptions(options);
    if (!parsedOptions.ok) {
      return { status: 'failed', diagnostics: parsedOptions.diagnostics };
    }

    const current = this.readMainRef('listCommits');
    if (!current.ok) {
      return { status: 'failed', diagnostics: current.diagnostics };
    }

    const collected = await this.collectReachableCommits(current.ref.targetCommitId, 'listCommits');
    if (!collected.ok) {
      const diagnostics = collected.commits.has(current.ref.targetCommitId)
        ? collected.diagnostics
        : [
            danglingRefDiagnostic(
              graphRefFromLiveRef(current.ref),
              'listCommits',
              collected.sourceDiagnostics,
            ),
            ...collected.diagnostics,
          ];
      return { status: 'failed', diagnostics };
    }

    const ordered = orderTopologicalNewestFirst(current.ref.targetCommitId, collected.commits);
    if (ordered.diagnostics.length > 0) {
      return { status: 'failed', diagnostics: ordered.diagnostics };
    }
    if (ordered.commits.length > parsedOptions.pageSize) {
      return {
        status: 'failed',
        diagnostics: [
          diagnostic(
            'VERSION_UNSUPPORTED_PAGE_TOKEN',
            'Commit pagination requires page tokens, which are not implemented by this in-memory graph store slice.',
            {
              operation: 'listCommits',
              option: 'pageToken',
              refName: VERSION_GRAPH_MAIN_REF,
              details: {
                pageSize: parsedOptions.pageSize,
                commitCount: ordered.commits.length,
              },
            },
          ),
        ],
      };
    }

    return {
      status: 'success',
      commits: ordered.commits.map(commitSummary),
      readRevision: current.ref.refVersion,
      order: 'topological-newest',
      pageSize: parsedOptions.pageSize,
      diagnostics: [],
    };
  }

  async readCommitClosure(
    commitIdInput: WorkbookCommitId | string,
  ): Promise<VersionGraphClosureReadResult> {
    const start = parseExpectedHead(commitIdInput);
    if (!start.ok) {
      return { status: 'failed', diagnostics: start.diagnostics };
    }

    const collected = await this.collectReachableCommits(start.commitId, 'readCommitClosure');
    if (!collected.ok) {
      return { status: 'failed', diagnostics: collected.diagnostics };
    }
    const ordered = orderTopologicalNewestFirst(start.commitId, collected.commits);
    if (ordered.diagnostics.length > 0) {
      return { status: 'failed', diagnostics: ordered.diagnostics };
    }
    return { status: 'success', commits: ordered.commits, diagnostics: [] };
  }

  async exportSnapshot(): Promise<InMemoryVersionGraphStoreSnapshot> {
    const listedRefs = this.refStore.listRefs({ includeTombstones: true });
    if (!listedRefs.ok) {
      throw new Error('Version graph refs could not be snapshotted.');
    }

    const recordsByDigest = new Map<string, VersionObjectRecord<unknown>>();
    for (const ref of listedRefs.refs) {
      if (ref.state !== 'live') continue;
      const closure = await this.readCommitClosure(ref.targetCommitId);
      if (closure.status !== 'success') {
        throw new Error('Version graph commit closure could not be snapshotted.');
      }
      for (const commit of closure.commits) {
        recordsByDigest.set(commit.record.digest.digest, commit.record);
        const pendingDependencies = [...commit.record.preimage.dependencies];
        for (let index = 0; index < pendingDependencies.length; index++) {
          const dependency = pendingDependencies[index];
          const dependencyRecord = await this.objectStore.getObjectRecord<unknown>(dependency);
          if (recordsByDigest.has(dependencyRecord.digest.digest)) continue;
          recordsByDigest.set(dependencyRecord.digest.digest, dependencyRecord);
          pendingDependencies.push(...dependencyRecord.preimage.dependencies);
        }
      }
    }

    return Object.freeze({
      namespace: this.namespace,
      objectRecords: Object.freeze(
        [...recordsByDigest.values()].sort((left, right) =>
          left.digest.digest.localeCompare(right.digest.digest),
        ),
      ),
      refStore: this.refStore.exportSnapshot(),
    });
  }

  private async readCommitFromRef(
    ref: LiveRefRecord,
    operation: VersionGraphStoreOperation,
  ): Promise<
    | { readonly ok: true; readonly commit: WorkbookCommit }
    | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] }
  > {
    const read = await this.commitStore.readCommit(ref.targetCommitId);
    if (read.status === 'success') {
      return { ok: true, commit: read.commit };
    }

    const graphRef = graphRefFromLiveRef(ref);
    return {
      ok: false,
      diagnostics: [
        danglingRefDiagnostic(graphRef, operation, read.diagnostics),
        ...missingCommitDiagnostics(ref.targetCommitId, operation, read.diagnostics),
      ],
    };
  }

  private async collectReachableCommits(
    rootCommitId: WorkbookCommitId,
    operation: VersionGraphStoreOperation,
  ): Promise<
    | {
        readonly ok: true;
        readonly commits: ReadonlyMap<WorkbookCommitId, WorkbookCommit>;
      }
    | {
        readonly ok: false;
        readonly commits: ReadonlyMap<WorkbookCommitId, WorkbookCommit>;
        readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
        readonly sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[];
      }
  > {
    const commits = new Map<WorkbookCommitId, WorkbookCommit>();
    const sourceDiagnostics: WorkbookCommitStoreDiagnostic[] = [];
    const diagnostics: VersionGraphStoreDiagnostic[] = [];
    const pending = [rootCommitId];
    const seen = new Set<WorkbookCommitId>();

    while (pending.length > 0) {
      const commitId = pending.shift() as WorkbookCommitId;
      if (seen.has(commitId)) continue;
      seen.add(commitId);

      const read = await this.commitStore.readCommit(commitId);
      if (read.status !== 'success') {
        sourceDiagnostics.push(...read.diagnostics);
        diagnostics.push(...missingCommitDiagnostics(commitId, operation, read.diagnostics));
        continue;
      }

      commits.set(commitId, read.commit);
      pending.push(...uniqueSortedCommitIds(read.commit.payload.parentCommitIds));
    }

    if (diagnostics.length > 0) {
      return { ok: false, commits, diagnostics, sourceDiagnostics };
    }
    return { ok: true, commits };
  }

  private readMainRef(
    operation?: VersionGraphStoreOperation,
  ):
    | { readonly ok: true; readonly ref: LiveRefRecord }
    | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
    const result = this.refStore.getRef('main');
    if (!result.ok) {
      return { ok: false, diagnostics: [refStoreDiagnostic(result.diagnostics, operation)] };
    }
    if (result.ref === null) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('VERSION_GRAPH_UNINITIALIZED', 'Graph main ref is not initialized.', {
            refName: VERSION_GRAPH_MAIN_REF,
            operation,
          }),
        ],
      };
    }
    return { ok: true, ref: result.ref };
  }

  private readBranchRef(
    refName: RefName,
    operation?: VersionGraphStoreOperation,
  ):
    | { readonly ok: true; readonly ref: LiveRefRecord }
    | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
    const result = this.refStore.getRef(refName);
    if (!result.ok) {
      return { ok: false, diagnostics: [refStoreDiagnostic(result.diagnostics, operation)] };
    }
    if (result.ref === null) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('VERSION_INVALID_OPTIONS', 'Graph branch ref was not found.', {
            refName: graphRefNameFromRefName(refName),
            operation,
            option: 'ref',
            details: { refMissing: true },
          }),
        ],
      };
    }
    return { ok: true, ref: result.ref };
  }
}

export function createInMemoryVersionGraphStore(
  options: InMemoryVersionGraphStoreOptions,
): InMemoryVersionGraphStore {
  return new InMemoryVersionGraphStore(options);
}

export async function createInMemoryVersionGraphStoreFromSnapshot(
  snapshot: InMemoryVersionGraphStoreSnapshot,
): Promise<InMemoryVersionGraphStore> {
  const namespace = normalizeVersionGraphNamespace(snapshot.namespace);
  const objectStore = createInMemoryVersionObjectStore(namespace);
  const putResult = await objectStore.putObjects(snapshot.objectRecords);
  if (putResult.status !== 'success') {
    throw new Error('Version graph object snapshot failed validation.');
  }
  return createInMemoryVersionGraphStore({
    namespace,
    objectStore,
    refStore: createInMemoryRefStore({
      versionDocumentId: namespace.documentId,
      snapshot: snapshot.refStore,
    }),
  });
}

function parseListCommitsOptions(
  options: VersionGraphListCommitsOptions,
):
  | { readonly ok: true; readonly pageSize: number }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  const pageSize = options.pageSize ?? VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'listCommits pageSize must be an integer from 1 through 500.',
          {
            operation: 'listCommits',
            option: 'pageSize',
            details: {
              min: 1,
              max: VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE,
              receivedPageSize: Number.isFinite(pageSize) ? pageSize : String(pageSize),
            },
          },
        ),
      ],
    };
  }

  if (options.pageToken !== undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_STALE_PAGE_CURSOR',
          'listCommits page tokens are not implemented by this in-memory graph store slice.',
          {
            operation: 'listCommits',
            option: 'pageToken',
            details: { pageTokenUnsupported: true },
          },
        ),
      ],
    };
  }

  return { ok: true, pageSize };
}

function parseExpectedHead(
  value: WorkbookCommitId | string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value) };
  } catch {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit id must be commit:sha256:<64 hex>.'),
      ],
    };
  }
}

function parseNormalCommitParents(
  value: readonly (WorkbookCommitId | string)[] | undefined,
  currentRef: LiveRefRecord,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  if (value === undefined) return { ok: true };

  const parsed = parseVc04ParentCommitIds(value);
  if (!parsed.ok) return { ok: false, diagnostics: mapCommitDiagnostics(parsed.diagnostics) };
  if (
    parsed.parentCommitIds.length !== 1 ||
    parsed.parentCommitIds[0] !== currentRef.targetCommitId
  ) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(currentRef, parsed.parentCommitIds[0] ?? currentRef.targetCommitId),
      ],
    };
  }
  return { ok: true };
}

function validateInputNamespaces(
  expectedNamespaceKey: string,
  input: VersionGraphCommitContentInput,
): readonly VersionGraphStoreDiagnostic[] {
  const diagnostics: VersionGraphStoreDiagnostic[] = [];
  for (const [path, record] of collectInputRecords(input)) {
    if (!hasNamespace(record)) continue;
    try {
      if (versionGraphNamespaceKey(record.namespace) !== expectedNamespaceKey) {
        diagnostics.push(
          diagnostic('VERSION_WRONG_NAMESPACE', 'Object record namespace is outside this graph.', {
            namespace: record.namespace,
            details: { path },
          }),
        );
      }
    } catch {
      diagnostics.push(
        diagnostic('VERSION_WRONG_NAMESPACE', 'Object record namespace is invalid.', {
          details: { path },
        }),
      );
    }
  }
  return diagnostics;
}

function collectInputRecords(
  input: VersionGraphCommitContentInput,
): readonly (readonly [string, VersionObjectRecord<unknown> | undefined])[] {
  return [
    ['snapshotRootRecord', input.snapshotRootRecord],
    ['semanticChangeSetRecord', input.semanticChangeSetRecord],
    ...(input.mutationSegmentRecords ?? []).map(
      (record, index) => [`mutationSegmentRecords[${index}]`, record] as const,
    ),
    ['redactionSummaryRecord', input.redactionSummaryRecord],
    ['verificationSummaryRecord', input.verificationSummaryRecord],
  ];
}

function hasNamespace(
  record: VersionObjectRecord<unknown> | undefined,
): record is VersionObjectRecord<unknown> {
  return typeof record === 'object' && record !== null && 'namespace' in record;
}

function mapCommitDiagnostics(
  diagnostics: readonly WorkbookCommitStoreDiagnostic[],
  operation?: VersionGraphStoreOperation,
): readonly VersionGraphStoreDiagnostic[] {
  return diagnostics.map((item) => {
    const wrongNamespace = item.sourceDiagnostics?.find(
      (source) => source.code === 'VERSION_WRONG_NAMESPACE',
    );
    if (wrongNamespace) {
      return diagnostic(
        'VERSION_WRONG_NAMESPACE',
        'Object record namespace is outside this graph.',
        {
          operation,
          sourceDiagnostics: [wrongNamespace],
        },
      );
    }

    const missingObject = item.sourceDiagnostics?.find(
      (source) => source.code === 'VERSION_OBJECT_NOT_FOUND',
    );
    if (missingObject) {
      return missingCommitDiagnostic(
        item.commitId,
        operation,
        [item],
        'Commit object is missing from the graph store.',
      );
    }

    const code = graphDiagnosticCodeFromCommit(item.code);
    return diagnostic(code, item.message, {
      commitId: item.commitId,
      operation,
      sourceDiagnostics: [item],
    });
  });
}

function graphDiagnosticCodeFromCommit(
  code: WorkbookCommitStoreDiagnostic['code'],
): VersionGraphStoreDiagnosticCode {
  if (code === 'VERSION_OBJECT_STORE_FAILURE') return 'VERSION_OBJECT_STORE_FAILURE';
  if (code === 'VERSION_MISSING_PARENT') return 'VERSION_MISSING_PARENT';
  if (code === 'VERSION_UNSUPPORTED_PARENT_COMMIT') return 'VERSION_UNSUPPORTED_PARENT_COMMIT';
  if (code === 'VERSION_INVALID_COMMIT_ID') return 'VERSION_INVALID_COMMIT_ID';
  if (code === 'VERSION_INVALID_COMMIT_PAYLOAD') return 'VERSION_INVALID_COMMIT_PAYLOAD';
  if (code === 'VERSION_WRONG_DOCUMENT') return 'VERSION_WRONG_DOCUMENT';
  return 'VERSION_MISSING_DEPENDENCY';
}

function missingCommitDiagnostics(
  commitId: WorkbookCommitId,
  operation: VersionGraphStoreOperation,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
): readonly VersionGraphStoreDiagnostic[] {
  const mapped = mapCommitDiagnostics(sourceDiagnostics, operation);
  if (mapped.length === 0) {
    return [
      missingCommitDiagnostic(commitId, operation, sourceDiagnostics, 'Commit object is missing.'),
    ];
  }
  return mapped.map((item) =>
    item.commitId === undefined
      ? {
          ...item,
          commitId,
          objectKind: item.objectKind ?? 'commit',
        }
      : item,
  );
}

function missingCommitDiagnostic(
  commitId: WorkbookCommitId | undefined,
  operation: VersionGraphStoreOperation | undefined,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
  message: string,
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_MISSING_OBJECT', message, {
    commitId,
    objectKind: 'commit',
    operation,
    sourceDiagnostics,
  });
}

function danglingRefDiagnostic(
  ref: VersionGraphRef,
  operation: VersionGraphStoreOperation,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
): VersionGraphStoreDiagnostic {
  return diagnostic(
    'VERSION_DANGLING_REF',
    'Graph ref points at a missing or unreadable commit.',
    {
      refName: ref.name,
      commitId: ref.commitId,
      objectKind: 'commit',
      operation,
      sourceDiagnostics,
    },
  );
}

function refConflictDiagnostic(
  currentRef: LiveRefRecord,
  expectedHead: WorkbookCommitId,
  sourceDiagnostics: readonly VersionDiagnostic[] = [],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph main ref no longer matches expected head.', {
    refName: VERSION_GRAPH_MAIN_REF,
    commitId: currentRef.targetCommitId,
    details: {
      expectedHead,
      actualHead: currentRef.targetCommitId,
      expectedDigest: objectDigestFromWorkbookCommitId(expectedHead).digest,
      actualDigest: objectDigestFromWorkbookCommitId(currentRef.targetCommitId).digest,
    },
    sourceDiagnostics,
  });
}

function refStoreDiagnostic(
  sourceDiagnostics: readonly VersionDiagnostic[],
  operation?: VersionGraphStoreOperation,
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph ref store rejected the operation.', {
    refName: VERSION_GRAPH_MAIN_REF,
    operation,
    sourceDiagnostics,
  });
}

function successWrite(commit: WorkbookCommit, ref: LiveRefRecord): VersionGraphWriteSuccess {
  return {
    status: 'success',
    commit,
    main: graphRefFromLiveRef(ref),
    diagnostics: [],
  };
}

function failedWrite(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  mutationGuarantee: VersionGraphWriteFailure['mutationGuarantee'],
): VersionGraphWriteFailure {
  return { status: 'failed', diagnostics, mutationGuarantee };
}

function commitSummary(commit: WorkbookCommit): VersionGraphCommitSummary {
  return {
    id: commit.id,
    parents: [...commit.payload.parentCommitIds],
    createdAt: commit.payload.createdAt,
    author: { ...commit.payload.author },
  };
}

function diagnostic(
  code: VersionGraphStoreDiagnosticCode,
  message: string,
  options: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionGraphStoreDiagnostic {
  return {
    code,
    severity:
      code === 'VERSION_OBJECT_STORE_FAILURE' ||
      code === 'VERSION_DANGLING_REF' ||
      code === 'VERSION_MISSING_OBJECT'
        ? 'corruption'
        : 'error',
    message,
    ...options,
  };
}

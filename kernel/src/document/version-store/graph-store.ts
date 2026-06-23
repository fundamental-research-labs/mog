import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  objectDigestFromWorkbookCommitId,
  type ObjectDigest,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from './object-digest';
import {
  createInMemoryVersionObjectStore,
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type InMemoryVersionObjectStore,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
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
import {
  assertRefStoreSnapshotManifestInvariants,
  assertSnapshotRefTargetsReadable,
} from './graph-store-snapshot';
import type { InMemoryVersionGraphStoreSnapshot } from './graph-store-snapshot';
import {
  createGraphBranchLifecycle,
  type GraphBranchLifecycle,
} from './graph-store-branch-lifecycle';
import {
  graphCommitSummary,
  graphWriteSuccess,
  parseGraphCommitExpectedHead,
} from './graph-store-commit-helpers';
import { fastForwardGraphRef } from './graph-store-fast-forward';
import {
  VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE,
  VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE,
  parseListCommitsOptions,
} from './graph-store-list-options';
import { resolveListCommitsRoot } from './graph-store-list-commits-root';
import type { VersionGraphStoreOperation } from './graph-store-operation';
import { parseGraphCommitParentPlan, type GraphCommitParentPlan } from './graph-store-parent-plans';
import { orderTopologicalNewestFirst, uniqueSortedCommitIds } from './graph-store-traversal';
import type { RefName } from './ref-name';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  commitRefFromLiveRef,
  graphRefFromLiveRef,
  graphRefNameFromRefName,
  missingGraphCommitExpectedRefVersionDiagnostic,
  parseGraphCommitTargetRef,
  parseGraphRefSelector,
  symbolicHeadFromLiveRef,
  type VersionGraphBranchRefName,
} from './graph-store-refs';

export { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph-store-refs';
export {
  VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE,
  VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE,
} from './graph-store-list-options';
export type { VersionGraphStoreOperation } from './graph-store-operation';
export type { VersionGraphBranchRefName } from './graph-store-refs';

export type VersionGraphCommitContentInput = Omit<
  CreateWorkbookCommitInput,
  'documentId' | 'parentCommitIds'
>;
export type InitializeVersionGraphInput = VersionGraphCommitContentInput;
export type CommitVersionGraphInput = VersionGraphCommitContentInput & {
  readonly targetRef?: VersionGraphBranchRefName | string;
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion?: RefVersion;
  readonly expectedTargetRefVersion?: RefVersion;
  readonly parentCommitIds?: readonly (WorkbookCommitId | string)[];
};
export type MergeVersionGraphInput = VersionGraphCommitContentInput & {
  readonly targetRef?: VersionGraphBranchRefName | string;
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion?: RefVersion;
  readonly expectedTargetRefVersion?: RefVersion;
  readonly mergeParentCommitId: WorkbookCommitId | string;
};

export type FastForwardVersionGraphInput = {
  readonly targetRef?: VersionGraphBranchRefName | string;
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion?: RefVersion;
  readonly expectedTargetRefVersion?: RefVersion;
  readonly nextCommitId: WorkbookCommitId | string;
  readonly updatedBy: VersionAuthor;
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
  readonly ref?: VersionGraphRefSelector | string;
  readonly from?: WorkbookCommitId | string;
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
  readonly objectDigest?: ObjectDigest;
  readonly dependency?: VersionDependencyRef;
  readonly objectKind?: 'commit';
  readonly operation?: VersionGraphStoreOperation;
  readonly option?: 'pageSize' | 'pageToken' | 'ref' | 'from';
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
  readonly ref: VersionGraphRef;
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
export type { InMemoryVersionGraphStoreSnapshot } from './graph-store-snapshot';

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
      return graphWriteSuccess(created.commit, initialized.ref);
    }

    const existing = this.refStore.getRef('main');
    if (existing.ok && existing.ref?.targetCommitId === created.commit.id) {
      return graphWriteSuccess(created.commit, existing.ref);
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
    return this.commitWithParentPlan(input, {
      kind: 'normal',
      parentCommitIds: input.parentCommitIds,
    });
  }

  async mergeCommit(input: MergeVersionGraphInput): Promise<VersionGraphWriteResult> {
    return this.commitWithParentPlan(input, {
      kind: 'merge',
      mergeParentCommitId: input.mergeParentCommitId,
    });
  }

  async fastForwardRef(input: FastForwardVersionGraphInput): Promise<VersionGraphWriteResult> {
    return fastForwardGraphRef(this, input);
  }

  async putObjects(
    batch: readonly VersionObjectRecord<unknown>[],
  ): Promise<VersionObjectPutBatchResult> {
    return this.objectStore.putObjects(batch);
  }

  private async commitWithParentPlan(
    input: CommitVersionGraphInput | MergeVersionGraphInput,
    parentPlan: GraphCommitParentPlan,
  ): Promise<VersionGraphWriteResult> {
    const namespaceDiagnostics = validateInputNamespaces(this.namespaceKey, input);
    if (namespaceDiagnostics.length > 0) {
      return failedWrite(namespaceDiagnostics, 'no-write-attempted');
    }

    const target = parseGraphCommitTargetRef(input.targetRef, diagnostic);
    if (!target.ok) {
      return failedWrite(target.diagnostics, 'no-write-attempted');
    }

    const expectedRefVersion = input.expectedTargetRefVersion ?? input.expectedMainRefVersion;
    if (expectedRefVersion === undefined) {
      return failedWrite(
        [missingGraphCommitExpectedRefVersionDiagnostic(target.name, diagnostic)],
        'no-write-attempted',
      );
    }

    const current =
      target.refName === 'main'
        ? this.readMainRef('commit')
        : this.readBranchRef(target.refName, 'commit');
    if (!current.ok) {
      return failedWrite(current.diagnostics, 'no-write-attempted');
    }

    const main = target.refName === 'main' ? undefined : this.readMainRef('commit');
    if (main !== undefined && !main.ok) {
      return failedWrite(main.diagnostics, 'no-write-attempted');
    }

    const expectedHead = parseGraphCommitExpectedHead(input.expectedHeadCommitId, diagnostic);
    if (!expectedHead.ok) {
      return failedWrite(expectedHead.diagnostics, 'no-write-attempted');
    }
    const parentResult = parseGraphCommitParentPlan(parentPlan, current.ref, {
      diagnostic,
      mapCommitDiagnostics,
      refConflictDiagnostic,
    });
    if (!parentResult.ok) {
      return failedWrite(parentResult.diagnostics, 'no-write-attempted');
    }
    if (
      current.ref.targetCommitId !== expectedHead.commitId ||
      !refVersionsEqual(current.ref.refVersion, expectedRefVersion)
    ) {
      return failedWrite(
        [refConflictDiagnostic(current.ref, expectedHead.commitId)],
        'no-write-attempted',
      );
    }

    const created = await this.commitStore.createWorkbookCommit({
      ...input,
      documentId: this.namespace.documentId,
      parentCommitIds: parentResult.parentCommitIds,
    });
    if (created.status !== 'success') {
      return failedWrite(mapCommitDiagnostics(created.diagnostics), 'ref-not-mutated');
    }

    const advanced = this.refStore.advanceRefForGraphWrite({
      name: current.ref.name,
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

    return graphWriteSuccess(created.commit, advanced.ref, main?.ref ?? advanced.ref);
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

  async createBranch(...args: Parameters<GraphBranchLifecycle['createBranch']>) {
    return this.branchService().createBranch(...args);
  }
  async readBranch(...args: Parameters<GraphBranchLifecycle['readBranch']>) {
    return this.branchService().readBranch(...args);
  }
  async listBranches(...args: Parameters<GraphBranchLifecycle['listBranches']>) {
    return this.branchService().listBranches(...args);
  }
  async fastForwardBranch(...args: Parameters<GraphBranchLifecycle['fastForwardBranch']>) {
    return this.branchService().fastForwardBranch(...args);
  }
  async deleteBranch(...args: Parameters<GraphBranchLifecycle['deleteBranch']>) {
    return this.branchService().deleteBranch(...args);
  }
  async getHead() {
    return this.branchService().getHead();
  }

  async listCommits(
    options: VersionGraphListCommitsOptions = {},
  ): Promise<VersionGraphCommitPageResult> {
    const parsedOptions = parseListCommitsOptions(options, diagnostic);
    if (!parsedOptions.ok) {
      return { status: 'failed', diagnostics: parsedOptions.diagnostics };
    }

    const root = resolveListCommitsRoot(parsedOptions.target, {
      readMainRef: () => this.readMainRef('listCommits'),
      readBranchRef: (refName) => this.readBranchRef(refName, 'listCommits'),
    });
    if (!root.ok) {
      return { status: 'failed', diagnostics: root.diagnostics };
    }

    const collected = await this.collectReachableCommits(root.commitId, 'listCommits');
    if (!collected.ok) {
      const diagnostics =
        root.ref && !collected.commits.has(root.commitId)
          ? [
              danglingRefDiagnostic(root.ref, 'listCommits', collected.sourceDiagnostics),
              ...collected.diagnostics,
            ]
          : collected.diagnostics;
      return { status: 'failed', diagnostics };
    }

    const ordered = orderTopologicalNewestFirst(root.commitId, collected.commits, 'listCommits');
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
              ...(root.ref ? { refName: root.ref.name } : {}),
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
      commits: ordered.commits.map(graphCommitSummary),
      readRevision: root.readRevision,
      order: 'topological-newest',
      pageSize: parsedOptions.pageSize,
      diagnostics: [],
    };
  }

  async readCommitClosure(
    commitIdInput: WorkbookCommitId | string,
  ): Promise<VersionGraphClosureReadResult> {
    const start = parseGraphCommitExpectedHead(commitIdInput, diagnostic);
    if (!start.ok) {
      return { status: 'failed', diagnostics: start.diagnostics };
    }

    const collected = await this.collectReachableCommits(start.commitId, 'readCommitClosure');
    if (!collected.ok) {
      return { status: 'failed', diagnostics: collected.diagnostics };
    }
    const ordered = orderTopologicalNewestFirst(
      start.commitId,
      collected.commits,
      'readCommitClosure',
    );
    if (ordered.diagnostics.length > 0) {
      return { status: 'failed', diagnostics: ordered.diagnostics };
    }
    return { status: 'success', commits: ordered.commits, diagnostics: [] };
  }

  async exportSnapshot(): Promise<InMemoryVersionGraphStoreSnapshot> {
    const refStore = this.refStore.exportSnapshot();
    assertRefStoreSnapshotManifestInvariants(refStore, this.namespace.documentId);
    await assertSnapshotRefTargetsReadable(refStore.records, (commitId) =>
      this.readCommit(commitId),
    );

    return Object.freeze({
      namespace: this.namespace,
      objectRecords: this.objectStore.listObjectRecords(),
      refStore,
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

  private branchService(): GraphBranchLifecycle {
    return createGraphBranchLifecycle(this.refStore);
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
  assertRefStoreSnapshotManifestInvariants(snapshot.refStore, namespace.documentId);
  const objectStore = createInMemoryVersionObjectStore(namespace);
  const putResult = await objectStore.putObjects(snapshot.objectRecords);
  if (putResult.status !== 'success') {
    throw new Error('Version graph object snapshot failed validation.');
  }
  const graph = createInMemoryVersionGraphStore({
    namespace,
    objectStore,
    refStore: createInMemoryRefStore({
      versionDocumentId: namespace.documentId,
      snapshot: snapshot.refStore,
    }),
  });
  await assertSnapshotRefTargetsReadable(snapshot.refStore.records, (commitId) =>
    graph.readCommit(commitId),
  );
  return graph;
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
            details: { path, namespace: 'redacted' },
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
    const sourceItem = sanitizeCommitDiagnostic(item);
    const wrongNamespace = sourceItem.sourceDiagnostics?.find(
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

    const missingObject = sourceItem.sourceDiagnostics?.find(
      (source) => source.code === 'VERSION_OBJECT_NOT_FOUND',
    );
    if (missingObject && sourceItem.code === 'VERSION_OBJECT_STORE_FAILURE') {
      return missingCommitDiagnostic(
        sourceItem.commitId,
        operation,
        [sourceItem],
        'Commit object is missing from the graph store.',
      );
    }

    const code = graphDiagnosticCodeFromCommit(sourceItem.code);
    return diagnostic(code, sourceItem.message, {
      commitId: sourceItem.commitId,
      objectDigest: sourceItem.objectDigest,
      dependency: sourceItem.dependency,
      operation,
      sourceDiagnostics: [sourceItem],
      details: sourceItem.details,
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
    sourceDiagnostics: sourceDiagnostics.map(sanitizeCommitDiagnostic),
  });
}

function danglingRefDiagnostic(
  ref: VersionGraphRef,
  operation: VersionGraphStoreOperation,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_DANGLING_REF', 'Graph ref points at a missing or unreadable commit.', {
    refName: ref.name,
    commitId: ref.commitId,
    objectKind: 'commit',
    operation,
    sourceDiagnostics: sourceDiagnostics.map(sanitizeCommitDiagnostic),
  });
}

function sanitizeCommitDiagnostic(
  diagnostic: WorkbookCommitStoreDiagnostic,
): WorkbookCommitStoreDiagnostic {
  if (diagnostic.sourceDiagnostics === undefined) return diagnostic;
  return {
    ...diagnostic,
    sourceDiagnostics: diagnostic.sourceDiagnostics.map(
      ({ namespace: _namespace, path: _path, ...source }) => source,
    ),
  };
}

function refConflictDiagnostic(
  currentRef: LiveRefRecord,
  expectedHead: WorkbookCommitId,
  sourceDiagnostics: readonly VersionDiagnostic[] = [],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph ref no longer matches expected head.', {
    refName: graphRefNameFromRefName(currentRef.name),
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

function failedWrite(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  mutationGuarantee: VersionGraphWriteFailure['mutationGuarantee'],
): VersionGraphWriteFailure {
  return { status: 'failed', diagnostics, mutationGuarantee };
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

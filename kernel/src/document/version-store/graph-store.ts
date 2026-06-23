import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { ObjectDigest, VersionDependencyRef, WorkbookCommitId } from './object-digest';
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
  type ProviderEpoch,
  type RefVersion,
  type VersionDiagnostic,
} from './ref-store';
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
import {
  danglingRefDiagnostic,
  diagnostic,
  mapCommitDiagnostics,
  refConflictDiagnostic,
} from './graph-store-diagnostics';
import { fastForwardGraphRef } from './graph-store-fast-forward';
import {
  VERSION_GRAPH_LIST_COMMITS_DEFAULT_PAGE_SIZE,
  VERSION_GRAPH_LIST_COMMITS_MAX_PAGE_SIZE,
  parseListCommitsOptions,
} from './graph-store-list-options';
import { resolveListCommitsRoot } from './graph-store-list-commits-root';
import {
  createInMemoryVersionGraphStorePartsFromSnapshot,
  exportInMemoryVersionGraphStoreSnapshot,
} from './graph-store-object-helpers';
import type { VersionGraphStoreOperation } from './graph-store-operation';
import { parseGraphCommitParentPlan, type GraphCommitParentPlan } from './graph-store-parent-plans';
import {
  createGraphStoreRefHelpers,
  type GraphStoreRefHelpers,
} from './graph-store-ref-helpers';
import { validateInputNamespaces } from './graph-store-record-validation';
import { failedGraphWrite } from './graph-store-results';
import { orderTopologicalNewestFirst } from './graph-store-traversal';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  commitRefFromLiveRef,
  graphRefFromLiveRef,
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
  private readonly refs: GraphStoreRefHelpers;

  constructor(options: InMemoryVersionGraphStoreOptions) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.objectStore = options.objectStore ?? createInMemoryVersionObjectStore(this.namespace);
    this.commitStore = options.commitStore ?? createInMemoryWorkbookCommitStore(this.objectStore);
    this.refStore =
      options.refStore ?? createInMemoryRefStore({ versionDocumentId: this.namespace.documentId });
    this.refs = createGraphStoreRefHelpers({
      commitStore: this.commitStore,
      refStore: this.refStore,
    });
  }

  async initializeGraph(input: InitializeVersionGraphInput): Promise<VersionGraphWriteResult> {
    const namespaceDiagnostics = validateInputNamespaces(this.namespaceKey, input);
    if (namespaceDiagnostics.length > 0) {
      return failedGraphWrite(namespaceDiagnostics, 'no-write-attempted');
    }

    const created = await this.commitStore.createWorkbookCommit({
      ...input,
      documentId: this.namespace.documentId,
      parentCommitIds: [],
    });
    if (created.status !== 'success') {
      return failedGraphWrite(mapCommitDiagnostics(created.diagnostics), 'no-write-attempted');
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

    return failedGraphWrite(
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
      return failedGraphWrite(namespaceDiagnostics, 'no-write-attempted');
    }

    const target = parseGraphCommitTargetRef(input.targetRef, diagnostic);
    if (!target.ok) {
      return failedGraphWrite(target.diagnostics, 'no-write-attempted');
    }

    const expectedRefVersion = input.expectedTargetRefVersion ?? input.expectedMainRefVersion;
    if (expectedRefVersion === undefined) {
      return failedGraphWrite(
        [missingGraphCommitExpectedRefVersionDiagnostic(target.name, diagnostic)],
        'no-write-attempted',
      );
    }

    const current =
      target.refName === 'main'
        ? this.refs.readMainRef('commit')
        : this.refs.readBranchRef(target.refName, 'commit');
    if (!current.ok) {
      return failedGraphWrite(current.diagnostics, 'no-write-attempted');
    }

    const main = target.refName === 'main' ? undefined : this.refs.readMainRef('commit');
    if (main !== undefined && !main.ok) {
      return failedGraphWrite(main.diagnostics, 'no-write-attempted');
    }

    const expectedHead = parseGraphCommitExpectedHead(input.expectedHeadCommitId, diagnostic);
    if (!expectedHead.ok) {
      return failedGraphWrite(expectedHead.diagnostics, 'no-write-attempted');
    }
    const parentResult = parseGraphCommitParentPlan(parentPlan, current.ref, {
      diagnostic,
      mapCommitDiagnostics,
      refConflictDiagnostic,
    });
    if (!parentResult.ok) {
      return failedGraphWrite(parentResult.diagnostics, 'no-write-attempted');
    }
    if (
      current.ref.targetCommitId !== expectedHead.commitId ||
      !refVersionsEqual(current.ref.refVersion, expectedRefVersion)
    ) {
      return failedGraphWrite(
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
      return failedGraphWrite(mapCommitDiagnostics(created.diagnostics), 'ref-not-mutated');
    }

    const advanced = this.refStore.advanceRefForGraphWrite({
      name: current.ref.name,
      nextCommitId: created.commit.id,
      expectedHead: current.ref.targetCommitId,
      expectedRefVersion: current.ref.refVersion,
      updatedBy: input.author,
    });
    if (!advanced.ok) {
      return failedGraphWrite(
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
    const current = this.refs.readMainRef('readHead');
    if (!current.ok) {
      return { status: 'degraded', head: null, diagnostics: current.diagnostics };
    }

    const main = graphRefFromLiveRef(current.ref);
    const readable = await this.refs.readCommitFromRef(current.ref, 'readHead');
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
      const current = this.refs.readMainRef('readRef');
      if (!current.ok) {
        return { status: 'degraded', ref: null, diagnostics: current.diagnostics };
      }

      const ref = symbolicHeadFromLiveRef(current.ref);
      const readable = await this.refs.readCommitFromRef(current.ref, 'readRef');
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
        ? this.refs.readMainRef('readRef')
        : this.refs.readBranchRef(selector.refName, 'readRef');
    if (!current.ok) {
      return { status: 'degraded', ref: null, diagnostics: current.diagnostics };
    }

    const ref = graphRefFromLiveRef(current.ref);
    const readable = await this.refs.readCommitFromRef(current.ref, 'readRef');
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
      readMainRef: () => this.refs.readMainRef('listCommits'),
      readBranchRef: (refName) => this.refs.readBranchRef(refName, 'listCommits'),
    });
    if (!root.ok) {
      return { status: 'failed', diagnostics: root.diagnostics };
    }

    const collected = await this.refs.collectReachableCommits(root.commitId, 'listCommits');
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

    const collected = await this.refs.collectReachableCommits(start.commitId, 'readCommitClosure');
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
    return exportInMemoryVersionGraphStoreSnapshot({
      namespace: this.namespace,
      objectStore: this.objectStore,
      refStore: this.refStore,
      readCommit: (commitId) => this.readCommit(commitId),
    });
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
  const parts = await createInMemoryVersionGraphStorePartsFromSnapshot(snapshot);
  return createInMemoryVersionGraphStore(parts);
}

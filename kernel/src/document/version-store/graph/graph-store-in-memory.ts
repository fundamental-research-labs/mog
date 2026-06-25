import {
  createInMemoryWorkbookCommitStore,
  type InMemoryWorkbookCommitStore,
  type ReadWorkbookCommitResult,
} from '../commit-store';
import {
  createGraphBranchLifecycle,
  type GraphBranchLifecycle,
} from './graph-store-branch-lifecycle';
import { fastForwardGraphRef } from './graph-store-fast-forward';
import {
  createInMemoryVersionGraphStorePartsFromSnapshot,
  exportInMemoryVersionGraphStoreSnapshot,
} from './graph-store-object-helpers';
import type { GraphCommitParentPlan } from './graph-store-parent-plans';
import { createGraphStoreRefHelpers, type GraphStoreRefHelpers } from './graph-store-ref-helpers';
import {
  listVersionGraphCommits,
  readVersionGraphCommitClosure,
  readVersionGraphHead,
  readVersionGraphRef,
  type GraphStoreReadContext,
} from './graph-store-read-operations';
import type { InMemoryVersionGraphStoreSnapshot } from './graph-store-snapshot';
import {
  commitVersionGraphWithParentPlan,
  initializeVersionGraph,
  type GraphStoreWriteContext,
} from './graph-store-write-operations';
import type {
  CommitVersionGraphInput,
  FastForwardVersionGraphInput,
  InMemoryVersionGraphStoreOptions,
  InitializeVersionGraphInput,
  MergeVersionGraphInput,
  VersionGraphClosureReadResult,
  VersionGraphCommitPageResult,
  VersionGraphListCommitsOptions,
  VersionGraphReadHeadResult,
  VersionGraphReadRefResult,
  VersionGraphRefSelector,
  VersionGraphWriteResult,
} from './graph-store-types';
import type { VersionDependencyRef, WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionObjectStore,
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type InMemoryVersionObjectStore,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';
import { createInMemoryRefStore, type InMemoryRefStore } from '../refs/ref-store';

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
    return initializeVersionGraph(this.writeContext(), input);
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
    return commitVersionGraphWithParentPlan(this.writeContext(), input, parentPlan);
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
    return readVersionGraphHead(this.readContext());
  }

  async readRef(name: VersionGraphRefSelector | string): Promise<VersionGraphReadRefResult> {
    return readVersionGraphRef(this.readContext(), name);
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
    return listVersionGraphCommits(this.readContext(), options);
  }

  async readCommitClosure(
    commitIdInput: WorkbookCommitId | string,
  ): Promise<VersionGraphClosureReadResult> {
    return readVersionGraphCommitClosure(this.readContext(), commitIdInput);
  }

  async exportSnapshot(): Promise<InMemoryVersionGraphStoreSnapshot> {
    return exportInMemoryVersionGraphStoreSnapshot({
      namespace: this.namespace,
      objectStore: this.objectStore,
      refStore: this.refStore,
      readCommit: (commitId) => this.readCommit(commitId),
    });
  }

  private writeContext(): GraphStoreWriteContext {
    return {
      namespace: this.namespace,
      namespaceKey: this.namespaceKey,
      commitStore: this.commitStore,
      refStore: this.refStore,
      refs: this.refs,
    };
  }

  private readContext(): GraphStoreReadContext {
    return { cursorNamespaceKey: this.namespaceKey, refs: this.refs };
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

import {
  createInMemoryVersionGraphStore,
  type CommitVersionGraphInput,
  type FastForwardVersionGraphInput,
  type InMemoryVersionGraphStore,
  type MergeVersionGraphInput,
  type VersionGraphClosureReadResult,
  type VersionGraphCommitPageResult,
  type VersionGraphListCommitsOptions,
  type VersionGraphReadHeadResult,
  type VersionGraphReadRefResult,
  type VersionGraphRefSelector,
  type VersionGraphWriteResult,
} from '../graph';
import type { ReadWorkbookCommitResult } from '../commit-store';
import {
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from '../object-digest';
import {
  normalizeVersionGraphNamespace,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';
import {
  createIndexedDbGraphBranchLifecycle,
  type IndexedDbGraphBranchLifecycle,
} from '../provider-indexeddb-branch-lifecycle';
import {
  failedIndexedDbBackendGraphCommit,
  failedIndexedDbBackendMissingRefCasMetadata,
  failedIndexedDbBackendObjectBatch,
  failedIndexedDbBackendRefCasConflict,
} from './backend-diagnostics';
import { storageRefNameFromGraphRefName } from './backend-serialization';
import {
  RefCasConflictError,
  errorMessage,
  failedGraphWrite,
  graphDiagnostic,
  normalizeVersionAccessContext,
  persistGraphSnapshot,
  persistObjectRecords,
} from './internal';
import { graphLoadDiagnostic, loadGraphSnapshot } from '../provider-indexeddb-reload';
import type {
  VersionAccessContext,
  VersionGraphInitializeInput,
  VersionGraphStore,
} from '../provider';
import { normalizeVersionDocumentScope, type VersionDocumentScope } from '../registry';

export class IndexedDbVersionGraphStore implements VersionGraphStore {
  readonly namespace: VersionGraphNamespace;

  private readonly documentScope: VersionDocumentScope;
  private readonly getDb: () => Promise<IDBDatabase>;
  private readonly branchLifecycle: IndexedDbGraphBranchLifecycle;

  constructor(options: {
    readonly namespace: VersionGraphNamespace;
    readonly documentScope: VersionDocumentScope;
    readonly accessContext: VersionAccessContext;
    readonly getDb: () => Promise<IDBDatabase>;
  }) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    normalizeVersionAccessContext(options.accessContext);
    this.getDb = options.getDb;
    this.branchLifecycle = createIndexedDbGraphBranchLifecycle({
      namespace: this.namespace,
      documentScope: this.documentScope,
      getDb: this.getDb,
    });
  }

  async initializeGraph(
    input: VersionGraphInitializeInput['rootWrite'],
  ): Promise<VersionGraphWriteResult> {
    const graph = createInMemoryVersionGraphStore({ namespace: this.namespace });
    const initialized = await graph.initializeGraph(input);
    if (initialized.status !== 'success') return initialized;

    try {
      await persistGraphSnapshot({
        db: await this.getDb(),
        snapshot: await graph.exportSnapshot(),
        documentScope: this.documentScope,
        mode: { kind: 'initialize' },
      });
      return initialized;
    } catch (error) {
      return failedGraphWrite(
        [
          graphDiagnostic(
            'VERSION_OBJECT_STORE_FAILURE',
            'IndexedDB graph initialization failed.',
            {
              operation: 'initializeGraph',
              namespace: this.namespace,
              details: { cause: errorMessage(error) },
            },
          ),
        ],
        'no-write-attempted',
      );
    }
  }

  async commit(input: CommitVersionGraphInput): Promise<VersionGraphWriteResult> {
    return this.commitWithLoadedGraph('commit', input, (graph) => graph.commit(input));
  }

  async mergeCommit(input: MergeVersionGraphInput): Promise<VersionGraphWriteResult> {
    return this.commitWithLoadedGraph('mergeCommit', input, (graph) => graph.mergeCommit(input));
  }

  async fastForwardRef(input: FastForwardVersionGraphInput): Promise<VersionGraphWriteResult> {
    return this.commitWithLoadedGraph('fastForwardRef', input, (graph) =>
      graph.fastForwardRef(input),
    );
  }

  async putObjects(
    batch: readonly VersionObjectRecord<unknown>[],
  ): Promise<VersionObjectPutBatchResult> {
    let graph: InMemoryVersionGraphStore;
    try {
      graph = await this.loadGraph('putObjects');
    } catch (error) {
      return failedIndexedDbBackendObjectBatch(
        'IndexedDB graph could not be loaded while writing objects.',
        { cause: errorMessage(error) },
      );
    }

    const putResult = await graph.putObjects(batch);
    if (putResult.status !== 'success') return putResult;

    try {
      await persistObjectRecords({
        db: await this.getDb(),
        namespace: this.namespace,
        documentScope: this.documentScope,
        records: putResult.records,
      });
      return putResult;
    } catch (error) {
      return failedIndexedDbBackendObjectBatch(
        'IndexedDB graph object batch could not be persisted.',
        { cause: errorMessage(error) },
      );
    }
  }

  async readCommit(commitId: WorkbookCommitId | string): Promise<ReadWorkbookCommitResult> {
    let parsedCommitId: WorkbookCommitId;
    try {
      parsedCommitId = parseWorkbookCommitId(commitId);
    } catch {
      return {
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_INVALID_COMMIT_ID',
            severity: 'error',
            message: 'Commit id must be commit:sha256:<64 hex>.',
          },
        ],
      };
    }

    try {
      return await (await this.loadGraph('readCommit')).readCommit(parsedCommitId);
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_OBJECT_STORE_FAILURE',
            severity: 'error',
            message: 'IndexedDB graph could not be loaded while reading commit.',
            commitId: parsedCommitId,
            details: { cause: errorMessage(error) },
          },
        ],
      };
    }
  }

  async getObjectRecord<TPayload>(
    ref: VersionDependencyRef,
  ): Promise<VersionObjectRecord<TPayload>> {
    return (await this.loadGraph('getObjectRecord')).getObjectRecord<TPayload>(ref);
  }

  async hasObject(ref: VersionDependencyRef): Promise<boolean> {
    return (await this.loadGraph('hasObject')).hasObject(ref);
  }

  async readHead(): Promise<VersionGraphReadHeadResult> {
    try {
      return await (await this.loadGraph('readHead')).readHead();
    } catch (error) {
      return {
        status: 'degraded',
        head: null,
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'readHead')],
      };
    }
  }

  async readRef(name: VersionGraphRefSelector | string): Promise<VersionGraphReadRefResult> {
    try {
      return await (await this.loadGraph('readRef')).readRef(name);
    } catch (error) {
      return {
        status: 'degraded',
        ref: null,
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'readRef')],
      };
    }
  }

  async createBranch(...args: Parameters<IndexedDbGraphBranchLifecycle['createBranch']>) {
    return this.branchLifecycle.createBranch(...args);
  }

  async readBranch(...args: Parameters<IndexedDbGraphBranchLifecycle['readBranch']>) {
    return this.branchLifecycle.readBranch(...args);
  }

  async listBranches(...args: Parameters<IndexedDbGraphBranchLifecycle['listBranches']>) {
    return this.branchLifecycle.listBranches(...args);
  }

  async fastForwardBranch(...args: Parameters<IndexedDbGraphBranchLifecycle['fastForwardBranch']>) {
    return this.branchLifecycle.fastForwardBranch(...args);
  }

  async deleteBranch(...args: Parameters<IndexedDbGraphBranchLifecycle['deleteBranch']>) {
    return this.branchLifecycle.deleteBranch(...args);
  }

  async getHead() {
    return this.branchLifecycle.getHead();
  }

  async listCommits(
    options?: VersionGraphListCommitsOptions,
  ): Promise<VersionGraphCommitPageResult> {
    try {
      return await (await this.loadGraph('listCommits')).listCommits(options);
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'listCommits')],
      };
    }
  }

  async readCommitClosure(
    commitId: WorkbookCommitId | string,
  ): Promise<VersionGraphClosureReadResult> {
    try {
      return await (await this.loadGraph('readCommitClosure')).readCommitClosure(commitId);
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'readCommitClosure')],
      };
    }
  }

  private async commitWithLoadedGraph(
    operation: 'commit' | 'mergeCommit' | 'fastForwardRef',
    input: CommitVersionGraphInput | MergeVersionGraphInput | FastForwardVersionGraphInput,
    write: (graph: InMemoryVersionGraphStore) => Promise<VersionGraphWriteResult>,
  ): Promise<VersionGraphWriteResult> {
    let graph: InMemoryVersionGraphStore;
    try {
      graph = await this.loadGraph(operation);
    } catch (error) {
      return failedGraphWrite(
        [graphLoadDiagnostic(error, this.namespace, operation)],
        'no-write-attempted',
      );
    }

    const result = await write(graph);
    if (result.status !== 'success') return result;
    const expectedRefVersion = input.expectedTargetRefVersion ?? input.expectedMainRefVersion;
    if (expectedRefVersion === undefined) {
      return failedIndexedDbBackendMissingRefCasMetadata({
        operation,
        namespace: this.namespace,
        refName: result.ref.name,
      });
    }

    try {
      await persistGraphSnapshot({
        db: await this.getDb(),
        snapshot: await graph.exportSnapshot(),
        documentScope: this.documentScope,
        mode: {
          kind: 'commit',
          targetRefName: storageRefNameFromGraphRefName(result.ref.name),
          expectedHeadCommitId: parseWorkbookCommitId(input.expectedHeadCommitId),
          expectedRefVersion,
          ...(operation === 'fastForwardRef'
            ? { refCasProof: { applyKind: 'fastForward' as const } }
            : operation === 'mergeCommit'
              ? { refCasProof: { applyKind: 'mergeCommit' as const } }
              : {}),
        },
      });
      return result;
    } catch (error) {
      if (error instanceof RefCasConflictError) {
        return failedIndexedDbBackendRefCasConflict({
          error,
          operation,
          namespace: this.namespace,
          refName: result.ref.name,
        });
      }
      return failedIndexedDbBackendGraphCommit({
        operation,
        namespace: this.namespace,
        cause: errorMessage(error),
      });
    }
  }

  private async loadGraph(operation: string): Promise<InMemoryVersionGraphStore> {
    void operation;
    return loadGraphSnapshot(await this.getDb(), this.namespace, this.documentScope);
  }
}

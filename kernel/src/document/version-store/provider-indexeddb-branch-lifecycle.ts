import type {
  BranchFailureResult,
  CreateBranchInput,
  CreateBranchResult,
  FastForwardBranchInput,
  FastForwardBranchResult,
  GetBranchHeadResult,
  ListBranchesInput,
  ListBranchesResult,
  ReadBranchInput,
  ReadBranchResult,
} from './branch-service';
import type { InMemoryVersionGraphStore } from './graph-store';
import { parseWorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace } from './object-store';
import {
  RefAlreadyExistsError,
  RefCasConflictError,
  RefStoreManifestConflictError,
  errorMessage,
  persistGraphSnapshot,
} from './provider-indexeddb-internal';
import { loadGraphSnapshot } from './provider-indexeddb-reload';
import type { VersionDiagnostic } from './ref-store';
import type { VersionDocumentScope } from './registry';

export interface IndexedDbGraphBranchLifecycle {
  createBranch(input: CreateBranchInput): Promise<CreateBranchResult>;
  readBranch(input: ReadBranchInput | string): Promise<ReadBranchResult>;
  listBranches(input?: ListBranchesInput): Promise<ListBranchesResult>;
  fastForwardBranch(input: FastForwardBranchInput): Promise<FastForwardBranchResult>;
  getHead(): Promise<GetBranchHeadResult>;
}

export function createIndexedDbGraphBranchLifecycle(options: {
  readonly namespace: VersionGraphNamespace;
  readonly documentScope: VersionDocumentScope;
  readonly getDb: () => Promise<IDBDatabase>;
}): IndexedDbGraphBranchLifecycle {
  return new IndexedDbGraphBranchLifecycleService(options);
}

class IndexedDbGraphBranchLifecycleService implements IndexedDbGraphBranchLifecycle {
  private readonly namespace: VersionGraphNamespace;
  private readonly documentScope: VersionDocumentScope;
  private readonly getDb: () => Promise<IDBDatabase>;

  constructor(options: {
    readonly namespace: VersionGraphNamespace;
    readonly documentScope: VersionDocumentScope;
    readonly getDb: () => Promise<IDBDatabase>;
  }) {
    this.namespace = options.namespace;
    this.documentScope = options.documentScope;
    this.getDb = options.getDb;
  }

  async createBranch(input: CreateBranchInput): Promise<CreateBranchResult> {
    return this.createBranchInternal(input, true);
  }

  private async createBranchInternal(
    input: CreateBranchInput,
    retryManifestConflict: boolean,
  ): Promise<CreateBranchResult> {
    let graph: InMemoryVersionGraphStore;
    try {
      graph = await this.loadGraph();
    } catch (error) {
      return branchLifecycleFailure(
        'createBranch',
        'IndexedDB graph could not be loaded while creating a branch.',
        error,
      );
    }

    const expectedRefStoreNextGeneratedId = graph.refStore.exportSnapshot().nextGeneratedId;
    const result = await graph.createBranch(input);
    if (!result.ok) return result;

    try {
      await persistGraphSnapshot({
        db: await this.getDb(),
        snapshot: await graph.exportSnapshot(),
        documentScope: this.documentScope,
        mode: {
          kind: 'createBranch',
          targetRefName: result.branch.name,
          expectedRefStoreNextGeneratedId,
        },
      });
      return result;
    } catch (error) {
      if (error instanceof RefAlreadyExistsError) {
        try {
          return (await this.loadGraph()).createBranch(input);
        } catch {
          return branchLifecycleFailure(
            'createBranch',
            'IndexedDB branch create conflicted and the graph could not be reloaded.',
            error,
          );
        }
      }
      if (error instanceof RefStoreManifestConflictError && retryManifestConflict) {
        return this.createBranchInternal(input, false);
      }
      return branchLifecycleFailure(
        'createBranch',
        'IndexedDB graph could not persist the branch create.',
        error,
      );
    }
  }

  async readBranch(input: ReadBranchInput | string): Promise<ReadBranchResult> {
    try {
      return await (await this.loadGraph()).readBranch(input);
    } catch (error) {
      return branchLifecycleFailure(
        'readBranch',
        'IndexedDB graph could not be loaded while reading a branch.',
        error,
      );
    }
  }

  async listBranches(input: ListBranchesInput = {}): Promise<ListBranchesResult> {
    try {
      return await (await this.loadGraph()).listBranches(input);
    } catch (error) {
      return branchLifecycleFailure(
        'listBranches',
        'IndexedDB graph could not be loaded while listing branches.',
        error,
      );
    }
  }

  async fastForwardBranch(input: FastForwardBranchInput): Promise<FastForwardBranchResult> {
    let graph: InMemoryVersionGraphStore;
    try {
      graph = await this.loadGraph();
    } catch (error) {
      return branchLifecycleFailure(
        'fastForwardBranch',
        'IndexedDB graph could not be loaded while fast-forwarding a branch.',
        error,
      );
    }

    const result = await graph.fastForwardBranch(input);
    if (!result.ok) return result;

    try {
      await persistGraphSnapshot({
        db: await this.getDb(),
        snapshot: await graph.exportSnapshot(),
        documentScope: this.documentScope,
        mode: {
          kind: 'commit',
          targetRefName: result.branch.name,
          expectedHeadCommitId: parseWorkbookCommitId(input.expectedOldCommitId as string),
          expectedRefVersion: input.expectedRefVersion as NonNullable<
            FastForwardBranchInput['expectedRefVersion']
          >,
        },
      });
      return result;
    } catch (error) {
      if (error instanceof RefCasConflictError) {
        try {
          return (await this.loadGraph()).fastForwardBranch(input);
        } catch {
          return branchLifecycleFailure(
            'fastForwardBranch',
            'IndexedDB branch fast-forward conflicted and the graph could not be reloaded.',
            error,
          );
        }
      }
      return branchLifecycleFailure(
        'fastForwardBranch',
        'IndexedDB graph could not persist the branch fast-forward.',
        error,
      );
    }
  }

  async getHead(): Promise<GetBranchHeadResult> {
    try {
      return await (await this.loadGraph()).getHead();
    } catch (error) {
      return branchLifecycleFailure(
        'getHead',
        'IndexedDB graph could not be loaded while reading HEAD.',
        error,
      );
    }
  }

  private async loadGraph(): Promise<InMemoryVersionGraphStore> {
    return loadGraphSnapshot(await this.getDb(), this.namespace, this.documentScope);
  }
}

function branchLifecycleFailure(
  operation: 'createBranch' | 'readBranch' | 'listBranches' | 'fastForwardBranch' | 'getHead',
  message: string,
  error: unknown,
): BranchFailureResult {
  const diagnostics: readonly VersionDiagnostic[] = Object.freeze([
    Object.freeze({
      code: 'versionCapabilityDisabled',
      severity: 'error',
      message,
      details: Object.freeze({ cause: errorMessage(error), operation }),
    }),
  ]);
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'versionCapabilityDisabled', message, diagnostics }),
    diagnostics,
  });
}

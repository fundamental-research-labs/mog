import {
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  type WorkbookCommitId,
} from '../object-digest';
import { createWorkbookCommitInObjectStore } from './create';
import { diagnostic } from './payload';
import {
  commitFromRecord,
  validateCommitDependenciesPresent,
  validateCommitRecord,
} from './records';
import { VersionObjectStoreError, type InMemoryVersionObjectStore } from '../object-store';
import type {
  CreateWorkbookCommitInput,
  CreateWorkbookCommitResult,
  ReadWorkbookCommitResult,
  WorkbookCommitPayload,
} from './types';

export class InMemoryWorkbookCommitStore {
  private readonly objectStore: InMemoryVersionObjectStore;

  constructor(objectStore: InMemoryVersionObjectStore) {
    this.objectStore = objectStore;
  }

  async createWorkbookCommit(
    input: CreateWorkbookCommitInput,
  ): Promise<CreateWorkbookCommitResult> {
    return createWorkbookCommitInObjectStore(this.objectStore, input);
  }

  async readCommit(commitIdInput: WorkbookCommitId | string): Promise<ReadWorkbookCommitResult> {
    let commitId: WorkbookCommitId;
    try {
      commitId = parseWorkbookCommitId(commitIdInput);
    } catch {
      return {
        status: 'failed',
        diagnostics: [
          diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit id must be commit:sha256:<64 hex>.'),
        ],
      };
    }

    try {
      const digest = objectDigestFromWorkbookCommitId(commitId);
      const record = await this.objectStore.getObjectRecord<WorkbookCommitPayload>({
        kind: 'commit',
        commitId,
        digest,
      });
      const validationDiagnostics = validateCommitRecord(
        commitId,
        record,
        this.objectStore.namespace.documentId,
      );
      if (validationDiagnostics.length > 0) {
        return { status: 'failed', diagnostics: validationDiagnostics };
      }

      const dependencyDiagnostics = await validateCommitDependenciesPresent(
        this.objectStore,
        commitId,
        record.preimage.dependencies,
      );
      if (dependencyDiagnostics.length > 0) {
        return { status: 'failed', diagnostics: dependencyDiagnostics };
      }

      return {
        status: 'success',
        commit: commitFromRecord(commitId, record),
        diagnostics: [],
      };
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [
          diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit object read failed.', {
            commitId,
            sourceDiagnostics:
              error instanceof VersionObjectStoreError ? [error.diagnostic] : undefined,
          }),
        ],
      };
    }
  }
}

export function createInMemoryWorkbookCommitStore(
  objectStore: InMemoryVersionObjectStore,
): InMemoryWorkbookCommitStore {
  return new InMemoryWorkbookCommitStore(objectStore);
}

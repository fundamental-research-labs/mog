import type { VersionCommitOptions } from '@mog-sdk/contracts/api';

import type { VersionGraphListCommitsOptions } from './graph';
import {
  fastForwardMergeCommit,
  type WorkbookVersionCommitServiceFastForwardMergeResult,
} from './commit-service-fast-forward';
import {
  mergeWorkbookVersionCommit,
  type WorkbookVersionCommitServiceMergeCommitContext,
} from './commit-service-merge-commit';
import {
  commitWorkbookVersion,
  type WorkbookVersionCommitServiceNormalCommitContext,
} from './commit-service-normal-commit';
import { openVisibleVersionGraph } from './commit-service-open-graph';
import {
  listWorkbookVersionCommits,
  readWorkbookVersionHead,
  readWorkbookVersionRef,
} from './commit-service-read-operations';
import { failedStoreResult } from './provider';
import type {
  VersionMergeCommitCapture,
  VersionNormalCommitCapture,
  WorkbookVersionCommitServiceCommitResult,
  WorkbookVersionCommitServiceFastForwardMergeInput,
  WorkbookVersionCommitServiceListCommitsResult,
  WorkbookVersionCommitServiceMergeCommitInput,
  WorkbookVersionCommitServiceOptions,
  WorkbookVersionCommitServiceReadHeadResult,
  WorkbookVersionCommitServiceReadRefResult,
} from './commit-service-types';
import type { VersionStoreDiagnostic } from './provider';
import type { VersionStoreProvider } from './provider';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';

export type {
  VersionMergeCommitCapture,
  VersionMergeCommitCaptureInput,
  VersionMergeCommitCaptureResult,
  VersionMergeCommitCaptureSuccess,
  VersionNormalCommitCapture,
  VersionNormalCommitCaptureFinalizeResult,
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
  VersionNormalCommitCaptureSuccess,
  VersionNormalCommitContentInput,
  WorkbookVersionCommitServiceCommitResult,
  WorkbookVersionCommitServiceFastForwardMergeInput,
  WorkbookVersionCommitServiceListCommitsResult,
  WorkbookVersionCommitServiceMergeCommitInput,
  WorkbookVersionCommitServiceOptions,
  WorkbookVersionCommitServiceReadHeadResult,
  WorkbookVersionCommitServiceReadRefResult,
} from './commit-service-types';

export class WorkbookVersionCommitService {
  readonly capturesNormalCommit: boolean;
  private readonly provider: VersionStoreProvider;
  private readonly captureNormalCommit?: VersionNormalCommitCapture;
  private readonly captureMergeCommit?: VersionMergeCommitCapture;
  private readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  private readonly ensureInitialized?: () =>
    | readonly VersionStoreDiagnostic[]
    | Promise<readonly VersionStoreDiagnostic[]>;
  private initialized = false;
  private initializationPromise: Promise<readonly VersionStoreDiagnostic[]> | null = null;

  constructor(options: WorkbookVersionCommitServiceOptions) {
    this.capturesNormalCommit = Boolean(options.captureNormalCommit);
    this.provider = options.provider;
    this.captureNormalCommit = options.captureNormalCommit;
    this.captureMergeCommit = options.captureMergeCommit;
    this.snapshotRootByteSyncPort = options.snapshotRootByteSyncPort;
    this.ensureInitialized = options.ensureInitialized;
  }

  async readHead(): Promise<WorkbookVersionCommitServiceReadHeadResult> {
    const diagnostics = await this.ensureProviderInitialized();
    if (diagnostics.length > 0) {
      return { status: 'degraded', head: null, diagnostics };
    }
    return readWorkbookVersionHead(this.provider);
  }

  async readRef(name: string): Promise<WorkbookVersionCommitServiceReadRefResult> {
    const diagnostics = await this.ensureProviderInitialized();
    if (diagnostics.length > 0) {
      return { status: 'degraded', ref: null, diagnostics };
    }
    return readWorkbookVersionRef(this.provider, name);
  }

  async listCommits(
    options: VersionGraphListCommitsOptions = {},
  ): Promise<WorkbookVersionCommitServiceListCommitsResult> {
    const diagnostics = await this.ensureProviderInitialized();
    if (diagnostics.length > 0) {
      return { status: 'failed', diagnostics };
    }
    return listWorkbookVersionCommits(this.provider, options);
  }

  async commit(
    options: VersionCommitOptions = {},
  ): Promise<WorkbookVersionCommitServiceCommitResult> {
    const diagnostics = await this.ensureProviderInitialized();
    if (diagnostics.length > 0) {
      return failedStoreResult(diagnostics, 'no-write-attempted', true);
    }
    return commitWorkbookVersion(this.normalCommitContext(), options);
  }

  async mergeCommit(
    input: WorkbookVersionCommitServiceMergeCommitInput,
  ): Promise<WorkbookVersionCommitServiceCommitResult> {
    const diagnostics = await this.ensureProviderInitialized();
    if (diagnostics.length > 0) {
      return failedStoreResult(diagnostics, 'no-write-attempted', true);
    }
    return mergeWorkbookVersionCommit(this.mergeCommitContext(), input);
  }

  async fastForwardMerge(
    input: WorkbookVersionCommitServiceFastForwardMergeInput,
  ): Promise<WorkbookVersionCommitServiceFastForwardMergeResult> {
    const diagnostics = await this.ensureProviderInitialized();
    if (diagnostics.length > 0) {
      return failedStoreResult(diagnostics, 'no-write-attempted', true);
    }
    return fastForwardMergeCommit({
      input,
      provider: this.provider,
      openVisibleGraph: () => openVisibleVersionGraph(this.provider, 'commitGraphWrite'),
    });
  }

  private async ensureProviderInitialized(): Promise<readonly VersionStoreDiagnostic[]> {
    if (!this.ensureInitialized || this.initialized) return [];
    if (!this.initializationPromise) {
      this.initializationPromise = Promise.resolve(this.ensureInitialized()).then((diagnostics) => {
        if (diagnostics.length === 0) {
          this.initialized = true;
        }
        return diagnostics;
      });
    }
    try {
      return await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private normalCommitContext(): WorkbookVersionCommitServiceNormalCommitContext {
    return {
      provider: this.provider,
      captureNormalCommit: this.captureNormalCommit,
      snapshotRootByteSyncPort: this.snapshotRootByteSyncPort,
    };
  }

  private mergeCommitContext(): WorkbookVersionCommitServiceMergeCommitContext {
    return {
      provider: this.provider,
      captureMergeCommit: this.captureMergeCommit,
    };
  }
}

export function createWorkbookVersionCommitService(
  options: WorkbookVersionCommitServiceOptions,
): WorkbookVersionCommitService {
  return new WorkbookVersionCommitService(options);
}

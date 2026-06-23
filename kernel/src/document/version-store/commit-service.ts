import type { VersionCommitOptions } from '@mog-sdk/contracts/api';

import type { VersionGraphListCommitsOptions } from './graph-store';
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
  private readonly provider: VersionStoreProvider;
  private readonly captureNormalCommit?: VersionNormalCommitCapture;
  private readonly captureMergeCommit?: VersionMergeCommitCapture;
  private readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;

  constructor(options: WorkbookVersionCommitServiceOptions) {
    this.provider = options.provider;
    this.captureNormalCommit = options.captureNormalCommit;
    this.captureMergeCommit = options.captureMergeCommit;
    this.snapshotRootByteSyncPort = options.snapshotRootByteSyncPort;
  }

  async readHead(): Promise<WorkbookVersionCommitServiceReadHeadResult> {
    return readWorkbookVersionHead(this.provider);
  }

  async readRef(name: string): Promise<WorkbookVersionCommitServiceReadRefResult> {
    return readWorkbookVersionRef(this.provider, name);
  }

  async listCommits(
    options: VersionGraphListCommitsOptions = {},
  ): Promise<WorkbookVersionCommitServiceListCommitsResult> {
    return listWorkbookVersionCommits(this.provider, options);
  }

  async commit(
    options: VersionCommitOptions = {},
  ): Promise<WorkbookVersionCommitServiceCommitResult> {
    return commitWorkbookVersion(this.normalCommitContext(), options);
  }

  async mergeCommit(
    input: WorkbookVersionCommitServiceMergeCommitInput,
  ): Promise<WorkbookVersionCommitServiceCommitResult> {
    return mergeWorkbookVersionCommit(this.mergeCommitContext(), input);
  }

  async fastForwardMerge(
    input: WorkbookVersionCommitServiceFastForwardMergeInput,
  ): Promise<WorkbookVersionCommitServiceFastForwardMergeResult> {
    return fastForwardMergeCommit({
      input,
      provider: this.provider,
      openVisibleGraph: () => openVisibleVersionGraph(this.provider, 'commitGraphWrite'),
    });
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

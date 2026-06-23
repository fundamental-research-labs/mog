export { createLifecycleFailureReadService } from './lifecycle-failure-service';
export { resolveDocumentWorkbookVersioningLifecycle } from './lifecycle-resolution';

export type { VersionNormalCommitCapture } from './commit-service';
export type {
  DocumentWorkbookVersioningLifecycleConfig,
  ResolvedDocumentWorkbookVersioningLifecycle,
  ResolvedWorkbookVersioningConfig,
  VersionLiveCollaborationState,
  VersionLiveCollaborationStatus,
  VersionLiveCollaborationStatusReader,
  VersionStoreLifecycleFailureReadService,
  VersionStoreLifecycleProviderSelection,
  VersionStoreLifecycleRootInitializer,
} from './lifecycle-types';

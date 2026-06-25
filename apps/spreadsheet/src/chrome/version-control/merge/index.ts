export { VersionMergeControls } from './VersionMergeControls';
export type { VersionMergeControlsProps } from './VersionMergeControls';
export {
  applyMergeInputFromPreview,
  diagnosticFromMergeApplyResult,
  mergeApplyActionDisabledReason,
  mergeApplyActionMessage,
  mergeApplyBlocked,
  mergeApplyBlockedMessage,
  mergeApplyConflictedMessage,
  mergeExpectedTargetHead,
  materializedActiveCheckoutMergeApplyOptions,
  mergePreviewActionDisabledReason,
  mergePreviewActionMessage,
  readMergeGraph,
} from './merge-actions';
export type { VersionMergePreviewState, VersionMergeResolutionSelections } from './merge-actions';
export {
  findLoadedMergeBase,
  mergeSourceRefs,
  resolveCurrentMergeTarget,
} from './version-merge-planning';
export type { LoadedMergeBaseResult, VersionMergeTarget } from './version-merge-planning';
export {
  clearMergeReviewDraft,
  clearMergeReviewDraftForTarget,
  mergeReviewDraftMatches,
  mergeReviewDraftStorageKey,
  readMergeReviewDraft,
  readMergeReviewDraftForTarget,
  sanitizeMergeReviewDraftSelections,
  writeMergeReviewDraft,
} from './version-merge-review-draft-storage';

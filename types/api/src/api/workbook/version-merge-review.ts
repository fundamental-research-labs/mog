import type { JsonValue, ObjectDigest, PageCursor, VersionResult } from './version-shared';
import type {
  VersionApplyMergeInput,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionBranchNameInput,
  VersionCommitExpectedHead,
  VersionDiffValue,
  VersionMainRefName,
  VersionMergeAttemptKind,
  VersionMergeAttemptPersistence,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeInput,
  VersionMergeResultId,
  VersionRefNameInput,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitIdInput,
} from './version';

export type VersionMergeEndpoint =
  | 'current'
  | 'main'
  | VersionBranchNameInput
  | WorkbookCommitIdInput
  | { readonly kind: 'branch'; readonly name: VersionBranchNameInput }
  | { readonly kind: 'ref'; readonly name: VersionRefNameInput }
  | { readonly kind: 'commit'; readonly id: WorkbookCommitIdInput }
  | { readonly kind: 'current' };

export type VersionResolvedMergeEndpoint =
  | {
      readonly kind: 'branch';
      readonly name: VersionBranchNameInput;
      readonly refName: VersionMainRefName | VersionRefName;
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly refName: VersionMainRefName | VersionRefName;
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'current';
      readonly commitId: WorkbookCommitId;
      readonly refName?: VersionMainRefName | VersionRefName;
      readonly detached: boolean;
    };

export interface VersionPreviewMergeInput {
  readonly from: VersionMergeEndpoint;
  readonly into?: VersionMergeEndpoint;
  readonly base?: WorkbookCommitIdInput;
}

export interface VersionPreviewMergeOptions {
  readonly includeDiagnostics?: boolean;
  readonly persistReviewRecord?: boolean;
}

export interface VersionGetMergeReviewInput {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest?: ObjectDigest;
  readonly from?: VersionResolvedMergeEndpoint;
  readonly into?: VersionResolvedMergeEndpoint;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly targetHead?: VersionCommitExpectedHead;
}

export interface VersionMergeReviewApplyOptions {
  readonly includeDiagnostics?: boolean;
  readonly materializeActiveCheckout?: boolean;
}

export interface VersionMergeReviewConflictDetailOptions {
  readonly valueRole: VersionMergeConflictValueRole;
  readonly purpose?: VersionMergeConflictDetailPurpose;
  readonly pageToken?: PageCursor;
  readonly maxBytes?: number;
  readonly optionId?: string;
  readonly kind?: VersionMergeConflictResolutionOptionKind;
}

export type VersionMergeReviewStatus =
  | 'clean'
  | 'conflicted'
  | 'fastForward'
  | 'alreadyMerged'
  | 'blocked';

export interface VersionMergeReview {
  readonly schemaVersion: 1;
  readonly status: VersionMergeReviewStatus;
  readonly from: VersionResolvedMergeEndpoint;
  readonly into: VersionResolvedMergeEndpoint;
  readonly baseCommitId?: WorkbookCommitId;
  readonly mergeInput?: VersionMergeInput;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly targetHead?: VersionCommitExpectedHead;
  readonly resultId?: VersionMergeResultId;
  readonly resultDigest?: ObjectDigest;
  readonly previewArtifactDigest?: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly redactionPolicyDigest?: ObjectDigest;
  readonly attemptKind?: VersionMergeAttemptKind;
  readonly attemptPersistence?: VersionMergeAttemptPersistence;
  readonly changes: readonly VersionMergeChange[];
  readonly conflicts: readonly VersionMergeConflict[];
  readonly selectedResolutions: readonly VersionApplyMergeResolution[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
  choose(conflictId: string, option: VersionMergeConflictResolutionOptionKind): VersionMergeReview;
  chooseAll(option: VersionMergeConflictResolutionOptionKind): VersionMergeReview;
  save(): Promise<VersionResult<VersionSaveMergeResolutionsResult>>;
  toApplyInput(): VersionApplyMergeInput;
  apply(options?: VersionMergeReviewApplyOptions): Promise<VersionResult<VersionApplyMergeResult>>;
  getConflictDetail(
    conflictId: string,
    options: VersionMergeReviewConflictDetailOptions,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>>;
}

export type VersionMergeEndpointDeniedStatus =
  | 'authorizationDenied'
  | 'capabilityDisabled'
  | 'missingAttempt'
  | 'expiredAttempt'
  | 'invalidInput'
  | 'rejected'
  | 'blocked';

export interface VersionSaveMergeResolutionsRequest {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly resolutions: readonly VersionApplyMergeResolution[];
}

export interface VersionSaveMergeResolutionsResult {
  readonly schemaVersion: 1;
  readonly kind: 'mergeResolutionsSaved';
  readonly status: 'partiallyResolved' | 'readyToApply' | 'reviewOnly';
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly attemptKind?: VersionMergeAttemptKind;
  readonly attemptPersistence?: VersionMergeAttemptPersistence;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly savedResolutionCount: number;
  readonly diagnostics: readonly VersionStoreDiagnostic[];
}

export type VersionMergeConflictValueRole = 'base' | 'ours' | 'theirs' | 'resolved';
export type VersionMergeConflictDetailPurpose = 'review' | 'resolution';

export interface VersionGetMergeConflictDetailRequest {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly conflictId: string;
  readonly expectedConflictDigest: ObjectDigest;
  readonly valueRole: VersionMergeConflictValueRole;
  readonly purpose: VersionMergeConflictDetailPurpose;
  readonly pageToken?: PageCursor;
  readonly maxBytes?: number;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly optionId?: string;
  readonly kind?: VersionMergeConflictResolutionOptionKind;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
}

export interface VersionMergeConflictValuePageRef {
  readonly schemaVersion: 1;
  readonly pageId: string;
  readonly pageDigest: ObjectDigest;
  readonly valueRole: VersionMergeConflictValueRole;
  readonly maxBytes: number;
  readonly expiresAt?: string;
}

export interface VersionMergeConflictDetailResolutionOption {
  readonly optionId: string;
  readonly conflictId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly value: VersionDiffValue;
  readonly recalcRequired: boolean;
}

export interface VersionMergeConflictDetailBase {
  readonly conflictId: string;
  readonly conflictDigest: string;
  readonly valueRole: VersionMergeConflictValueRole;
  readonly purpose: VersionMergeConflictDetailPurpose;
  readonly resolutionOptions: readonly VersionMergeConflictDetailResolutionOption[];
}

export type VersionMergeConflictDetailResult =
  | (VersionMergeConflictDetailBase & {
      readonly schemaVersion: 1;
      readonly kind: 'reviewValue';
      readonly value: VersionDiffValue;
      readonly page?: VersionMergeConflictValuePageRef;
      readonly nextPageToken?: PageCursor;
    })
  | (VersionMergeConflictDetailBase & {
      readonly schemaVersion: 1;
      readonly kind: 'resolutionPayload';
      readonly value: VersionDiffValue;
      readonly sealedPayloadRef?: VersionSealedResolutionPayloadRef;
      readonly page?: VersionMergeConflictValuePageRef;
      readonly nextPageToken?: PageCursor;
    });

export type VersionMergeResolutionPayloadPurpose = 'chooseValue' | 'custom';
export type VersionSealedResolutionPayloadStorageMode = 'serverEncrypted' | 'localOnly';

export interface VersionPutMergeResolutionPayloadRequest {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly conflictId: string;
  readonly expectedConflictDigest: ObjectDigest;
  readonly optionId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly domainPayloadSchema?: string;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly value: JsonValue;
  readonly purpose: VersionMergeResolutionPayloadPurpose;
}

export interface VersionSealedResolutionPayloadRef {
  readonly schemaVersion: 1;
  readonly kind: 'sealedResolutionPayload';
  readonly payloadId: `merge-payload:${string}`;
  readonly payloadDigest: ObjectDigest;
  readonly storageMode: VersionSealedResolutionPayloadStorageMode;
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly conflictId: string;
  readonly optionId: string;
  readonly resolutionKind: VersionMergeConflictResolutionOptionKind;
  readonly expiresAt?: string;
}

export type VersionPutMergeResolutionPayloadResult = VersionSealedResolutionPayloadRef;

export interface VersionMergeReviewArtifactApi {
  saveMergeResolutions(
    input: VersionSaveMergeResolutionsRequest,
  ): Promise<VersionResult<VersionSaveMergeResolutionsResult>>;
  getMergeConflictDetail(
    input: VersionGetMergeConflictDetailRequest,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>>;
  putMergeResolutionPayload(
    input: VersionPutMergeResolutionPayloadRequest,
  ): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>>;
}

export interface VersionMergeReviewArtifactNamespace {
  readonly advanced: VersionMergeReviewArtifactApi;
}

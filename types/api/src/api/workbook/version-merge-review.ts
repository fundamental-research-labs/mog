import type { JsonValue, ObjectDigest, PageCursor } from './version-shared';
import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionDiffValue,
  VersionMainRefName,
  VersionMergeAttemptKind,
  VersionMergeAttemptPersistence,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
} from './version';

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

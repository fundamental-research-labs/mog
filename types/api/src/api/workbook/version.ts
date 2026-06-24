/**
 * WorkbookVersion -- public version-control API slice.
 *
 * This surface exposes status, graph inspection, public commit/ref mutation,
 * semantic diff, checkout materialization planning, and a fail-closed merge
 * preview facade.
 */

import type {
  ObjectDigest,
  Paged,
  VersionCapability,
  VersionCapabilityDependency,
  VersionDiagnostic,
  VersionSurfaceDiagnosticCode,
  WorkbookVersionDiagnosticCode,
} from './version-shared';

export type {
  JsonValue,
  ObjectDigest,
  PageCursor,
  Paged,
  RedactionSummary,
  VerificationSummary,
  VersionAuthor,
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityError,
  VersionDiagnostic,
  VersionDiagnosticSeverity,
  VersionError,
  VersionResult,
  VersionSurfaceDiagnosticCode,
  WorkbookVersionDiagnosticCode,
} from './version-shared';

export type { WorkbookVersion } from './version-workbook';
export type * from './version-merge-review';
export type * from './version-pending-remote-promotion';
export type * from './version-proposal';
export type * from './version-review';

export type WorkbookVersionRolloutStage =
  | 'disabled'
  | 'shadow-only'
  | 'headless-local'
  | 'ui-beta'
  | 'collab-interop-beta'
  | 'default-on';

export type WorkbookVersionCapabilityStage = 'present' | 'pending' | 'unavailable';

export type WorkbookVersionDependency = 'VC-02' | 'VC-04' | 'VC-05' | 'VC-07' | 'version-service';

export type WorkbookVersionDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface WorkbookVersionDiagnostic {
  readonly code: WorkbookVersionDiagnosticCode | (string & {});
  readonly severity: WorkbookVersionDiagnosticSeverity;
  readonly message: string;
  readonly dependency?: WorkbookVersionDependency;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface WorkbookVersionCapabilityStatus {
  readonly stage: WorkbookVersionCapabilityStage;
  readonly available: boolean;
  readonly dependency: WorkbookVersionDependency;
  readonly diagnostics: readonly WorkbookVersionDiagnostic[];
}

export interface WorkbookVersionStatus {
  readonly schemaVersion: 1;
  readonly rolloutStage: WorkbookVersionRolloutStage;
  readonly objectStoreFoundation: WorkbookVersionCapabilityStatus;
  readonly refLifecycleFoundation: WorkbookVersionCapabilityStatus;
  readonly commitApi: WorkbookVersionCapabilityStatus;
  readonly checkout: WorkbookVersionCapabilityStatus;
  readonly merge: WorkbookVersionCapabilityStatus;
  readonly provenanceAdmission: WorkbookVersionCapabilityStatus;
  readonly diagnostics: readonly WorkbookVersionDiagnostic[];
}

export type VersionSurfaceStage =
  | 'off'
  | 'readOnly'
  | 'authoring'
  | 'proposal'
  | 'merge'
  | 'provenance';

export type VersionSurfaceStorageBackend = 'indexeddb' | 'memory' | 'remote' | 'unknown';

export type VersionCapabilityState =
  | { readonly enabled: true }
  | {
      readonly enabled: false;
      readonly dependency?: VersionCapabilityDependency;
      readonly reason: string;
      readonly retryable: boolean;
    };

export type VersionSurfaceDiagnosticSeverity = 'info' | 'warning' | 'error';

export type VersionLiveCollaborationState = 'absent' | 'disabled' | 'idle' | 'active' | 'unknown';

export interface VersionSurfaceLiveCollaborationStatus {
  readonly state: VersionLiveCollaborationState;
  readonly statusRevision: string;
  readonly roomId?: string;
  readonly sidecarStatus?: string;
  readonly activeParticipantCount?: number;
  readonly remoteProviderAttached?: boolean;
  readonly inFlightRemoteUpdateCount?: number;
  readonly syncApplyRemoteQueueDepth?: number;
}

export interface VersionSurfaceStatus {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly stage: VersionSurfaceStage;
  readonly featureGateEnabled: boolean;
  readonly storage: {
    readonly ready: boolean;
    readonly backend: VersionSurfaceStorageBackend;
    readonly diagnostics: readonly VersionDiagnostic[];
  };
  readonly current: {
    readonly headCommitId?: string;
    readonly branchName?: string;
    readonly checkedOutCommitId?: string;
    readonly refHeadAtMaterialization?: string;
    readonly currentRefHeadId?: string;
    readonly detached: boolean;
    readonly stale: boolean;
    readonly staleReason?: 'refMoved' | 'activeSessionBehind' | 'unknown';
  };
  readonly dirty: {
    readonly statusRevision: string;
    readonly checkoutPreflightToken: string;
    readonly hasUncommittedLocalChanges: boolean;
    readonly commitEligibleChanges: boolean;
    readonly unsupportedDirtyDomains: readonly string[];
    readonly pendingProviderWrites: boolean;
    readonly pendingRecalc: boolean;
    readonly liveCollaboration?: VersionSurfaceLiveCollaborationStatus;
    readonly checkoutSafe: boolean;
    readonly unsafeReasons: readonly VersionDiagnostic[];
    readonly source: 'VC-05';
    readonly diagnostics: readonly VersionDiagnostic[];
  };
  readonly capabilities: Record<VersionCapability, VersionCapabilityState>;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface WorkbookVersionHead {
  readonly commitId: string;
  readonly branchName?: string;
}

export interface WorkbookVersionHeadStatus {
  readonly schemaVersion: 1;
  readonly rolloutStage: WorkbookVersionRolloutStage;
  readonly head: WorkbookVersionHead | null;
  readonly diagnostics: readonly WorkbookVersionDiagnostic[];
}

export type WorkbookCommitId = `commit:sha256:${string}` & {
  readonly __brand?: 'WorkbookCommitId';
};

export type VersionCounterRecordRevision = {
  readonly kind: 'counter';
  readonly value: string;
};

export type VersionRecordRevision =
  | VersionCounterRecordRevision
  | {
      readonly kind: 'opaque';
      readonly value: string;
    };

export type VersionPageToken = string & {
  readonly __brand?: 'VersionPageToken';
};
export type VersionDiffCursor = VersionPageToken & {
  readonly __versionDiffCursorBrand?: 'VersionDiffCursor';
};

export type VersionMainRefName = 'refs/heads/main';
export type VersionRefName = string & {
  readonly __brand?: 'VersionRefName';
};
export type VersionRefSelector = 'HEAD' | VersionMainRefName | VersionRefName;
export type VersionBranchName = string & {
  readonly __brand?: 'VersionBranchName';
};
export type VersionBranchSelector = VersionBranchName | VersionMainRefName | VersionRefName;

export type VersionPageOrder = 'topological-newest' | 'semantic-change-order';

export type VersionDiagnosticCode =
  | 'VERSION_DANGLING_REF'
  | 'VERSION_GRAPH_CONFLICT'
  | 'VERSION_GRAPH_UNINITIALIZED'
  | 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC'
  | 'VERSION_CHECKOUT_COMMIT_READ_FAILED'
  | 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED'
  | 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED'
  | 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED'
  | 'VERSION_CHECKOUT_DIRTY_WORKING_STATE'
  | 'VERSION_CHECKOUT_INVALID_TARGET'
  | 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE'
  | 'VERSION_CHECKOUT_MISSING_COMMIT'
  | 'VERSION_CHECKOUT_MISSING_DEPENDENCY'
  | 'VERSION_CHECKOUT_MISSING_HEAD_READER'
  | 'VERSION_CHECKOUT_MISSING_REF'
  | 'VERSION_CHECKOUT_MISSING_REF_READER'
  | 'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE'
  | 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES'
  | 'VERSION_CHECKOUT_PENDING_RECALC'
  | 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED'
  | 'VERSION_CHECKOUT_SNAPSHOT_READ_FAILED'
  | 'VERSION_CHECKOUT_PROVIDER_ERROR'
  | 'VERSION_CHECKOUT_REF_READ_FAILED'
  | 'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED'
  | 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE'
  | 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD'
  | 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT'
  | 'VERSION_CHECKOUT_UNSUPPORTED_TARGET'
  | 'VERSION_CHECKOUT_WRITE_FENCE_STALE'
  | 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE'
  | 'VERSION_INVALID_COMMIT_ID'
  | 'VERSION_INVALID_COMMIT_PAYLOAD'
  | 'VERSION_INVALID_OPTIONS'
  | 'VERSION_MISSING_DEPENDENCY'
  | 'VERSION_MISSING_OBJECT'
  | 'VERSION_MISSING_PARENT'
  | 'VERSION_OBJECT_STORE_FAILURE'
  | 'VERSION_PERMISSION_DENIED'
  | 'VERSION_PROVIDER_ERROR'
  | 'VERSION_REF_WRITE_UNAVAILABLE'
  | 'VERSION_REDACTION_VIOLATION'
  | 'VERSION_REF_CONFLICT'
  | 'VERSION_STALE_PAGE_CURSOR'
  | 'VERSION_STORE_READ_ONLY'
  | 'VERSION_STORE_UNAVAILABLE'
  | 'VERSION_UNMATERIALIZABLE_COMMIT'
  | 'VERSION_UNSUPPORTED_SCHEMA'
  | 'VERSION_UNSUPPORTED_PAGE_TOKEN'
  | 'VERSION_UNSUPPORTED_PARENT_COMMIT'
  | 'VERSION_WRONG_DOCUMENT'
  | 'VERSION_WRONG_NAMESPACE'
  | (string & {});

export type VersionDiagnosticMessageId = string & {
  readonly __brand?: 'VersionDiagnosticMessageId';
};

export type VersionDiagnosticPublicPayload = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface VersionStoreDiagnostic {
  readonly issueCode: VersionDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error' | 'fatal';
  readonly recoverability: 'retry' | 'repair' | 'unsupported' | 'none';
  readonly messageTemplateId: VersionDiagnosticMessageId;
  readonly safeMessage: string;
  readonly payload?: VersionDiagnosticPublicPayload;
  readonly redacted: boolean;
  readonly mutationGuarantee?:
    | 'ref-not-mutated'
    | 'registry-not-visible'
    | 'no-write-attempted'
    | 'unknown-after-crash';
}

export type VersionRedactedValue = {
  readonly kind: 'redacted';
  readonly reason: 'permission-denied' | 'redaction-policy' | 'historical-acl-unavailable';
};

export type VersionAnnotationText =
  | {
      readonly kind: 'text';
      readonly value: string;
    }
  | VersionRedactedValue;

export interface RedactedVersionAuthor {
  readonly actorKind?: string;
  readonly displayName?: string;
  readonly redacted: boolean;
}

export interface WorkbookCommitRef {
  readonly id: WorkbookCommitId;
  readonly refName?: VersionMainRefName | VersionRefName;
  readonly resolvedFrom?: VersionRefSelector;
  readonly refRevision?: VersionRecordRevision;
}

export interface WorkbookCommitAnnotationSummary {
  readonly message?: VersionAnnotationText;
  readonly title?: VersionAnnotationText;
  readonly tags?: readonly VersionAnnotationText[];
}

export interface WorkbookCommitSummary {
  readonly id: WorkbookCommitId;
  readonly parents: readonly WorkbookCommitId[];
  readonly createdAt: string;
  readonly author: RedactedVersionAuthor;
  readonly annotation?: WorkbookCommitAnnotationSummary;
  readonly orphan?: true;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
}

export interface VersionRef {
  readonly name: VersionMainRefName | VersionRefName;
  readonly commitId: WorkbookCommitId;
  readonly revision: VersionRecordRevision;
  readonly updatedAt?: string;
}

export interface VersionSymbolicRef {
  readonly name: 'HEAD';
  readonly target: VersionMainRefName | VersionRefName;
  readonly revision: VersionRecordRevision;
}

export type VersionDegradedHeadResult = {
  readonly status: 'degraded';
  readonly ref?: VersionRef | VersionSymbolicRef;
  readonly diagnostics: readonly VersionStoreDiagnostic[];
};

export type VersionPage<T, TOrder extends VersionPageOrder = VersionPageOrder> =
  | {
      readonly status: 'success';
      readonly items: readonly T[];
      readonly nextPageToken?: VersionPageToken;
      readonly readRevision: VersionRecordRevision;
      readonly order: TOrder;
      readonly diagnostics?: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'degraded';
      readonly items: readonly T[];
      readonly readRevision?: VersionRecordRevision;
      readonly order: TOrder;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type VersionCommitPage = VersionPage<WorkbookCommitSummary, 'topological-newest'>;

export interface VersionGetHeadOptions {
  readonly includeDiagnostics?: boolean;
}

export interface VersionListCommitsOptions {
  readonly ref?: VersionRefSelector;
  readonly from?: WorkbookCommitId;
  readonly pageSize?: number;
  readonly pageToken?: VersionPageToken | string;
  readonly includeOrphans?: boolean;
  readonly includeDiagnostics?: boolean;
}

export interface VersionListRefsOptions {
  /**
   * Optional branch-name prefix filter. Examples: `budget` or
   * `refs/heads/budget`. `main` is included when it matches the supplied
   * prefix, or when no prefix is supplied.
   */
  readonly prefix?: VersionBranchName | VersionRefName | string;
  readonly includeDiagnostics?: boolean;
}

export type VersionCommitish =
  | WorkbookCommitId
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly name: VersionRefSelector;
    };

export interface VersionDiffOptions {
  readonly pageSize?: number;
  readonly pageToken?: VersionDiffCursor | VersionPageToken | string;
  readonly includeDerivedImpact?: boolean;
  readonly includeDiagnostics?: boolean;
}

export type VersionDiffResourceLimitKind =
  | 'pageLimit'
  | 'publicCursorBytes'
  | 'responseBytes'
  | 'singleValueBytes'
  | 'exactCountScanChanges'
  | 'diffCacheEntriesPerDocument';

export type VersionDiffResourceLimitUnit = 'changes' | 'bytes' | 'entries';

export interface VersionDiffResourceLimit {
  readonly kind: VersionDiffResourceLimitKind;
  readonly limit: number;
  readonly unit: VersionDiffResourceLimitUnit;
  readonly observed?: number;
}

export interface VersionDiffResourceLimitSummary {
  readonly status: 'within-budget' | 'truncated' | 'exceeded';
  readonly limits: readonly VersionDiffResourceLimit[];
  readonly omittedValueCount?: number;
  readonly exactTotalCountUnavailable?: boolean;
}

export type VersionCheckoutTarget =
  | {
      readonly kind: 'head';
    }
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly name: VersionRefSelector | VersionBranchName | VersionRefName;
    };

export interface VersionCheckoutOptions {
  readonly includeDiagnostics?: boolean;
  /**
   * Defaults to true. Dirty working state cannot be discarded by this checkout
   * slice; passing false returns a degraded unsupported result.
   */
  readonly requireClean?: boolean;
}

export type VersionCheckoutDependencyRole =
  | 'snapshotRoot'
  | 'semanticChangeSet'
  | 'mutationSegment'
  | 'redactionSummary'
  | 'verificationSummary';

export interface VersionCheckoutDependencySummary {
  readonly role: VersionCheckoutDependencyRole;
  readonly objectType: string;
  readonly index?: number;
}

export type VersionCheckoutResolvedTarget =
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly refName: VersionMainRefName | VersionRefName;
      readonly commitId: WorkbookCommitId;
      readonly refRevision: VersionRecordRevision;
      readonly refIncarnationId?: string;
    }
  | {
      readonly kind: 'head';
      readonly refName: VersionMainRefName | VersionRefName;
      readonly commitId: WorkbookCommitId;
      readonly refRevision?: VersionRecordRevision;
      readonly refIncarnationId?: string;
    };

export interface VersionCheckoutPlan {
  readonly strategy: 'fullSnapshot';
  readonly target: VersionCheckoutResolvedTarget;
  readonly commitId: WorkbookCommitId;
  readonly parentCommitIds: readonly WorkbookCommitId[];
  readonly requiredDependencies: readonly VersionCheckoutDependencySummary[];
  readonly requiredDependencyCount: number;
}

export type VersionCheckoutMutationGuarantee =
  | 'no-workbook-mutation'
  | 'workbook-state-materialized'
  | 'unknown-after-partial-mutation';

export type VersionCheckoutResult =
  | {
      readonly status: 'success';
      readonly materialization: 'planned';
      readonly plan: VersionCheckoutPlan;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly mutationGuarantee: 'no-workbook-mutation';
    }
  | {
      readonly status: 'success';
      readonly materialization: 'applied';
      readonly plan: VersionCheckoutPlan;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly mutationGuarantee: 'workbook-state-materialized';
    }
  | {
      readonly status: 'degraded';
      readonly materialization: 'not-applied';
      readonly plan: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly mutationGuarantee: Exclude<
        VersionCheckoutMutationGuarantee,
        'workbook-state-materialized'
      >;
    };

export type CheckoutVersionResult = Extract<VersionCheckoutResult, { readonly status: 'success' }>;

export type VersionSemanticValue =
  | null
  | boolean
  | number
  | string
  | {
      readonly kind: 'blank';
    }
  | {
      readonly kind: 'dateTime';
      readonly iso: string;
    }
  | {
      readonly kind: 'duration';
      readonly iso: string;
    }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly message?: string;
    }
  | {
      readonly kind: 'formula';
      readonly formula: string;
      readonly result?: VersionSemanticValue;
    }
  | {
      readonly kind: 'array';
      readonly values: readonly VersionSemanticValue[];
    }
  | {
      readonly kind: 'richText';
      readonly runs: readonly {
        readonly text: string;
        readonly styleRef?: string;
      }[];
    }
  | {
      readonly kind: 'object';
      readonly fields: readonly {
        readonly key: string;
        readonly value: VersionSemanticValue;
      }[];
    };

export type VersionDiffValue =
  | {
      readonly kind: 'value';
      readonly value: VersionSemanticValue;
    }
  | VersionRedactedValue;

export type VersionDiffDisplayValue =
  | {
      readonly kind: 'value';
      readonly value: string;
    }
  | VersionRedactedValue;

export interface VersionDiffDisplay {
  readonly sheetName?: VersionDiffDisplayValue;
  readonly address?: VersionDiffDisplayValue;
  readonly entityLabel?: VersionDiffDisplayValue;
}

export type VersionDiffStructuralMetadata =
  | {
      readonly kind: 'metadata';
      readonly changeId: string;
      readonly domain: string;
      readonly entityId: string;
      readonly propertyPath: readonly string[];
    }
  | VersionRedactedValue;

export interface VersionDiffEntry {
  readonly structural: VersionDiffStructuralMetadata;
  readonly before: VersionDiffValue;
  readonly after: VersionDiffValue;
  readonly display?: VersionDiffDisplay;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
}

export type WorkbookDiffPage = VersionPage<VersionDiffEntry, 'semantic-change-order'> & {
  readonly resourceLimits?: VersionDiffResourceLimitSummary;
};

export type GetVersionHeadInput = VersionGetHeadOptions;
export type VersionHead = WorkbookCommitRef;
export type ListVersionCommitsInput = VersionListCommitsOptions;
export type ListVersionRefsInput = VersionListRefsOptions;

export interface VersionDiffInput {
  readonly base: VersionCommitish;
  readonly target: VersionCommitish;
  readonly options?: VersionDiffOptions;
}

export interface VersionSemanticDiffPage extends Paged<VersionDiffEntry> {
  readonly readRevision: VersionRecordRevision;
  readonly order: 'semantic-change-order';
  readonly resourceLimits?: VersionDiffResourceLimitSummary;
}

export interface VersionMergeInput {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
}

export interface VersionMergeOptions {
  readonly mode?: 'preview';
  readonly includeDiagnostics?: boolean;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly persistReviewRecord?: boolean;
}

export interface VersionMergeChange {
  readonly structural: VersionDiffStructuralMetadata;
  readonly base: VersionDiffValue;
  readonly ours?: VersionDiffValue;
  readonly theirs?: VersionDiffValue;
  readonly merged: VersionDiffValue;
  readonly display?: VersionDiffDisplay;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
}

export type VersionMergeConflictResolutionOptionKind = 'acceptOurs' | 'acceptTheirs' | 'acceptBase';

export interface VersionMergeConflictResolutionOption {
  readonly optionId: string;
  readonly conflictId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly value: VersionDiffValue;
  readonly recalcRequired: boolean;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
}

export interface VersionMergeConflict {
  readonly conflictId: string;
  readonly conflictDigest: string;
  readonly conflictKind: 'same-property';
  readonly structural: VersionDiffStructuralMetadata;
  readonly base: VersionDiffValue;
  readonly ours: VersionDiffValue;
  readonly theirs: VersionDiffValue;
  readonly resolutionOptions: readonly VersionMergeConflictResolutionOption[];
  readonly display?: VersionDiffDisplay;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
}

export type VersionMergeMutationGuarantee = 'preview-only';

export type VersionMergeResultId = `merge-result:${string}` & {
  readonly __brand: 'VersionMergeResultId';
};

export type VersionMergeAttemptPersistence = 'ephemeral' | 'persisted';
export type VersionMergeAttemptKind = 'applyable' | 'reviewOnly';

export interface VersionMergeAttemptMetadata {
  readonly previewArtifactDigest?: ObjectDigest;
  readonly resultDigest?: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly attemptPersistence?: VersionMergeAttemptPersistence;
  readonly attemptKind?: VersionMergeAttemptKind;
  readonly resultId?: VersionMergeResultId;
  readonly expiresAt?: string;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly applicationPlanDigest?: ObjectDigest;
  readonly applyEligibilityDigest?: ObjectDigest;
}

export type VersionMergeResult = VersionMergeAttemptMetadata &
  (
    | {
        readonly status: 'clean';
        readonly base: WorkbookCommitId;
        readonly ours: WorkbookCommitId;
        readonly theirs: WorkbookCommitId;
        readonly changes: readonly VersionMergeChange[];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly [];
        readonly mutationGuarantee: VersionMergeMutationGuarantee;
      }
    | {
        readonly status: 'conflicted';
        readonly base: WorkbookCommitId;
        readonly ours: WorkbookCommitId;
        readonly theirs: WorkbookCommitId;
        readonly changes: readonly VersionMergeChange[];
        readonly conflicts: readonly VersionMergeConflict[];
        readonly diagnostics: readonly [];
        readonly mutationGuarantee: VersionMergeMutationGuarantee;
      }
    | {
        readonly status: 'fastForward' | 'alreadyMerged';
        readonly base: WorkbookCommitId;
        readonly ours: WorkbookCommitId;
        readonly theirs: WorkbookCommitId;
        readonly changes: readonly [];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly [];
        readonly mutationGuarantee: VersionMergeMutationGuarantee;
      }
    | {
        readonly status: 'blocked';
        readonly base: WorkbookCommitId | null;
        readonly ours: WorkbookCommitId | null;
        readonly theirs: WorkbookCommitId | null;
        readonly changes: readonly [];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly VersionStoreDiagnostic[];
        readonly mutationGuarantee: VersionMergeMutationGuarantee;
      }
  );

export interface VersionApplyMergeResolution {
  readonly conflictId: string;
  readonly expectedConflictDigest: string;
  readonly optionId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly sealedPayloadRef?: import('./version-merge-review').VersionSealedResolutionPayloadRef;
}

export type VersionApplyMergeInput =
  | (VersionMergeInput & {
      readonly resolutions?: readonly VersionApplyMergeResolution[];
    })
  | {
      readonly resultId: VersionMergeResultId;
      readonly resultDigest: ObjectDigest;
      readonly previewArtifactDigest?: ObjectDigest;
      readonly resolutionSetDigest?: ObjectDigest;
      readonly resolvedAttemptDigest?: ObjectDigest;
      readonly resolutions?: readonly VersionApplyMergeResolution[];
    };

export interface VersionApplyMergeOptions {
  readonly mode?: 'preview' | 'apply';
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly includeDiagnostics?: boolean;
  readonly materializeActiveCheckout?: boolean;
}

export type VersionApplyMergeMutationGuarantee =
  | 'preview-only'
  | 'merge-commit-created'
  | 'ref-fast-forwarded'
  | 'no-write-attempted'
  | 'ref-not-mutated'
  | 'unknown-after-crash';

export interface VersionApplyMergeAttemptMetadata {
  readonly resultId?: VersionMergeResultId;
  readonly previewArtifactDigest?: ObjectDigest;
  readonly resultDigest?: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly headBefore?: WorkbookCommitId;
  readonly headAfter?: WorkbookCommitId;
  readonly applicationPlanDigest?: ObjectDigest;
}

export type VersionApplyMergeResult = VersionApplyMergeAttemptMetadata &
  (
    | {
        readonly status: 'planned';
        readonly base: WorkbookCommitId;
        readonly ours: WorkbookCommitId;
        readonly theirs: WorkbookCommitId;
        readonly changes: readonly VersionMergeChange[];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly [];
        readonly resolutionCount: number;
        readonly mutationGuarantee: VersionApplyMergeMutationGuarantee;
      }
    | {
        readonly status: 'applied';
        readonly base: WorkbookCommitId;
        readonly ours: WorkbookCommitId;
        readonly theirs: WorkbookCommitId;
        readonly commitRef: WorkbookCommitRef;
        readonly changes: readonly VersionMergeChange[];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly [];
        readonly resolutionCount: number;
        readonly mutationGuarantee: VersionApplyMergeMutationGuarantee;
      }
    | {
        readonly status: 'fastForwarded' | 'alreadyApplied' | 'alreadyMerged';
        readonly base: WorkbookCommitId;
        readonly ours: WorkbookCommitId;
        readonly theirs: WorkbookCommitId;
        readonly commitRef: WorkbookCommitRef;
        readonly changes: readonly [];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly [];
        readonly resolutionCount: number;
        readonly mutationGuarantee: 'ref-fast-forwarded' | 'ref-not-mutated';
      }
    | {
        readonly status: 'conflicted';
        readonly base: WorkbookCommitId;
        readonly ours: WorkbookCommitId;
        readonly theirs: WorkbookCommitId;
        readonly changes: readonly VersionMergeChange[];
        readonly conflicts: readonly VersionMergeConflict[];
        readonly diagnostics: readonly [];
        readonly requiredResolutionCount: number;
        readonly mutationGuarantee: VersionApplyMergeMutationGuarantee;
      }
    | {
        readonly status: 'blocked';
        readonly base: WorkbookCommitId | null;
        readonly ours: WorkbookCommitId | null;
        readonly theirs: WorkbookCommitId | null;
        readonly changes: readonly [];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly VersionStoreDiagnostic[];
        readonly mutationGuarantee: VersionApplyMergeMutationGuarantee;
      }
    | {
        readonly status: 'staleTargetHead';
        readonly base: WorkbookCommitId | null;
        readonly ours: WorkbookCommitId | null;
        readonly theirs: WorkbookCommitId | null;
        readonly changes: readonly [];
        readonly conflicts: readonly [];
        readonly diagnostics: readonly VersionStoreDiagnostic[];
        readonly mutationGuarantee: 'ref-not-mutated';
      }
  );

export type RedactionPolicy = {
  readonly mode: 'default' | 'strict' | 'clean';
  readonly redactSecrets: boolean;
  readonly redactExternalLinks: boolean;
  readonly redactAgentTrace: boolean;
};

export type VersionRedactionClass =
  | 'secret'
  | 'credential'
  | 'local-path'
  | 'external-link-private-evidence'
  | 'agent-trace'
  | 'host-handle'
  | 'protected-value'
  | 'opaque-sensitive-state';

export type VersionCommitMode =
  | {
      readonly kind: 'normal';
    }
  | {
      readonly kind: 'root';
    }
  | {
      readonly kind: 'import-root';
    };

export interface VersionCommitExpectedHead {
  readonly commitId: WorkbookCommitId;
  readonly revision: VersionRecordRevision;
  readonly symbolicHeadRevision?: VersionRecordRevision;
}

export interface VersionCommitOptions {
  readonly message?: string;
  readonly targetRef?: VersionMainRefName | VersionRefName | VersionBranchName;
  readonly redactionPolicy?: RedactionPolicy;
  readonly expectedHead?: VersionCommitExpectedHead;
  readonly mode?: VersionCommitMode;
}

export interface VersionCreateBranchOptions {
  readonly name: VersionBranchName | VersionRefName;
  readonly targetCommitId: WorkbookCommitId;
  readonly baseCommitId?: WorkbookCommitId;
  readonly expectedAbsent?: true;
}

export interface VersionFastForwardBranchOptions {
  readonly name: VersionBranchName | VersionRefName;
  readonly nextCommitId: WorkbookCommitId;
  readonly expectedHead: WorkbookCommitId;
  readonly expectedRefRevision: VersionCounterRecordRevision;
}

export type VersionUpdateBranchOptions = VersionFastForwardBranchOptions;

export interface VersionDeleteRefOptions {
  readonly name: VersionBranchName | VersionRefName;
  readonly expectedHead?: WorkbookCommitId;
  readonly expectedRefRevision: VersionCounterRecordRevision;
}

export type VersionSymbolicRefReadResult =
  | {
      readonly status: 'success';
      readonly ref: VersionSymbolicRef;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly ref: VersionSymbolicRef | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type VersionBranchRefReadResult =
  | {
      readonly status: 'success';
      readonly ref: VersionRef;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly ref: VersionRef | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type VersionRefReadResult =
  | VersionSymbolicRefReadResult
  | VersionBranchRefReadResult
  | {
      readonly status: 'degraded';
      readonly ref: VersionRef | VersionSymbolicRef | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type VersionRefListResult =
  | {
      readonly status: 'success';
      readonly items: readonly VersionRef[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly items: readonly VersionRef[];
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type VersionRefMutationResult =
  | {
      readonly status: 'success';
      readonly ref: VersionRef;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly ref: VersionRef | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

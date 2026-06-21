/**
 * WorkbookVersion -- public version-control API slice.
 *
 * This surface exposes status, read-only graph inspection, and the first public
 * commit entrypoint. Checkout, merge, and branch mutation APIs are not part of
 * this slice.
 */

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

export type WorkbookVersionDiagnosticCode =
  | 'version.objectStore.foundationPresent'
  | 'version.objectStore.serviceUnavailable'
  | 'version.refLifecycle.foundationPresent'
  | 'version.refLifecycle.serviceUnavailable'
  | 'version.commitApi.pending'
  | 'version.commitApi.serviceAttached'
  | 'version.checkout.pending'
  | 'version.merge.pending'
  | 'version.provenanceAdmission.present'
  | 'version.provenanceAdmission.unavailable'
  | 'version.head.serviceUnavailable';

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

export type VersionRecordRevision =
  | {
      readonly kind: 'counter';
      readonly value: string;
    }
  | {
      readonly kind: 'opaque';
      readonly value: string;
    };

export type VersionPageToken = string & {
  readonly __brand?: 'VersionPageToken';
};

export type VersionMainRefName = 'refs/heads/main';
export type VersionRefName = string & {
  readonly __brand?: 'VersionRefName';
};
export type VersionRefSelector = 'HEAD' | VersionMainRefName | VersionRefName;

export type VersionPageOrder = 'topological-newest' | 'semantic-change-order';

export type VersionDiagnosticCode =
  | 'VERSION_DANGLING_REF'
  | 'VERSION_GRAPH_CONFLICT'
  | 'VERSION_GRAPH_UNINITIALIZED'
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
  readonly pageToken?: VersionPageToken | string;
  readonly includeDerivedImpact?: boolean;
  readonly includeDiagnostics?: boolean;
}

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

export type WorkbookDiffPage = VersionPage<VersionDiffEntry, 'semantic-change-order'>;

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
  readonly redactionPolicy?: RedactionPolicy;
  readonly expectedHead?: VersionCommitExpectedHead;
  readonly mode?: VersionCommitMode;
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

export interface WorkbookVersion {
  getStatus(): Promise<WorkbookVersionStatus>;
  getHead(): Promise<WorkbookCommitRef | VersionDegradedHeadResult>;
  getHead(options: VersionGetHeadOptions): Promise<WorkbookCommitRef | VersionDegradedHeadResult>;
  listCommits(options?: VersionListCommitsOptions): Promise<VersionCommitPage>;
  commit(options?: VersionCommitOptions): Promise<WorkbookCommitRef>;
  diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options?: VersionDiffOptions,
  ): Promise<WorkbookDiffPage>;
  readRef(name: 'HEAD'): Promise<VersionSymbolicRefReadResult>;
  readRef(name: VersionMainRefName | VersionRefName): Promise<VersionBranchRefReadResult>;
  readRef(name: VersionRefSelector): Promise<VersionRefReadResult>;
}

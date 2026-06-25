import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { ObjectDigest } from './object-digest';
import type { VersionGraphNamespace } from './object-store';

export type MergeApplyIntentApplyKind = 'fastForward' | 'alreadyMerged' | 'mergeCommit';
export type MergeApplyIntentState = 'staging' | 'casCommitted' | 'finalized' | 'aborted';
export type MergeApplyIntentTerminalStatus =
  | 'applied'
  | 'fastForwarded'
  | 'alreadyApplied'
  | 'alreadyMerged'
  | 'staleTargetHead';

export type MergeApplyIntentId = `merge-apply-intent:sha256:${string}`;
export type MergeApplyIntentIdempotencyKey = `merge-apply:${string}`;

export type MergeApplyRefCasProof = {
  readonly schemaVersion: 1;
  readonly applyKind: MergeApplyIntentApplyKind;
  readonly commitMetadataDigest: ObjectDigest;
  readonly refUpdateMetadataDigest: ObjectDigest;
  readonly refLogEventDigest: ObjectDigest;
};

export type MergeApplyRefCasProofLookup = {
  readonly applyKind: MergeApplyIntentApplyKind;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly headBefore: WorkbookCommitId;
  readonly headAfter: WorkbookCommitId;
};

export type MergeApplyIntentRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'mergeApplyIntent';
  readonly intentId: MergeApplyIntentId;
  readonly idempotencyKey: MergeApplyIntentIdempotencyKey;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly applyKind: MergeApplyIntentApplyKind;
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly state: MergeApplyIntentState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal?: {
    readonly status: MergeApplyIntentTerminalStatus;
    readonly headBefore: WorkbookCommitId;
    readonly headAfter?: WorkbookCommitId;
    readonly commitId?: WorkbookCommitId;
    readonly refCasProof?: MergeApplyRefCasProof;
  };
};

export type BeginMergeApplyIntentInput = Omit<
  MergeApplyIntentRecord,
  | 'schemaVersion'
  | 'recordKind'
  | 'namespaceKey'
  | 'documentScopeKey'
  | 'state'
  | 'updatedAt'
  | 'terminal'
>;

export type CompleteMergeApplyIntentInput = {
  readonly intentId: MergeApplyIntentId;
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly terminal: NonNullable<MergeApplyIntentRecord['terminal']>;
  readonly completedAt: string;
};

export type MergeApplyIntentStoreDiagnostic = {
  readonly code:
    | 'VERSION_INVALID_OPTIONS'
    | 'VERSION_INTENT_CONFLICT'
    | 'VERSION_INTENT_NOT_FOUND'
    | 'VERSION_PROVIDER_FAILED';
  readonly message: string;
  readonly recoverability: 'retry' | 'repair' | 'none';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type MergeApplyIntentReadResult =
  | {
      readonly status: 'found';
      readonly record: MergeApplyIntentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing';
      readonly record: null;
      readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[];
    };

export type MergeApplyIntentBeginResult =
  | {
      readonly status: 'created' | 'existing';
      readonly record: MergeApplyIntentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'conflict';
      readonly record: MergeApplyIntentRecord;
      readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[];
    };

export type MergeApplyIntentCompleteResult =
  | {
      readonly status: 'completed';
      readonly record: MergeApplyIntentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing' | 'conflict' | 'failed';
      readonly record: MergeApplyIntentRecord | null;
      readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[];
    };

export type MergeApplyRefCasProofReadResult =
  | {
      readonly status: 'found';
      readonly proof: MergeApplyRefCasProof;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing' | 'failed';
      readonly proof: null;
      readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[];
    };

export interface MergeApplyIntentStore {
  readonly namespace: VersionGraphNamespace;
  beginIntent(input: BeginMergeApplyIntentInput): Promise<MergeApplyIntentBeginResult>;
  readByIntentId(intentId: MergeApplyIntentId): Promise<MergeApplyIntentReadResult>;
  readByIdempotencyKey(
    idempotencyKey: MergeApplyIntentIdempotencyKey,
  ): Promise<MergeApplyIntentReadResult>;
  readRefCasProof(input: MergeApplyRefCasProofLookup): Promise<MergeApplyRefCasProofReadResult>;
  completeIntent(input: CompleteMergeApplyIntentInput): Promise<MergeApplyIntentCompleteResult>;
}

export type MergeApplyIntentStoreProvider = {
  openMergeApplyIntentStore(namespace: VersionGraphNamespace): Promise<MergeApplyIntentStore>;
};

export type MergeApplyIntentMemoryBackendSnapshot = {
  readonly records: readonly MergeApplyIntentRecord[];
  readonly refCasProofs?: readonly {
    readonly key: string;
    readonly proof: MergeApplyRefCasProof;
  }[];
};

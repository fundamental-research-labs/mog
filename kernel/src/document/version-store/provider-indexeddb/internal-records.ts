import type { WorkbookCommitPayload } from '../commit-store';
import type { VersionGraphSymbolicRef } from '../graph';
import type {
  MergeApplyRefCasProof,
  MergeApplyRefCasProofLookup,
} from '../merge-apply-intent-store';
import type { ObjectDigest, WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace, VersionObjectRecord } from '../object-store';
import type { VersionGraphRegistry } from '../registry';
import type { InMemoryRefStoreSnapshot } from '../refs/ref-store-snapshot';
import type { RefRecord } from '../refs/ref-store';

export type RegistryRecordRead =
  | { readonly status: 'absent' }
  | { readonly status: 'valid'; readonly registry: VersionGraphRegistry }
  | { readonly status: 'corrupt' }
  | { readonly status: 'unsupported' };

export type StoredRegistryEnvelope = {
  readonly schemaVersion: 1;
  readonly registry: VersionGraphRegistry;
};

export type StoredObjectRecord = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly record: VersionObjectRecord<unknown>;
};

export type StoredRefRecord = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly record: RefRecord;
};

export type StoredSymbolicRef = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly ref: VersionGraphSymbolicRef;
};

export type StoredCommitIndex = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly commitId: WorkbookCommitId;
  readonly parentCommitIds: readonly WorkbookCommitId[];
  readonly createdAt: string;
  readonly author: WorkbookCommitPayload['author'];
  readonly objectDigest: ObjectDigest;
};

export type StoredParentIndex = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly parentLookupKey: string;
  readonly parentCommitId: WorkbookCommitId;
  readonly childCommitId: WorkbookCommitId;
};

export type StoredIndexManifest = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly namespace: VersionGraphNamespace;
  readonly refStoreNextGeneratedId: InMemoryRefStoreSnapshot['nextGeneratedId'];
  readonly refStoreLiveRefCount?: number;
  readonly updatedAt: string;
};

export type StoredIntent = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly operation: 'graph-snapshot-write';
  readonly recordedAt: string;
};

export type StoredRefCasProofIntent = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly operation: 'merge-ref-cas-proof';
  readonly lookup: MergeApplyRefCasProofLookup;
  readonly proof: MergeApplyRefCasProof;
  readonly recordedAt: string;
};

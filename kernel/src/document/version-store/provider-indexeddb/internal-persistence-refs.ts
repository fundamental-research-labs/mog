import { VERSION_GRAPH_MAIN_REF } from '../graph';
import type { InMemoryVersionGraphStoreSnapshot } from '../graph';
import {
  computeMergeApplyRefCasProof,
  type MergeApplyRefCasProofLookup,
} from '../merge-apply-intent-store';
import type { LiveRefRecord } from '../refs/ref-store';
import type { StoredRefCasProofIntent } from './internal-records';
import type { PersistGraphSnapshotMode } from './internal-persistence-types';

export type RefWritePlan =
  | { readonly kind: 'all' }
  | {
      readonly kind: 'selected';
      readonly refNames: readonly string[];
      readonly writeSymbolicHead: boolean;
      readonly writeManifest: boolean;
    };

export function refWritePlanForMode(mode: PersistGraphSnapshotMode): RefWritePlan {
  if (mode.kind === 'initialize') return { kind: 'all' };
  return {
    kind: 'selected',
    refNames: Object.freeze([mode.targetRefName]),
    writeSymbolicHead: mode.targetRefName === 'main',
    writeManifest: mode.kind === 'createBranch' || mode.kind === 'deleteBranch',
  };
}

export async function refCasProofRowForMode(input: {
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly snapshot: InMemoryVersionGraphStoreSnapshot;
  readonly mode: PersistGraphSnapshotMode;
}): Promise<StoredRefCasProofIntent | null> {
  const mode = input.mode;
  if (mode.kind !== 'commit' || !mode.refCasProof) return null;
  const ref = input.snapshot.refStore.records.find(
    (candidate): candidate is LiveRefRecord =>
      candidate.state === 'live' && candidate.name === mode.targetRefName,
  );
  if (!ref) throw new Error('IndexedDB ref CAS proof target ref is missing from snapshot.');
  const lookup: MergeApplyRefCasProofLookup = {
    applyKind: mode.refCasProof.applyKind,
    targetRef: graphRefNameFromStorageRefName(mode.targetRefName),
    headBefore: mode.expectedHeadCommitId,
    headAfter: ref.targetCommitId,
  };
  return {
    schemaVersion: 1,
    namespaceKey: input.namespaceKey,
    documentScopeKey: input.documentScopeKey,
    operation: 'merge-ref-cas-proof',
    lookup,
    proof: await computeMergeApplyRefCasProof(lookup),
    recordedAt: new Date().toISOString(),
  };
}

function graphRefNameFromStorageRefName(name: string): MergeApplyRefCasProofLookup['targetRef'] {
  if (name === 'main') return VERSION_GRAPH_MAIN_REF;
  return `refs/heads/${name}` as MergeApplyRefCasProofLookup['targetRef'];
}

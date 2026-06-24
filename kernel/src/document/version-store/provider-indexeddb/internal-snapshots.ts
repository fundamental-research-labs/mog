import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type InMemoryVersionGraphStoreSnapshot,
  type VersionGraphRef,
} from '../graph';
import { graphRefFromLiveRef } from '../graph/graph-store-refs';
import {
  objectDigestFromWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type WorkbookCommitId,
} from '../object-digest';
import type { VersionGraphInitializeResult } from '../provider';
import { cloneVersionGraphRegistry, type VersionGraphRegistry } from '../registry';
import type { LiveRefRecord } from '../refs/ref-store';
import { cloneJson } from './internal-json';

export function liveMainFromSnapshot(snapshot: InMemoryVersionGraphStoreSnapshot): LiveRefRecord {
  const main = snapshot.refStore.records.find(
    (record): record is LiveRefRecord => record.state === 'live' && record.name === 'main',
  );
  if (!main) throw new Error('IndexedDB version graph snapshot is missing the live main ref.');
  return main;
}

export function rootCommitFromSnapshot(
  snapshot: InMemoryVersionGraphStoreSnapshot,
  commitId: WorkbookCommitId,
): WorkbookCommitId {
  const digest = objectDigestFromWorkbookCommitId(commitId);
  const record = snapshot.objectRecords.find(
    (candidate) =>
      candidate.digest.algorithm === digest.algorithm &&
      candidate.digest.digest === digest.digest &&
      candidate.preimage.objectType === 'workbook.commit.v1',
  );
  if (!record)
    throw new Error('IndexedDB version graph snapshot is missing the root commit object.');
  return workbookCommitIdFromObjectDigest(record.digest);
}

export function versionGraphRefFromLiveRef(ref: LiveRefRecord): VersionGraphRef {
  return graphRefFromLiveRef(ref);
}

export function initializeSuccess(
  registry: VersionGraphRegistry,
  main: VersionGraphRef,
): Extract<VersionGraphInitializeResult, { status: 'success' }> {
  return {
    status: 'success',
    registry: cloneVersionGraphRegistry(registry),
    rootCommit: {
      id: registry.rootCommitId,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_HEAD_REF,
      refRevision: cloneJson(main.revision),
    },
    initialHead: { ...main, revision: cloneJson(main.revision) },
    symbolicHead: {
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: cloneJson(main.revision),
    },
    diagnostics: [],
  };
}

import { cloneVersionStoreCapabilities, type VersionStoreCapabilities } from '../provider';

export const INDEXEDDB_VERSION_STORE_CAPABILITIES: VersionStoreCapabilities =
  cloneVersionStoreCapabilities({
    durableGraphRegistry: true,
    durableObjects: true,
    atomicObjectBatch: true,
    casRefs: true,
    casGraphRegistry: true,
    multiProcessCasGraphRegistry: false,
    multiProcessCasRefs: false,
    readOnlyHistory: false,
    integrityScan: false,
    corruptionQuarantine: false,
    reads: {
      graphRegistry: true,
      objects: true,
      refs: true,
      commits: true,
      snapshots: false,
      integrityReports: false,
    },
    writes: {
      initializeGraph: true,
      putObjects: true,
      updateRefs: true,
      updateSymbolicRefs: true,
      commitGraphWrite: true,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
  });

import { freezeCapabilities } from './provider-capabilities';
import type { VersionStoreCapabilities } from './provider-types';

export const IN_MEMORY_VERSION_STORE_CAPABILITIES: VersionStoreCapabilities = freezeCapabilities({
  durableGraphRegistry: false,
  durableObjects: false,
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

export const IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES: VersionStoreCapabilities =
  freezeCapabilities({
    ...IN_MEMORY_VERSION_STORE_CAPABILITIES,
    durableGraphRegistry: true,
    durableObjects: true,
  });

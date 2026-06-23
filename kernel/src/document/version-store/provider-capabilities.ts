import type { VersionStoreCapabilities } from './provider-types';

export function cloneVersionStoreCapabilities(
  capabilities: VersionStoreCapabilities,
): VersionStoreCapabilities {
  return freezeCapabilities({
    ...capabilities,
    reads: { ...capabilities.reads },
    writes: { ...capabilities.writes },
  });
}

export function readOnlyCapabilities(
  capabilities: VersionStoreCapabilities,
): VersionStoreCapabilities {
  return freezeCapabilities({
    ...capabilities,
    readOnlyHistory: true,
    writes: {
      initializeGraph: false,
      putObjects: false,
      updateRefs: false,
      updateSymbolicRefs: false,
      commitGraphWrite: false,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
    corruptionQuarantine: false,
  });
}

export function unavailableCapabilities(
  capabilities: VersionStoreCapabilities,
): VersionStoreCapabilities {
  return freezeCapabilities({
    ...capabilities,
    durableGraphRegistry: false,
    durableObjects: false,
    atomicObjectBatch: false,
    casRefs: false,
    casGraphRegistry: false,
    multiProcessCasGraphRegistry: false,
    multiProcessCasRefs: false,
    readOnlyHistory: true,
    integrityScan: false,
    corruptionQuarantine: false,
    reads: {
      graphRegistry: false,
      objects: false,
      refs: false,
      commits: false,
      snapshots: false,
      integrityReports: false,
    },
    writes: {
      initializeGraph: false,
      putObjects: false,
      updateRefs: false,
      updateSymbolicRefs: false,
      commitGraphWrite: false,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
  });
}

export function freezeCapabilities(
  capabilities: VersionStoreCapabilities,
): VersionStoreCapabilities {
  return Object.freeze({
    ...capabilities,
    reads: Object.freeze({ ...capabilities.reads }),
    writes: Object.freeze({ ...capabilities.writes }),
  });
}

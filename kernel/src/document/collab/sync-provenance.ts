import { DEFAULT_PROVENANCE_REDACTION_POLICY } from '@mog-sdk/types-document/storage';
import type { ClassifiedRawSyncUpdateProvenance } from '../providers/provider';

export type SidecarRawSyncClassification = 'hydration' | 'mixedRemote';

export function buildSidecarRawSyncProvenance(
  roomId: string,
  payloadHash: string,
  classification: SidecarRawSyncClassification,
): ClassifiedRawSyncUpdateProvenance {
  const updateIdentity = {
    originKind: 'room' as const,
    roomId,
    updateId: `ws-sidecar-${classification}:${payloadHash}`,
    payloadHash,
  };

  if (classification === 'hydration') {
    return {
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'collaborationHydration',
      updateIdentity,
      trust: { status: 'trustedLocalSystem' },
      author: { kind: 'system', systemRef: 'collaboration-hydration' },
      replay: true,
      system: true,
      capturePolicy: 'excluded',
      redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
      exclusionDiagnostic: {
        reason: 'hydration',
        message: 'Collaboration JOIN/RESUME full state is classified as hydration.',
      },
    };
  }

  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'collaborationMixedRemote',
    updateIdentity,
    trust: { status: 'unverified' },
    author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
    replay: false,
    system: false,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'mixedAuthors',
      message: 'Collaboration server diff lacks per-update provenance boundaries.',
    },
  };
}

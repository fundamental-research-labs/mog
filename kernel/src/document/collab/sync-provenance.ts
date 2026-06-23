import { DEFAULT_PROVENANCE_REDACTION_POLICY } from '@mog-sdk/types-document/storage';
import type { ClassifiedRawSyncUpdateProvenance } from '../providers/provider';
import type { SyncUpdateWireSource } from './wire-codec';

export type SidecarRawSyncClassification = SyncUpdateWireSource;

export function buildSidecarRawSyncProvenance(
  roomId: string,
  payloadHash: string,
  classification: SidecarRawSyncClassification,
): ClassifiedRawSyncUpdateProvenance {
  const updateIdentity =
    classification.sourceKind === 'legacyRawUnknown'
      ? {
          originKind: 'legacyRaw' as const,
          roomId,
          updateId: `ws-sidecar-${classification.kind}:${payloadHash}`,
          payloadHash,
        }
      : {
          originKind: 'room' as const,
          roomId,
          updateId: `ws-sidecar-${classification.kind}:${payloadHash}`,
          payloadHash,
        };

  if (classification.sourceKind === 'collaborationHydration') {
    return {
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: classification.sourceKind,
      updateIdentity,
      trust: { status: 'trustedLocalSystem' },
      author: { kind: 'system', systemRef: 'collaboration-hydration' },
      replay: true,
      system: true,
      capturePolicy: 'excluded',
      redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
      exclusionDiagnostic: {
        reason: 'hydration',
        message: `Collaboration ${classification.messageName} update bytes are classified as hydration.`,
      },
    };
  }

  if (classification.sourceKind === 'legacyRawUnknown') {
    return {
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: classification.sourceKind,
      updateIdentity,
      trust: { status: 'legacyRaw' },
      author: { kind: 'unknown', reason: 'legacyRaw' },
      replay: false,
      system: false,
      capturePolicy: 'excluded',
      redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
      exclusionDiagnostic: {
        reason: 'legacyRawUnknown',
        subreason: 'rawUnclassified',
        message: `Collaboration ${classification.messageName} update bytes reached ws-sidecar without an explicit provenance classifier; admitted as legacy raw unknown.`,
      },
    };
  }

  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: classification.sourceKind,
    updateIdentity,
    trust: { status: 'unverified' },
    author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
    replay: false,
    system: false,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'mixedAuthors',
      message: `Collaboration ${classification.messageName} diff lacks per-update provenance boundaries.`,
    },
  };
}

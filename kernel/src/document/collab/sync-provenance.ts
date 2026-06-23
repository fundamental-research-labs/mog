import { DEFAULT_PROVENANCE_REDACTION_POLICY } from '@mog-sdk/types-document/storage';
import type {
  ProvenanceRedactionPolicy,
  SyncUpdateIdentity,
  SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
import type { ClassifiedRawSyncUpdateProvenance } from '../providers/provider';
import type { SyncUpdateWireSource } from './wire-codec';

export type SidecarRawSyncLegacyClassification = 'hydration' | 'mixedRemote';

export interface SidecarV2SyncProvenanceClassification {
  readonly schemaVersion: 'provider-inbound-update-v2';
  readonly provenance: SyncUpdateProvenance;
}

export type SidecarRawSyncClassification =
  | SyncUpdateWireSource
  | SidecarRawSyncLegacyClassification
  | SidecarV2SyncProvenanceClassification;

export function buildSidecarRawSyncProvenance(
  roomId: string,
  payloadHash: string,
  classification: SidecarRawSyncClassification,
): ClassifiedRawSyncUpdateProvenance {
  if (isSidecarV2SyncProvenanceClassification(classification)) {
    const projected = projectV2SyncProvenance(roomId, classification.provenance);
    if (projected) return projected;
    return buildLegacyRawUnknownProvenance(
      roomId,
      payloadHash,
      `v2Incompatible:${classification.provenance.sourceKind}`,
      `Collaboration V2 ${classification.provenance.sourceKind} provenance cannot be admitted through the classified raw compatibility path; admitted as legacy raw unknown.`,
    );
  }

  if (isLegacyRawSyncClassification(classification)) {
    return buildLegacyRawUnknownProvenance(
      roomId,
      payloadHash,
      `v1RawCompatibility-${classification}`,
      `Collaboration V1 raw ${classification} compatibility bytes do not carry VC-09 provenance; admitted as legacy raw unknown.`,
    );
  }

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
    return buildLegacyRawUnknownProvenance(
      roomId,
      payloadHash,
      classification.kind,
      `Collaboration ${classification.messageName} update bytes reached ws-sidecar without an explicit provenance classifier; admitted as legacy raw unknown.`,
    );
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

function isLegacyRawSyncClassification(
  classification: SidecarRawSyncClassification,
): classification is SidecarRawSyncLegacyClassification {
  return classification === 'hydration' || classification === 'mixedRemote';
}

function isSidecarV2SyncProvenanceClassification(
  classification: SidecarRawSyncClassification,
): classification is SidecarV2SyncProvenanceClassification {
  return (
    typeof classification === 'object' &&
    classification !== null &&
    'schemaVersion' in classification &&
    classification.schemaVersion === 'provider-inbound-update-v2' &&
    'provenance' in classification &&
    typeof classification.provenance === 'object' &&
    classification.provenance !== null
  );
}

function projectV2SyncProvenance(
  roomId: string,
  provenance: SyncUpdateProvenance,
): ClassifiedRawSyncUpdateProvenance | null {
  if (!isClassifiedRawCompatibleProvenance(provenance)) return null;
  return {
    ...provenance,
    updateIdentity: projectV2UpdateIdentity(
      roomId,
      provenance.updateIdentity,
      provenance.redaction,
    ),
  };
}

function isClassifiedRawCompatibleProvenance(
  provenance: SyncUpdateProvenance,
): provenance is ClassifiedRawSyncUpdateProvenance {
  return (
    provenance.capturePolicy !== 'commitEligible' &&
    provenance.sourceKind !== 'providerLiveInbound' &&
    provenance.sourceKind !== 'collaborationLiveRemote'
  );
}

function projectV2UpdateIdentity(
  roomId: string,
  identity: SyncUpdateIdentity,
  redaction: ProvenanceRedactionPolicy,
): SyncUpdateIdentity {
  return {
    originKind: identity.originKind,
    ...(identity.stableOriginId !== undefined && redaction.durableProviderIdentity !== 'unknown'
      ? { stableOriginId: identity.stableOriginId }
      : {}),
    ...(identity.providerKind === undefined ? {} : { providerKind: identity.providerKind }),
    roomId: identity.roomId ?? roomId,
    ...(identity.epoch === undefined ? {} : { epoch: identity.epoch }),
    ...(identity.updateId === undefined ? {} : { updateId: identity.updateId }),
    ...(identity.sequence === undefined ? {} : { sequence: identity.sequence }),
    payloadHash: identity.payloadHash,
    ...(identity.provenancePayloadHash === undefined
      ? {}
      : { provenancePayloadHash: identity.provenancePayloadHash }),
  };
}

function buildLegacyRawUnknownProvenance(
  roomId: string,
  payloadHash: string,
  updateIdKind: string,
  message: string,
): ClassifiedRawSyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'legacyRawUnknown',
    updateIdentity: {
      originKind: 'legacyRaw',
      roomId,
      updateId: `ws-sidecar-${updateIdKind}:${payloadHash}`,
      payloadHash,
    },
    trust: { status: 'legacyRaw' },
    author: { kind: 'unknown', reason: 'legacyRaw' },
    replay: false,
    system: false,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'legacyRawUnknown',
      subreason: 'rawUnclassified',
      message,
    },
  };
}

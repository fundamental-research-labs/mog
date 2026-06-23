export type DocumentByteSyncPortClassifiedRawProvenance =
  | {
      readonly schemaVersion: 'sync-update-provenance-v1';
      readonly sourceKind: 'collaborationHydration';
      readonly sdkLifecycle: DocumentByteSyncPortRawSyncLifecycle & {
        readonly source: 'collaborativeEngineBootstrap';
      };
      readonly updateIdentity: DocumentByteSyncPortClassifiedRawUpdateIdentity;
      readonly trust: { readonly status: 'trustedLocalSystem' | 'unverified' };
      readonly author:
        | { readonly kind: 'system'; readonly systemRef: 'collaboration-hydration' }
        | { readonly kind: 'unknown'; readonly reason: 'notProvided' | 'unverified' };
      readonly replay: true;
      readonly system: true;
      readonly capturePolicy: 'excluded';
      readonly redaction: DocumentByteSyncPortProvenanceRedactionPolicy;
      readonly exclusionDiagnostic?: DocumentByteSyncPortSyncUpdateExclusionDiagnostic;
    }
  | {
      readonly schemaVersion: 'sync-update-provenance-v1';
      readonly sourceKind: 'collaborationMixedRemote';
      readonly sdkLifecycle: DocumentByteSyncPortRawSyncLifecycle & {
        readonly source:
          | 'collaborativeEngineFlush'
          | 'collaborativeEnginePull'
          | 'collaborativeEngineSync';
      };
      readonly updateIdentity: DocumentByteSyncPortClassifiedRawUpdateIdentity;
      readonly trust: { readonly status: 'unverified' };
      readonly author:
        | {
            readonly kind: 'mixedRemote';
            readonly participantCount?: number;
            readonly reason: 'aggregateWithoutBoundaries' | 'multipleProvenAuthors';
          }
        | { readonly kind: 'unknown'; readonly reason: 'mixedAggregate' | 'unverified' };
      readonly replay: false;
      readonly system: false;
      readonly capturePolicy: 'excluded';
      readonly redaction: DocumentByteSyncPortProvenanceRedactionPolicy;
      readonly exclusionDiagnostic: DocumentByteSyncPortSyncUpdateExclusionDiagnostic;
    };

export type DocumentByteSyncPortRawSyncLifecycleSource =
  | 'legacyApplyUpdate'
  | 'collaborativeEngineBootstrap'
  | 'collaborativeEngineFlush'
  | 'collaborativeEnginePull'
  | 'collaborativeEngineSync';

export interface DocumentByteSyncPortRawSyncLifecycle {
  readonly schemaVersion: 'sdk-raw-sync-lifecycle-v1';
  readonly source: DocumentByteSyncPortRawSyncLifecycleSource;
  readonly capturePolicy: 'excluded';
}

export interface DocumentByteSyncPortClassifiedRawUpdateIdentity {
  readonly originKind: 'room';
  readonly roomId?: string;
  readonly updateId?: string;
  readonly payloadHash: string;
}

export interface DocumentByteSyncPortProvenanceRedactionPolicy {
  readonly schemaVersion: 'provenance-redaction-policy-v1';
  readonly mode: 'metadata-only' | 'opaque-digest-only' | 'diagnostic-only' | 'drop';
  readonly durableAuthorIdentity: 'unknown' | 'opaque-subject-ref' | 'hmac-sha256-digest';
  readonly durableProviderIdentity: 'unknown' | 'opaque-provider-ref' | 'hmac-sha256-digest';
  readonly redactionKeyId?: string;
  readonly proofMaterial: 'diagnostics-only' | 'drop';
}

export interface DocumentByteSyncPortSyncUpdateExclusionDiagnostic {
  readonly reason:
    | 'hydration'
    | 'mixedAuthors'
    | 'unknownAuthor'
    | 'unverifiedProvenance'
    | 'rawUnclassified';
  readonly subreason?: string;
  readonly message?: string;
}

export interface DocumentByteSyncPortApplyUpdateResult {
  readonly mutationResult: unknown;
  readonly metadata: unknown;
}

export type DocumentByteSyncPortApplyUpdateReturn = DocumentByteSyncPortApplyUpdateResult | void;

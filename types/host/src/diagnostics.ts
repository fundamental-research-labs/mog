import type { HostDocumentOperation } from './operations';
import type { HostCanonicalFingerprint } from './fingerprints';

export interface SecurityEventRef {
  readonly source: 'workbook-security-drain';
  readonly eventId?: string;
  readonly sequence?: number;
  readonly drainOffset?: number;
  readonly eventKind:
    | 'AccessDenied'
    | 'AmbiguityDetected'
    | 'PolicyAdded'
    | 'PolicyRemoved'
    | 'PolicyUpdated'
    | 'PoliciesReloaded';
  readonly policyVersion?: string;
  readonly fingerprint?: HostCanonicalFingerprint;
}

export interface HostDiagnosticBase {
  readonly correlationId: string;
  readonly decisionId?: string;
  readonly sourceHostId?: string;
  readonly timestamp: number;
}

export type HostDiagnosticEvent = HostDiagnosticBase &
  (
    | {
        readonly kind: 'identity.denied';
        readonly code: string;
        readonly subject?: string;
        readonly reason: string;
      }
    | {
        readonly kind: 'documentAuthorization.denied';
        readonly code: string;
        readonly operation: HostDocumentOperation;
        readonly reason: string;
      }
    | {
        readonly kind: 'capability.denied';
        readonly code: string;
        readonly capability: string;
        readonly operation: 'read' | 'write' | 'execute' | 'admin';
        readonly reason: string;
      }
    | {
        readonly kind: 'hostConstruction.invalid';
        readonly code: string;
        readonly phase:
          | 'trusted-context'
          | 'kernel-context'
          | 'principal-projection'
          | 'storage-handoff'
          | 'runtime-config';
        readonly invariant: string;
        readonly reason: string;
      }
    | {
        readonly kind: 'storage.failure';
        readonly code: string;
        readonly providerRefId: string;
        readonly providerId?: string;
        readonly phase: string;
      }
    | {
        readonly kind: 'access.denied';
        readonly code: string;
        readonly operation: string;
        readonly targetKind?: string;
        readonly securityEventRef?: SecurityEventRef;
      }
    | {
        readonly kind: 'access.ambiguity';
        readonly code: string;
        readonly policyVersion?: string;
        readonly securityEventRef?: SecurityEventRef;
      }
    | {
        readonly kind: 'runtime.assetFailure';
        readonly code: string;
        readonly assetKind: string;
        readonly urlPolicy: string;
      }
  );

export interface HostDiagnosticsSink {
  emit(event: HostDiagnosticEvent): void;
}

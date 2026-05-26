export type AuditOutcome = 'allowed' | 'denied' | 'failed' | 'succeeded';

export interface AuditActor {
  principalId: string;
  actorType: string;
}

export interface RuntimeAuditEvent {
  eventId: string;
  timestamp: string;
  tenantId: string;
  workspaceId?: string;
  documentId?: string;
  actor: AuditActor;
  service: string;
  operation: string;
  requestId?: string;
  traceId?: string;
  capabilityDecisionId?: string;
  storageProviderRefs?: string[];
  materializationDecisionRef?: string;
  rawByteDecisionRef?: string;
  importDecisionRef?: string;
  exportDecisionRef?: string;
  outcome: AuditOutcome;
  denialReason?: string;
  redactedMetadata?: Record<string, unknown>;
}

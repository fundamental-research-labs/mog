/** The actor (user, service account, system) that triggered the event. */
export interface AuditActor {
  /** Opaque principal identifier (user id, service account id, etc.). */
  principalId: string;

  /** Discriminant for the principal type (e.g. `"user"`, `"service"`, `"system"`). */
  actorType: string;
}

/** Outcome of the audited operation. */
export type AuditOutcome = 'allowed' | 'denied' | 'failed' | 'succeeded';

/**
 * Canonical audit record emitted by every Mog runtime service.
 *
 * Each service writes these to the audit log; the admin/ops surface reads
 * them. Fields prefixed with a decision-ref point back to the capability
 * system so auditors can trace *why* an action was permitted or denied.
 */
export interface RuntimeAuditEvent {
  /** Globally unique event identifier. */
  eventId: string;

  /** ISO-8601 timestamp of event creation. */
  timestamp: string;

  /** Tenant that owns the resource. */
  tenantId: string;

  /** Workspace scope (omitted for tenant-level events). */
  workspaceId?: string;

  /** Document scope (omitted for workspace-level events). */
  documentId?: string;

  /** Who performed the action. */
  actor: AuditActor;

  /** Originating service name (e.g. `"http"`, `"collab"`, `"compute"`). */
  service: string;

  /** Operation name (e.g. `"document.open"`, `"cell.write"`). */
  operation: string;

  /** Correlation id for the originating request. */
  requestId?: string;

  /** Distributed trace id for cross-service correlation. */
  traceId?: string;

  /** Reference to the capability-system decision that authorized this event. */
  capabilityDecisionId?: string;

  /** Storage provider references involved in this operation. */
  storageProviderRefs?: string[];

  /** Reference to a materialization decision (export path). */
  materializationDecisionRef?: string;

  /** Reference to a raw-byte access decision. */
  rawByteDecisionRef?: string;

  /** Reference to an import authorization decision. */
  importDecisionRef?: string;

  /** Reference to an export authorization decision. */
  exportDecisionRef?: string;

  /** Whether the operation was allowed, denied, failed, or succeeded. */
  outcome: AuditOutcome;

  /** Reason text when outcome is `"denied"`. */
  denialReason?: string;

  /**
   * Additional metadata for audit consumers.
   *
   * SECURITY: Must never contain secrets, tokens, credentials, PII, or raw
   * byte content. Services must redact before populating.
   */
  redactedMetadata?: Record<string, unknown>;
}

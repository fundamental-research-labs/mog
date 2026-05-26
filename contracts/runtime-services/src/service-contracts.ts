/**
 * A verified principal at a service boundary.
 *
 * Constructed by the auth layer after token verification; downstream
 * services receive this rather than raw tokens.
 */
export interface ServicePrincipal {
  /** Opaque principal identifier. */
  principalId: string;

  /** Discriminant for the principal type (e.g. `"user"`, `"service"`, `"system"`). */
  principalType: string;

  /** Tenant the principal belongs to. */
  tenantId: string;

  /** Display name for logging/audit (never used for authorization). */
  displayName?: string;
}

/** Lifecycle state of a service session. */
export type SessionState = 'active' | 'expired' | 'revoked';

/** Session lifecycle contract shared across service boundaries. */
export interface ServiceSession {
  /** Unique session identifier. */
  id: string;

  /** The verified principal that owns this session. */
  principal: ServicePrincipal;

  /** Permission scopes granted to this session. */
  scopes: string[];

  /** Session time-to-live in seconds. */
  ttlSeconds: number;

  /** Current lifecycle state. */
  state: SessionState;
}

/** Tenant/workspace/document scope join used for authorization checks. */
export interface TenantScope {
  tenantId: string;
  workspaceId?: string;
  documentId?: string;
}

/**
 * Grant authorizing a principal to join a collaboration room.
 *
 * The collab server validates this before allowing a WebSocket upgrade.
 */
export interface RoomGrant {
  /** The room identifier (typically a document id). */
  roomId: string;

  /** Principal authorized to join. */
  principal: ServicePrincipal;

  /** Capability scopes within the room (e.g. `"read"`, `"write"`). */
  scopes: string[];

  /** ISO-8601 expiry after which the grant must be re-acquired. */
  expiresAt: string;
}

/**
 * Service-level import authorization wrapper.
 *
 * Bridges the file-io import path and the capability system: the import
 * service checks this before accepting bytes.
 */
export interface SourceImportHandoff {
  /** Reference to the import authorization decision. */
  importDecisionRef: string;

  /** Principal performing the import. */
  principal: ServicePrincipal;

  /** Target scope for the imported document. */
  targetScope: TenantScope;

  /** MIME type of the source file. */
  sourceMimeType: string;

  /** Byte-length limit enforced by the import decision. */
  maxBytes?: number;
}

/**
 * Service-level export authorization wrapper.
 *
 * The export/materialization service checks this before producing output bytes.
 */
export interface ExportMaterializationHandoff {
  /** Reference to the export authorization decision. */
  exportDecisionRef: string;

  /** Reference to the materialization decision. */
  materializationDecisionRef: string;

  /** Principal requesting the export. */
  principal: ServicePrincipal;

  /** Source scope of the document being exported. */
  sourceScope: TenantScope;

  /** Requested output format (e.g. `"xlsx"`, `"pdf"`, `"csv"`). */
  outputFormat: string;
}

/**
 * Provider construction authorization reference.
 *
 * Authorizes a storage/compute provider to be instantiated for a given scope.
 */
export interface ProviderMaterializationRef {
  /** Reference to the materialization decision. */
  materializationDecisionRef: string;

  /** Provider type being authorized (e.g. `"s3"`, `"gcs"`, `"local"`). */
  providerType: string;

  /** Scope the provider operates within. */
  scope: TenantScope;
}

/**
 * Raw-byte access decision envelope.
 *
 * Controls whether a service may read or write raw bytes (blobs, media,
 * embedded objects) for a given scope. Separate from document-level
 * permissions because raw-byte access has distinct security implications.
 */
export interface RawByteMaterializationDecision {
  /** Reference to this decision for audit trails. */
  rawByteDecisionRef: string;

  /** Whether raw-byte access is granted. */
  granted: boolean;

  /** Principal the decision applies to. */
  principal: ServicePrincipal;

  /** Scope the decision covers. */
  scope: TenantScope;

  /** Allowed MIME types (empty means all allowed when granted). */
  allowedMimeTypes?: string[];

  /** Maximum byte size per blob. */
  maxBlobBytes?: number;
}
